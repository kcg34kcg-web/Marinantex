import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

interface RateLimitResult {
  success: boolean;
  remaining: number;
  limit: number;
  reset: number;
}

function estimateTokenUsage(text: string): number {
  const roughTokenCount = Math.ceil(text.length / 4);
  return Math.max(1, roughTokenCount);
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = upstashUrl && upstashToken ? new Redis({ url: upstashUrl, token: upstashToken }) : null;

const ratelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60_000, '1 m'),
      analytics: true,
      prefix: 'babylexit:ai:token',
    })
  : null;

export async function enforceTokenRateLimit(identifier: string, textPayload: string): Promise<RateLimitResult> {
  if (!ratelimit) {
    return {
      success: true,
      remaining: 0,
      limit: 0,
      reset: Date.now() + 60_000,
    };
  }

  const tokenCost = estimateTokenUsage(textPayload);
  const result = await ratelimit.limit(identifier, {
    rate: tokenCost,
  });

  return {
    success: result.success,
    remaining: result.remaining,
    limit: result.limit,
    reset: result.reset,
  };
}
