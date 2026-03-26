import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_ROOT = ".data/attachments";
const LOCAL_ENCRYPTION_HEADER = Buffer.from("LOENC1");
const LOCAL_ENCRYPTION_ALGORITHM = "aes-256-gcm";
const LOCAL_ENCRYPTION_IV_LENGTH = 12;
const LOCAL_ENCRYPTION_AUTH_TAG_LENGTH = 16;
let cachedLocalEncryptionKey: Buffer | null = null;

export type AttachmentStorageZone = "quarantine" | "clean";

type AttachmentStorageDriver = "local" | "s3";

type ResolvedLocator = {
  zone: AttachmentStorageZone;
  key: string;
};

type S3Config = {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  quarantineBucket: string;
  cleanBucket: string;
  serverSideEncryption?: "AES256" | "aws:kms";
  kmsKeyId?: string;
};

export type PresignedUploadTarget = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
};

export type PresignedDownloadTarget = {
  url: string;
  expiresAt: Date;
};

export function encodeAttachmentStorageLocator(zone: AttachmentStorageZone, key: string): string {
  return `${zone}:${normalizeObjectKey(key)}`;
}

export function decodeAttachmentStorageLocator(locator: string): ResolvedLocator {
  const separatorIndex = locator.indexOf(":");
  if (separatorIndex <= 0) {
    throw new Error("Geçersiz attachment storage locator formatı");
  }

  const rawZone = locator.slice(0, separatorIndex);
  const rawKey = locator.slice(separatorIndex + 1);
  const key = normalizeObjectKey(rawKey);

  if (!isAttachmentStorageZone(rawZone)) {
    throw new Error(`Desteklenmeyen attachment storage zone: ${rawZone}`);
  }

  return {
    zone: rawZone,
    key
  };
}

export class AttachmentObjectStore {
  private readonly driver: AttachmentStorageDriver;

  private readonly rootPath: string;

  private readonly s3Client?: S3Client;

  private readonly s3Config?: S3Config;

  constructor(rootPath?: string) {
    this.driver = resolveDriver();
    this.rootPath = path.resolve(rootPath ?? process.env.ATTACHMENT_STORAGE_ROOT ?? DEFAULT_ROOT);

    if (this.driver === "s3") {
      this.s3Config = resolveS3Config();
      this.s3Client = buildS3Client(this.s3Config);
    }
  }

  isS3Driver(): boolean {
    return this.driver === "s3";
  }

  supportsDirectPresignedUpload(): boolean {
    return this.driver === "s3";
  }

  async createPresignedUpload(params: {
    locator: string;
    mimeType: string;
    expiresInSeconds: number;
  }): Promise<PresignedUploadTarget> {
    if (!this.s3Client || !this.s3Config) {
      throw new Error("Presigned upload yalnızca S3 storage driver ile desteklenir");
    }

    const resolved = decodeAttachmentStorageLocator(params.locator);
    const bucket = this.bucketForZone(resolved.zone);
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: resolved.key,
      ContentType: params.mimeType,
      ...(this.s3Config.serverSideEncryption
        ? {
            ServerSideEncryption: this.s3Config.serverSideEncryption,
            ...(this.s3Config.serverSideEncryption === "aws:kms" && this.s3Config.kmsKeyId
              ? { SSEKMSKeyId: this.s3Config.kmsKeyId }
              : {})
          }
        : {})
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: params.expiresInSeconds
    });

    return {
      url,
      method: "PUT",
      headers: buildS3UploadHeaders(params.mimeType, this.s3Config),
      expiresAt
    };
  }

  async createPresignedDownload(params: {
    locator: string;
    fileName: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownloadTarget> {
    if (!this.s3Client || !this.s3Config) {
      throw new Error("Presigned download yalnızca S3 storage driver ile desteklenir");
    }

    const resolved = decodeAttachmentStorageLocator(params.locator);
    const bucket = this.bucketForZone(resolved.zone);
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);
    const encodedName = encodeURIComponent(params.fileName);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: resolved.key,
      ResponseCacheControl: "private, no-store",
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodedName}`
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: params.expiresInSeconds
    });

    return {
      url,
      expiresAt
    };
  }

  async write(locator: string, content: Buffer, mimeType?: string): Promise<void> {
    const resolved = decodeAttachmentStorageLocator(locator);

    if (this.s3Client) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketForZone(resolved.zone),
          Key: resolved.key,
          Body: content,
          ...(mimeType ? { ContentType: mimeType } : {}),
          ...(this.s3Config?.serverSideEncryption
            ? {
                ServerSideEncryption: this.s3Config.serverSideEncryption,
                ...(this.s3Config.serverSideEncryption === "aws:kms" && this.s3Config.kmsKeyId
                  ? { SSEKMSKeyId: this.s3Config.kmsKeyId }
                  : {})
              }
            : {})
        })
      );
      return;
    }

    const target = this.resolveLocalPath(resolved);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, maybeEncryptLocalContent(content));
  }

  async read(locator: string): Promise<Buffer> {
    const resolved = decodeAttachmentStorageLocator(locator);

    if (this.s3Client) {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketForZone(resolved.zone),
          Key: resolved.key
        })
      );

      if (!response.Body) {
        throw new Error(`S3 object body boş döndü: ${resolved.key}`);
      }

      return toBuffer(response.Body);
    }

    const target = this.resolveLocalPath(resolved);
    const content = await readFile(target);
    return maybeDecryptLocalContent(content);
  }

  async exists(locator: string): Promise<boolean> {
    const resolved = decodeAttachmentStorageLocator(locator);

    if (this.s3Client) {
      try {
        await this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.bucketForZone(resolved.zone),
            Key: resolved.key
          })
        );
        return true;
      } catch (error) {
        if (isObjectNotFound(error)) {
          return false;
        }

        throw error;
      }
    }

    try {
      const target = this.resolveLocalPath(resolved);
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }

  async move(sourceLocator: string, targetLocator: string, _mimeType?: string): Promise<void> {
    const source = decodeAttachmentStorageLocator(sourceLocator);
    const target = decodeAttachmentStorageLocator(targetLocator);

    if (this.s3Client) {
      const sourceBucket = this.bucketForZone(source.zone);
      const targetBucket = this.bucketForZone(target.zone);

      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: targetBucket,
          Key: target.key,
          CopySource: encodeCopySource(sourceBucket, source.key),
          MetadataDirective: "COPY",
          ...(this.s3Config?.serverSideEncryption
            ? {
                ServerSideEncryption: this.s3Config.serverSideEncryption,
                ...(this.s3Config.serverSideEncryption === "aws:kms" && this.s3Config.kmsKeyId
                  ? { SSEKMSKeyId: this.s3Config.kmsKeyId }
                  : {})
              }
            : {})
        })
      );

      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: sourceBucket,
          Key: source.key
        })
      );
      return;
    }

    const sourcePath = this.resolveLocalPath(source);
    const targetPath = this.resolveLocalPath(target);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await rename(sourcePath, targetPath);
  }

  async delete(locator: string): Promise<void> {
    const resolved = decodeAttachmentStorageLocator(locator);

    if (this.s3Client) {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketForZone(resolved.zone),
          Key: resolved.key
        })
      );
      return;
    }

    const target = this.resolveLocalPath(resolved);
    try {
      await unlink(target);
    } catch {
      return;
    }
  }

  private resolveLocalPath(locator: ResolvedLocator): string {
    const zoneRoot = path.resolve(this.rootPath, locator.zone);
    const resolved = path.resolve(zoneRoot, locator.key);

    if (resolved !== zoneRoot && !resolved.startsWith(`${zoneRoot}${path.sep}`)) {
      throw new Error("Geçersiz storage locator path traversal içeriyor");
    }

    return resolved;
  }

  private bucketForZone(zone: AttachmentStorageZone): string {
    if (!this.s3Config) {
      throw new Error("S3 config bulunamadı");
    }

    return zone === "quarantine" ? this.s3Config.quarantineBucket : this.s3Config.cleanBucket;
  }
}

export function resetAttachmentLocalEncryptionCacheForTests(): void {
  cachedLocalEncryptionKey = null;
}

function resolveDriver(): AttachmentStorageDriver {
  const configured = process.env.ATTACHMENT_STORAGE_DRIVER?.trim().toLowerCase();
  if (configured === "s3" || configured === "local") {
    return configured;
  }

  return hasS3Env() ? "s3" : "local";
}

function hasS3Env(): boolean {
  return hasValue(process.env.ATTACHMENT_S3_QUARANTINE_BUCKET ?? process.env.S3_BUCKET);
}

function resolveS3Config(): S3Config {
  const region = process.env.ATTACHMENT_S3_REGION ?? process.env.S3_REGION ?? "us-east-1";
  const endpoint = process.env.ATTACHMENT_S3_ENDPOINT ?? process.env.S3_ENDPOINT;
  const quarantineBucket =
    process.env.ATTACHMENT_S3_QUARANTINE_BUCKET ?? process.env.ATTACHMENT_S3_BUCKET_QUARANTINE ?? process.env.S3_BUCKET;
  const cleanBucket =
    process.env.ATTACHMENT_S3_CLEAN_BUCKET ?? process.env.ATTACHMENT_S3_BUCKET_CLEAN ?? process.env.S3_BUCKET;

  if (!hasValue(quarantineBucket) || !hasValue(cleanBucket)) {
    throw new Error("ATTACHMENT_S3_QUARANTINE_BUCKET ve ATTACHMENT_S3_CLEAN_BUCKET zorunlu");
  }

  const forcePathStyleRaw = process.env.ATTACHMENT_S3_FORCE_PATH_STYLE ?? process.env.S3_FORCE_PATH_STYLE;
  const forcePathStyle = forcePathStyleRaw === "true";

  const serverSideEncryptionRaw = process.env.ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION;
  const serverSideEncryption =
    serverSideEncryptionRaw === "AES256" || serverSideEncryptionRaw === "aws:kms"
      ? serverSideEncryptionRaw
      : undefined;

  const kmsKeyId = process.env.ATTACHMENT_S3_KMS_KEY_ID;

  return {
    region,
    ...(hasValue(endpoint) ? { endpoint } : {}),
    forcePathStyle,
    quarantineBucket,
    cleanBucket,
    ...(serverSideEncryption ? { serverSideEncryption } : {}),
    ...(hasValue(kmsKeyId) ? { kmsKeyId } : {})
  };
}

function buildS3Client(config: S3Config): S3Client {
  const accessKeyId = process.env.ATTACHMENT_S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.ATTACHMENT_S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_KEY;

  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    ...(hasValue(accessKeyId) && hasValue(secretAccessKey)
      ? {
          credentials: {
            accessKeyId,
            secretAccessKey
          }
        }
      : {})
  });
}

function buildS3UploadHeaders(mimeType: string, config: S3Config): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": mimeType
  };

  if (config.serverSideEncryption) {
    headers["x-amz-server-side-encryption"] = config.serverSideEncryption;
    if (config.serverSideEncryption === "aws:kms" && config.kmsKeyId) {
      headers["x-amz-server-side-encryption-aws-kms-key-id"] = config.kmsKeyId;
    }
  }

  return headers;
}

function isAttachmentStorageZone(value: string): value is AttachmentStorageZone {
  return value === "quarantine" || value === "clean";
}

function normalizeObjectKey(storageKey: string): string {
  return storageKey.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function maybeEncryptLocalContent(content: Buffer): Buffer {
  if (!isLocalEncryptionEnabled()) {
    return content;
  }

  const key = resolveLocalEncryptionKey();
  if (!key) {
    return content;
  }

  const iv = randomBytes(LOCAL_ENCRYPTION_IV_LENGTH);
  const cipher = createCipheriv(LOCAL_ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([LOCAL_ENCRYPTION_HEADER, iv, authTag, encrypted]);
}

function maybeDecryptLocalContent(content: Buffer): Buffer {
  if (!isLocalEncryptionBlob(content)) {
    return content;
  }

  const key = resolveLocalEncryptionKey();
  if (!key) {
    throw new Error("Local attachment encryption key bulunamadı");
  }

  const encryptedPayload = content.subarray(LOCAL_ENCRYPTION_HEADER.length);
  if (encryptedPayload.length < LOCAL_ENCRYPTION_IV_LENGTH + LOCAL_ENCRYPTION_AUTH_TAG_LENGTH) {
    throw new Error("Encrypted attachment payload bozuk");
  }

  const iv = encryptedPayload.subarray(0, LOCAL_ENCRYPTION_IV_LENGTH);
  const authTag = encryptedPayload.subarray(
    LOCAL_ENCRYPTION_IV_LENGTH,
    LOCAL_ENCRYPTION_IV_LENGTH + LOCAL_ENCRYPTION_AUTH_TAG_LENGTH
  );
  const cipherText = encryptedPayload.subarray(LOCAL_ENCRYPTION_IV_LENGTH + LOCAL_ENCRYPTION_AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(LOCAL_ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]);
}

function isLocalEncryptionBlob(content: Buffer): boolean {
  if (content.length <= LOCAL_ENCRYPTION_HEADER.length) {
    return false;
  }

  return content.subarray(0, LOCAL_ENCRYPTION_HEADER.length).equals(LOCAL_ENCRYPTION_HEADER);
}

function isLocalEncryptionEnabled(): boolean {
  const configured = process.env.ATTACHMENT_LOCAL_ENCRYPTION?.trim().toLowerCase();
  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

function resolveLocalEncryptionKey(): Buffer | null {
  if (cachedLocalEncryptionKey) {
    return cachedLocalEncryptionKey;
  }

  const rawKey = firstNonEmpty([
    process.env.ATTACHMENT_LOCAL_ENCRYPTION_KEY,
    process.env.ENCRYPTION_MASTER_KEY,
    process.env.TOKEN_ENCRYPTION_KEY,
    process.env.AUTH_SECRET
  ]);

  if (!rawKey) {
    if (process.env.NODE_ENV === "production" && isLocalEncryptionEnabled()) {
      throw new Error("ATTACHMENT_LOCAL_ENCRYPTION_KEY veya ENCRYPTION_MASTER_KEY zorunlu");
    }

    return null;
  }

  const decoded = decodeCandidateKey(rawKey);
  cachedLocalEncryptionKey = decoded.length === 32 ? decoded : createHash("sha256").update(decoded).digest();
  return cachedLocalEncryptionKey;
}

function firstNonEmpty(values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function decodeCandidateKey(input: string): Buffer {
  const base64Decoded = decodeBase64(input);
  if (base64Decoded.length > 0) {
    return base64Decoded;
  }

  const hexDecoded = decodeHex(input);
  if (hexDecoded.length > 0) {
    return hexDecoded;
  }

  return Buffer.from(input, "utf8");
}

function decodeBase64(input: string): Buffer {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(normalized + padding, "base64");
    return decoded.length > 0 ? decoded : Buffer.alloc(0);
  } catch {
    return Buffer.alloc(0);
  }
}

function decodeHex(input: string): Buffer {
  if (!/^[0-9a-fA-F]+$/.test(input) || input.length % 2 !== 0) {
    return Buffer.alloc(0);
  }

  try {
    return Buffer.from(input, "hex");
  } catch {
    return Buffer.alloc(0);
  }
}

function encodeCopySource(bucket: string, key: string): string {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");
  return `${encodedBucket}/${encodedKey}`;
}

function isObjectNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as {
    name?: string;
    Code?: string;
    $metadata?: {
      httpStatusCode?: number;
    };
  };

  if (maybeError.$metadata?.httpStatusCode === 404) {
    return true;
  }

  if (maybeError.name === "NotFound" || maybeError.Code === "NotFound") {
    return true;
  }

  return false;
}

async function toBuffer(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof (body as { transformToByteArray: unknown }).transformToByteArray === "function"
  ) {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("S3 body buffer formatı desteklenmiyor");
}
