export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(keyId: string): RateLimitResult;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs?: number;
  now?: () => Date;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const limit = Math.max(1, Math.trunc(options.limit));
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  const buckets = new Map<string, Bucket>();

  return {
    check(keyId: string): RateLimitResult {
      const timestamp = now().getTime();
      const windowStart = Math.floor(timestamp / windowMs) * windowMs;
      const resetAt = windowStart + windowMs;
      for (const [id, bucket] of buckets) {
        if (bucket.windowStart + windowMs <= timestamp) buckets.delete(id);
      }
      const existing = buckets.get(keyId);
      const bucket = existing?.windowStart === windowStart ? existing : { windowStart, count: 0 };
      const allowed = bucket.count < limit;
      if (allowed) bucket.count += 1;
      buckets.set(keyId, bucket);
      return {
        allowed,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - timestamp) / 1000)),
      };
    },
  };
}
