type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

interface LimitInput {
  key: string;
  limit: number;
  windowMs: number;
}

export function checkAssistantRateLimit(input: LimitInput) {
  const now = Date.now();
  const bucket = buckets.get(input.key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(input.key, {
      count: 1,
      resetAt: now + input.windowMs,
    });

    return {
      ok: true,
      remaining: input.limit - 1,
      resetAt: now + input.windowMs,
    } as const;
  }

  if (bucket.count >= input.limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: bucket.resetAt,
    } as const;
  }

  bucket.count += 1;
  buckets.set(input.key, bucket);

  return {
    ok: true,
    remaining: Math.max(0, input.limit - bucket.count),
    resetAt: bucket.resetAt,
  } as const;
}
