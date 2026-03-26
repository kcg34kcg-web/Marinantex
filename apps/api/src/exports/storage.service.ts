import { Injectable } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface UploadedObjectResult {
  key: string;
  etag: string | null;
}

const INSECURE_S3_DEFAULTS = {
  accessKeyId: "minioadmin",
  secretAccessKey: "minioadmin123",
} as const;

function isTrueFlag(value: string | undefined): boolean {
  const token = (value ?? "").trim().toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "on";
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    this.bucket = process.env.S3_BUCKET?.trim() || "documents";
    const nodeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
    const isProduction = nodeEnv === "production";
    const allowInsecureDevFallback = isTrueFlag(process.env.S3_ALLOW_INSECURE_DEV_FALLBACK);
    const rawAccessKeyId = process.env.S3_ACCESS_KEY?.trim() ?? "";
    const rawSecretAccessKey = process.env.S3_SECRET_KEY?.trim() ?? "";

    let accessKeyId = rawAccessKeyId;
    let secretAccessKey = rawSecretAccessKey;
    if (!accessKeyId || !secretAccessKey) {
      if (allowInsecureDevFallback && !isProduction) {
        accessKeyId = INSECURE_S3_DEFAULTS.accessKeyId;
        secretAccessKey = INSECURE_S3_DEFAULTS.secretAccessKey;
      } else {
        throw new Error("S3_ACCESS_KEY and S3_SECRET_KEY are required for storage exports.");
      }
    }
    const usingInsecureDefaults =
      accessKeyId === INSECURE_S3_DEFAULTS.accessKeyId &&
      secretAccessKey === INSECURE_S3_DEFAULTS.secretAccessKey;
    if (usingInsecureDefaults && isProduction) {
      throw new Error("Insecure S3 default credentials are not allowed in production.");
    }

    this.client = new S3Client({
      region: process.env.S3_REGION?.trim() || "us-east-1",
      endpoint: endpoint && endpoint.length > 0 ? endpoint : undefined,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async uploadObject(
    key: string,
    payload: Buffer,
    contentType: string,
  ): Promise<UploadedObjectResult> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload,
        ContentType: contentType,
      }),
    );

    return {
      key,
      etag: result.ETag ?? null,
    };
  }

  async getSignedDownloadUrl(
    key: string,
    fileName: string,
    expiresInSeconds: number,
    contentType: string,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
      }),
      {
        expiresIn: expiresInSeconds,
      },
    );
  }
}
