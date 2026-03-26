import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';

const DEFAULT_LIMIT = 40;
const DEFAULT_WINDOW_MS = 60_000;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const redis = UPSTASH_URL && UPSTASH_TOKEN
  ? new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN })
  : null;
const ratelimiterCache = new Map<string, Ratelimit>();

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

function extractClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  return forwardedFor?.split(',')[0]?.trim() || realIp || 'anonymous';
}

export interface RagRateLimitOptions {
  request: Request;
  routeKey: string;
  userId?: string | null;
}

export interface RagRateLimitResult {
  limited: boolean;
  response?: NextResponse;
}

function asRateLimitedResponse(rate: { limit: number; remaining: number; resetAt: number }): RagRateLimitResult {
  const payload = {
    error: 'Cok fazla istek gonderdiniz. Lutfen kisa bir sure sonra tekrar deneyin.',
    message: 'Cok fazla istek gonderdiniz. Lutfen kisa bir sure sonra tekrar deneyin.',
    error_code: 'RATE_LIMITED',
    retryable: true,
    contract_version: 'rag.proxy.error.v1',
    schema_version: 'rag.proxy.error.schema.v1',
  };
  const response = NextResponse.json(payload, { status: 429 });
  response.headers.set('x-ratelimit-limit', String(rate.limit));
  response.headers.set('x-ratelimit-remaining', String(Math.max(0, rate.remaining)));
  response.headers.set('x-ratelimit-reset', String(rate.resetAt));
  return { limited: true, response };
}

function resolveDistributedLimiter(limit: number, windowMs: number): Ratelimit | null {
  if (!redis) return null;
  const seconds = Math.max(1, Math.trunc(windowMs / 1_000));
  const cacheKey = `${limit}:${seconds}`;
  const existing = ratelimiterCache.get(cacheKey);
  if (existing) return existing;
  const created = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${seconds} s`),
    prefix: 'marinantex:rag:route',
    analytics: true,
  });
  ratelimiterCache.set(cacheKey, created);
  return created;
}

export async function enforceRagRouteRateLimit(options: RagRateLimitOptions): Promise<RagRateLimitResult> {
  const limit = parsePositiveInt(process.env.RAG_ROUTE_RATE_LIMIT_PER_MINUTE, DEFAULT_LIMIT);
  const windowMs = parsePositiveInt(process.env.RAG_ROUTE_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
  const actor = options.userId?.trim() || `ip:${extractClientIp(options.request)}`;
  const key = `rag:${options.routeKey}:${actor}`;
  const distributed = resolveDistributedLimiter(limit, windowMs);

  if (distributed) {
    try {
      const result = await distributed.limit(key);
      if (!result.success) {
        return asRateLimitedResponse({
          limit: result.limit,
          remaining: result.remaining,
          resetAt: result.reset,
        });
      }
      return { limited: false };
    } catch (error) {
      console.warn('[RAG rate-limit] Distributed limiter unavailable; using in-memory fallback.', {
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  const rate = checkSimpleRateLimit(key, limit, windowMs);

  if (!rate.allowed) {
    return asRateLimitedResponse({
      limit: rate.limit,
      remaining: rate.remaining,
      resetAt: rate.resetAt,
    });
  }

  return { limited: false };
}
