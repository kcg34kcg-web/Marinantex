import { NextResponse } from 'next/server';
import type { RateLimitResult } from '@/lib/source-search/simple-rate-limit';

function createFallbackId(): string {
  return Math.random().toString(36).slice(2, 12);
}

export function createCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `corr-${createFallbackId()}`;
}

export function getClientIdentifier(request: Request): string {
  return (
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    'unknown-client'
  );
}

function attachCommonHeaders(
  response: NextResponse,
  correlationId: string,
  rateLimit?: RateLimitResult,
): NextResponse {
  response.headers.set('x-correlation-id', correlationId);

  if (rateLimit) {
    response.headers.set('x-ratelimit-limit', String(rateLimit.limit));
    response.headers.set('x-ratelimit-remaining', String(rateLimit.remaining));
    response.headers.set('x-ratelimit-reset', String(rateLimit.resetAt));
  }

  return response;
}

export function successJson<T>(
  payload: T,
  status: number,
  correlationId: string,
  rateLimit?: RateLimitResult,
): NextResponse {
  const response = NextResponse.json(
    {
      ...payload,
      correlation_id: correlationId,
    },
    { status },
  );
  return attachCommonHeaders(response, correlationId, rateLimit);
}

export function errorJson(
  status: number,
  message: string,
  correlationId: string,
  extra?: Record<string, unknown>,
  rateLimit?: RateLimitResult,
): NextResponse {
  const response = NextResponse.json(
    {
      error: {
        message,
        status,
        ...extra,
      },
      correlation_id: correlationId,
    },
    { status },
  );
  return attachCommonHeaders(response, correlationId, rateLimit);
}

