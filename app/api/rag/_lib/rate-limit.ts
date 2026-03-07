import { NextResponse } from 'next/server';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';

const DEFAULT_LIMIT = 40;
const DEFAULT_WINDOW_MS = 60_000;

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

export function enforceRagRouteRateLimit(options: RagRateLimitOptions): RagRateLimitResult {
  const limit = parsePositiveInt(process.env.RAG_ROUTE_RATE_LIMIT_PER_MINUTE, DEFAULT_LIMIT);
  const windowMs = parsePositiveInt(process.env.RAG_ROUTE_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
  const actor = options.userId?.trim() || `ip:${extractClientIp(options.request)}`;
  const key = `rag:${options.routeKey}:${actor}`;
  const rate = checkSimpleRateLimit(key, limit, windowMs);

  if (!rate.allowed) {
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
    response.headers.set('x-ratelimit-remaining', String(rate.remaining));
    response.headers.set('x-ratelimit-reset', String(rate.resetAt));
    return { limited: true, response };
  }

  return { limited: false };
}
