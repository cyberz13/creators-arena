import { execute, now, one, run } from "@/lib/db";
import { CHALLENGE_TTL_MS, newChallengeNonce, parseChallengeToken, signChallenge } from "@/lib/challenge";

/**
 * Server-side challenge ledger. One row per interstitial served; a row can be
 * consumed exactly once (conditional UPDATE, affected-row check), which makes
 * replaying a captured token useless even without executing browser JS.
 */

export async function issueChallenge(code: string, ipHash: string, visitorId: string): Promise<string> {
  const nonce = newChallengeNonce();
  await run(
    "INSERT INTO challenges (id, code, ip_hash, visitor_id, issued_at) VALUES (?, ?, ?, ?, ?)",
    nonce,
    code,
    ipHash,
    visitorId,
    now()
  );
  return signChallenge(nonce, code, ipHash);
}

export type ChallengeVerdict = "ok" | "invalid" | "expired" | "replayed" | "visitor_mismatch";

/**
 * Validates signature, binding, freshness, and consumes the nonce atomically.
 * `visitorId` must match the one the challenge was issued to when the visitor
 * presented a cookie at issue time (cookie-less visitors are still bound by
 * code + IP + nonce).
 */
export async function consumeChallenge(
  token: string,
  code: string,
  ipHash: string,
  visitorId: string | null,
  nowMs = now()
): Promise<ChallengeVerdict> {
  const nonce = parseChallengeToken(token, code, ipHash);
  if (!nonce) return "invalid";
  const row = await one<{ issued_at: number; consumed_at: number | null; visitor_id: string }>(
    "SELECT issued_at, consumed_at, visitor_id FROM challenges WHERE id = ? AND code = ? AND ip_hash = ?",
    nonce,
    code,
    ipHash
  );
  if (!row) return "invalid";
  if (row.consumed_at !== null) return "replayed";
  if (nowMs - Number(row.issued_at) > CHALLENGE_TTL_MS || Number(row.issued_at) - nowMs > 5_000) return "expired";
  if (row.visitor_id && visitorId && row.visitor_id !== visitorId) return "visitor_mismatch";
  const changed = await execute(
    "UPDATE challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
    nowMs,
    nonce
  );
  return changed === 1 ? "ok" : "replayed";
}

/** Housekeeping: drop rows older than an hour (nonces are useless after TTL). */
export async function purgeStaleChallenges(nowMs = now()): Promise<void> {
  await run("DELETE FROM challenges WHERE issued_at < ?", nowMs - 3_600_000);
}
