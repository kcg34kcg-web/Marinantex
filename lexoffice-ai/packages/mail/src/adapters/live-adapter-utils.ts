import { randomUUID } from "node:crypto";

export type OAuthTokenResponse = {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
};

export function parseScopes(rawScopes: string | undefined, fallbackScopes: string[]): string[] {
  if (!rawScopes) {
    return fallbackScopes;
  }

  const parsed = rawScopes
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  return parsed.length > 0 ? parsed : fallbackScopes;
}

export function expiresAtFromNow(expiresInSeconds: number | undefined): Date | undefined {
  if (!expiresInSeconds || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    return undefined;
  }

  return new Date(Date.now() + expiresInSeconds * 1000);
}

export function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeBase64UrlToString(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  const payloadSegment = segments[1];
  if (!payloadSegment) {
    return null;
  }

  return parseJsonRecord(decodeBase64UrlToString(payloadSegment));
}

export function isLiveProviderEnabled(provider: "GMAIL" | "MICROSOFT_365" | "YANDEX"): boolean {
  if (process.env.MAIL_PROVIDER_FORCE_STUB === "true") {
    return false;
  }

  if (process.env.MAIL_PROVIDER_LIVE === "false") {
    return false;
  }

  if (process.env.MAIL_PROVIDER_LIVE === "true") {
    return true;
  }

  if (provider === "GMAIL") {
    return hasValue(process.env.GMAIL_CLIENT_ID) && hasValue(process.env.GMAIL_CLIENT_SECRET);
  }

  if (provider === "MICROSOFT_365") {
    return hasValue(process.env.MICROSOFT_CLIENT_ID) && hasValue(process.env.MICROSOFT_CLIENT_SECRET);
  }

  return hasValue(process.env.YANDEX_CLIENT_ID) && hasValue(process.env.YANDEX_CLIENT_SECRET);
}

export async function retryProviderRequest<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  maxAttempts = 3,
  baseDelayMs = 200
): Promise<T> {
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      await sleep(baseDelayMs * attempt);
    }
  }
}

export function headerRecordFromResponse(response: Response): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};

  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return headers;
}

export function makeDeterministicExternalId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

export function normalizeWebhookEventType(value: unknown):
  | "MESSAGE_RECEIVED"
  | "MESSAGE_UPDATED"
  | "MAILBOX_SYNC_REQUIRED"
  | "WATCH_EXPIRED"
  | "UNKNOWN" {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "MESSAGE_RECEIVED") {
    return "MESSAGE_RECEIVED";
  }

  if (normalized === "MESSAGE_UPDATED") {
    return "MESSAGE_UPDATED";
  }

  if (normalized === "MAILBOX_SYNC_REQUIRED") {
    return "MAILBOX_SYNC_REQUIRED";
  }

  if (normalized === "WATCH_EXPIRED") {
    return "WATCH_EXPIRED";
  }

  return "UNKNOWN";
}

export function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
