import { now, one, run } from "@/lib/db";

export interface RateLimitVerdict {
  allowed: boolean;
  count: number;
  /** ms until the window resets (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Fixed-window limiter stored in the database, so it holds across every
 * serverless instance and survives cold starts. The whole check is ONE
 * atomic upsert: concurrent requests cannot both slip under the limit.
 *
 * Keys are caller-chosen (e.g. `login:ip:<hash>`); never put raw PII in them.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs = now()
): Promise<RateLimitVerdict> {
  const expiredBefore = nowMs - windowMs;
  await run(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ? THEN ? ELSE rate_limits.window_start END`,
    key,
    nowMs,
    expiredBefore,
    expiredBefore,
    nowMs
  );
  const row = (await one<{ count: number; window_start: number }>(
    "SELECT count, window_start FROM rate_limits WHERE key = ?",
    key
  ))!;
  const count = Number(row.count);
  const allowed = count <= limit;
  return {
    allowed,
    count,
    retryAfterMs: allowed ? 0 : Math.max(0, Number(row.window_start) + windowMs - nowMs),
  };
}

/** Housekeeping for the lifecycle sweep. */
export async function purgeRateLimits(olderThanMs = 24 * 3_600_000, nowMs = now()): Promise<void> {
  await run("DELETE FROM rate_limits WHERE window_start < ?", nowMs - olderThanMs);
}
