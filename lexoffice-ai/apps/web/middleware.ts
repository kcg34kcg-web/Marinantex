import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site"
};
const DEFAULT_FRAME_OPTIONS = "DENY";
const HSTS_HEADER_VALUE = "max-age=31536000; includeSubDomains; preload";
const MAIL_WORKSPACE_PATH_PATTERN = /^\/(?:mail-workspace\/)?[^/]+\/mail(?:\/.*)?$/;
const MAIL_WORKSPACE_EMBED_ORIGINS = parseAllowedOrigins(
  process.env.MAIL_WORKSPACE_EMBED_ORIGINS ??
    process.env.NEXT_PUBLIC_MAIL_WORKSPACE_EMBED_ORIGINS ??
    "http://localhost:3000"
);

type RateLimitRule = {
  method: "POST" | "PUT";
  pathPrefix: string;
  windowMs: number;
  max: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_RULES: RateLimitRule[] = [
  { method: "POST", pathPrefix: "/api/v1/auth/login", windowMs: 60_000, max: 12 },
  { method: "POST", pathPrefix: "/api/v1/ai/", windowMs: 60_000, max: 40 },
  { method: "POST", pathPrefix: "/api/v1/mail/send", windowMs: 60_000, max: 25 },
  { method: "POST", pathPrefix: "/api/v1/mail/sync/trigger", windowMs: 60_000, max: 30 },
  { method: "PUT", pathPrefix: "/api/v1/attachments/staging/upload", windowMs: 60_000, max: 50 }
];

const globalForRateLimit = globalThis as unknown as {
  rateLimitBuckets?: Map<string, RateLimitBucket>;
};

export function middleware(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  const requestId = requestHeaders.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);

  const httpsRedirect = maybeRedirectToHttps(request);
  if (httpsRedirect) {
    httpsRedirect.headers.set("x-request-id", requestId);
    applySecurityHeaders(httpsRedirect, request.nextUrl.pathname);
    return httpsRedirect;
  }

  const rateLimitHit = evaluateRateLimit(request);
  if (rateLimitHit.limited) {
    const response = NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin."
        }
      },
      {
        status: 429
      }
    );

    response.headers.set("x-request-id", requestId);
    response.headers.set("retry-after", String(rateLimitHit.retryAfterSeconds));
    applySecurityHeaders(response, request.nextUrl.pathname);

    return response;
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });

  response.headers.set("x-request-id", requestId);
  applySecurityHeaders(response, request.nextUrl.pathname);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};

function evaluateRateLimit(request: NextRequest): { limited: false } | { limited: true; retryAfterSeconds: number } {
  const rule = RATE_LIMIT_RULES.find(
    (candidate) =>
      candidate.method === request.method && request.nextUrl.pathname.startsWith(candidate.pathPrefix)
  );
  if (!rule) {
    return { limited: false };
  }

  const buckets = getRateLimitBuckets();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${ip}:${rule.method}:${rule.pathPrefix}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + rule.windowMs
    });
    return { limited: false };
  }

  if (existing.count >= rule.max) {
    const retryAfterMs = Math.max(0, existing.resetAt - now);
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return { limited: false };
}

function getRateLimitBuckets(): Map<string, RateLimitBucket> {
  if (!globalForRateLimit.rateLimitBuckets) {
    globalForRateLimit.rateLimitBuckets = new Map<string, RateLimitBucket>();
  }

  return globalForRateLimit.rateLimitBuckets;
}

function applySecurityHeaders(response: NextResponse, pathname: string): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }

  if (process.env.NODE_ENV === "production") {
    response.headers.set("strict-transport-security", HSTS_HEADER_VALUE);
  }

  if (shouldAllowEmbedding(pathname)) {
    response.headers.delete("x-frame-options");
    response.headers.set(
      "content-security-policy",
      `frame-ancestors 'self' ${MAIL_WORKSPACE_EMBED_ORIGINS.join(" ")};`
    );
    return;
  }

  response.headers.delete("content-security-policy");
  response.headers.set("x-frame-options", DEFAULT_FRAME_OPTIONS);
}

function shouldAllowEmbedding(pathname: string): boolean {
  return MAIL_WORKSPACE_EMBED_ORIGINS.length > 0 && MAIL_WORKSPACE_PATH_PATTERN.test(pathname);
}

function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function maybeRedirectToHttps(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  if (process.env.ENFORCE_HTTPS === "false") {
    return null;
  }

  const host = request.nextUrl.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    return null;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const alreadyHttps = request.nextUrl.protocol === "https:" || forwardedProto === "https";
  if (alreadyHttps) {
    return null;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.protocol = "https:";
  return NextResponse.redirect(redirectUrl, 308);
}
