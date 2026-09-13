/**
 * Cheap, in-memory, per-instance request limiter used *before* any database
 * or external work on hot public routes (the tracking redirect). It protects
 * compute and DB connections from floods; it is deliberately generous so that
 * many people behind one carrier NAT are never blocked (the click pipeline's
 * own fairness rules handle scoring). Not a security boundary across
 * instances — pair with the DB-backed limiter for authentication.
 */

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

export function allowRequest(key: string, limit: number, windowMs: number, nowMs = Date.now()): boolean {
  let b = buckets.get(key);
  if (!b || nowMs - b.windowStart >= windowMs) {
    if (buckets.size >= MAX_KEYS) buckets.clear();
    b = { windowStart: nowMs, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count <= limit;
}

/** Test hook. */
export function resetRequestLimits(): void {
  buckets.clear();
}
