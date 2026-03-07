import { UnauthorizedError } from "@lexoffice/core";
import { createHmac } from "node:crypto";

type OAuthProvider = "GMAIL" | "MICROSOFT_365" | "YANDEX";

type MailOAuthStatePayload = {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  provider: OAuthProvider;
  emailHint?: string;
  issuedAt: number;
  expiresAt: number;
};

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function createMailOAuthState(input: {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  provider: OAuthProvider;
  emailHint?: string;
}): string {
  const now = Math.floor(Date.now() / 1_000);
  const payload: MailOAuthStatePayload = {
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    userId: input.userId,
    provider: input.provider,
    ...(input.emailHint ? { emailHint: input.emailHint } : {}),
    issuedAt: now,
    expiresAt: now + OAUTH_STATE_TTL_SECONDS
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyMailOAuthState(state: string): MailOAuthStatePayload {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new UnauthorizedError("OAuth state geçersiz");
  }

  const expected = sign(encoded);
  if (signature !== expected) {
    throw new UnauthorizedError("OAuth state imzası geçersiz");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
  } catch {
    throw new UnauthorizedError("OAuth state çözümlenemedi");
  }

  if (!isMailOAuthStatePayload(payload)) {
    throw new UnauthorizedError("OAuth state içeriği geçersiz");
  }

  const now = Math.floor(Date.now() / 1_000);
  if (payload.expiresAt < now) {
    throw new UnauthorizedError("OAuth state süresi dolmuş");
  }

  return payload;
}

function sign(value: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET tanımlı değil");
  }

  return createHmac("sha256", secret).update(value).digest("base64url");
}

function isMailOAuthStatePayload(value: unknown): value is MailOAuthStatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<MailOAuthStatePayload>;
  return (
    typeof payload.tenantId === "string" &&
    typeof payload.tenantSlug === "string" &&
    typeof payload.userId === "string" &&
    (payload.provider === "GMAIL" ||
      payload.provider === "MICROSOFT_365" ||
      payload.provider === "YANDEX") &&
    typeof payload.issuedAt === "number" &&
    typeof payload.expiresAt === "number"
  );
}
