import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_STEP_SECONDS = 30;

export function generateTotpSecret(byteLength = 20): string {
  const bytes = randomBytes(Math.max(10, byteLength));
  return encodeBase32(bytes);
}

export function buildOtpAuthUri(params: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  const issuer = params.issuer.trim();
  const accountName = params.accountName.trim();

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    accountName
  )}?secret=${encodeURIComponent(params.secret)}&issuer=${encodeURIComponent(
    issuer
  )}&algorithm=SHA1&digits=6&period=${DEFAULT_STEP_SECONDS}`;
}

export function verifyTotpCode(params: {
  secret: string;
  code: string;
  now?: Date;
  window?: number;
}): boolean {
  const code = params.code.trim();
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  const window = params.window ?? 1;
  const now = params.now ?? new Date();
  const baseCounter = Math.floor(now.getTime() / 1000 / DEFAULT_STEP_SECONDS);

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateHotp(params.secret, baseCounter + offset);
    if (candidate === code) {
      return true;
    }
  }

  return false;
}

export function generateTotpCode(params: { secret: string; at?: Date }): string {
  const at = params.at ?? new Date();
  const counter = Math.floor(at.getTime() / 1000 / DEFAULT_STEP_SECONDS);
  return generateHotp(params.secret, counter);
}

function generateHotp(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offsetByte = hmac.at(-1);
  if (offsetByte === undefined) {
    throw new Error("TOTP üretimi için HMAC digest boş döndü");
  }

  const offset = offsetByte & 0xf;
  const b0 = hmac[offset] ?? 0;
  const b1 = hmac[offset + 1] ?? 0;
  const b2 = hmac[offset + 2] ?? 0;
  const b3 = hmac[offset + 3] ?? 0;
  const binary =
    ((b0 & 0x7f) << 24) |
    ((b1 & 0xff) << 16) |
    ((b2 & 0xff) << 8) |
    (b3 & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

function encodeBase32(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      continue;
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
