import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
let cachedKey: Buffer | null = null;
let cachedDevFallbackKey: Buffer | null = null;

export function encryptSecret(plainText: string): string {
  if (plainText.startsWith(ENCRYPTED_PREFIX)) {
    return plainText;
  }

  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const cipherText = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, cipherText]).toString("base64url");

  return `${ENCRYPTED_PREFIX}${payload}`;
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    return value;
  }

  const key = resolveEncryptionKey();
  const payload = value.slice(ENCRYPTED_PREFIX.length);
  const packed = Buffer.from(payload, "base64url");

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Şifreli secret çözümlenemedi: payload bozuk");
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const cipherText = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return plain.toString("utf8");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

function resolveEncryptionKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const rawKey = firstNonEmpty([
    process.env.ENCRYPTION_MASTER_KEY,
    process.env.TOKEN_ENCRYPTION_KEY,
    process.env.AUTH_SECRET
  ]);

  if (!rawKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_MASTER_KEY veya TOKEN_ENCRYPTION_KEY zorunlu");
    }

    if (!cachedDevFallbackKey) {
      cachedDevFallbackKey = randomBytes(32);
    }

    cachedKey = cachedDevFallbackKey;
    return cachedKey;
  }

  const normalized = rawKey.trim();
  const decoded = decodeCandidateKey(normalized);
  cachedKey = decoded.length === 32 ? decoded : createHash("sha256").update(decoded).digest();
  return cachedKey;
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
