type RedisLike = {
  get: (key: string) => Promise<unknown>;
  set: (...args: unknown[]) => Promise<unknown>;
};

// Optional cache layer. Keep null in local environments without Redis client bindings.
export const redis: RedisLike | null = null;

