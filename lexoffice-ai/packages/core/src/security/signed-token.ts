import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type SignedTokenEnvelope<TPayload> = {
  sub: string;
  iat: number;
  exp: number;
  payload: TPayload;
};

let cachedDevSigningSecret: string | null = null;

export function signPayloadToken<TPayload extends Record<string, unknown>>(params: {
  subject: string;
  payload: TPayload;
  ttlSeconds: number;
  secret?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const envelope: SignedTokenEnvelope<TPayload> = {
    sub: params.subject,
    iat: now,
    exp: now + Math.max(1, params.ttlSeconds),
    payload: params.payload
  };

  const encodedEnvelope = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  const signature = signValue(encodedEnvelope, resolveSigningSecret(params.secret));

  return `${encodedEnvelope}.${signature}`;
}

export function verifyPayloadToken<TPayload extends Record<string, unknown>>(params: {
  token: string;
  subject: string;
  secret?: string;
}): TPayload {
  const [encodedEnvelope, givenSignature] = params.token.split(".");
  if (!encodedEnvelope || !givenSignature) {
    throw new Error("Geçersiz token formatı");
  }

  const secret = resolveSigningSecret(params.secret);
  const expectedSignature = signValue(encodedEnvelope, secret);

  if (!safeCompare(givenSignature, expectedSignature)) {
    throw new Error("Token imzası doğrulanamadı");
  }

  const decodedRaw = Buffer.from(encodedEnvelope, "base64url").toString("utf8");
  const envelope = JSON.parse(decodedRaw) as SignedTokenEnvelope<TPayload>;

  if (!envelope || typeof envelope !== "object") {
    throw new Error("Token çözümlenemedi");
  }

  if (envelope.sub !== params.subject) {
    throw new Error("Token subject geçersiz");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof envelope.exp !== "number" || envelope.exp <= now) {
    throw new Error("Token süresi dolmuş");
  }

  if (!envelope.payload || typeof envelope.payload !== "object") {
    throw new Error("Token payload geçersiz");
  }

  return envelope.payload;
}

function signValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeCompare(given: string, expected: string): boolean {
  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(expected);

  if (givenBuffer.length !== expectedBuffer.length || givenBuffer.length === 0) {
    return false;
  }

  return timingSafeEqual(givenBuffer, expectedBuffer);
}

function resolveSigningSecret(secret?: string): string {
  if (secret && secret.trim().length > 0) {
    return secret.trim();
  }

  if (process.env.ATTACHMENT_SIGNING_SECRET && process.env.ATTACHMENT_SIGNING_SECRET.trim().length > 0) {
    return process.env.ATTACHMENT_SIGNING_SECRET.trim();
  }

  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.trim().length > 0) {
    return process.env.AUTH_SECRET.trim();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ATTACHMENT_SIGNING_SECRET veya AUTH_SECRET zorunlu");
  }

  if (!cachedDevSigningSecret) {
    cachedDevSigningSecret = randomBytes(32).toString("base64url");
  }

  return cachedDevSigningSecret;
}
