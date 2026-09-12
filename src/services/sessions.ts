import { createHash, randomBytes } from "node:crypto";
import { execute, id, now, one, q, run } from "@/lib/db";
import type { Role, User } from "@/lib/types";

/**
 * Server-side sessions.
 *  - The browser holds a random 256-bit token; the database stores only its
 *    SHA-256, so a database leak does not yield usable cookies.
 *  - Every session can be revoked individually or all at once ("log out
 *    everywhere"), and a revoked/expired row is rejected immediately.
 *  - Admin sessions are short (12h); creators keep 30 days.
 *  - `mfa_pending` sessions exist only between password and TOTP steps and
 *    grant nothing.
 */

export const SESSION_TTL_MS: Record<Role, number> = {
  admin: 12 * 3_600_000,
  creator: 30 * 86_400_000,
};

export type SessionStage = "full" | "mfa_pending";

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  stage: SessionStage;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
  mfa_verified_at: number | null;
  ip_hash: string | null;
  user_agent: string | null;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: number;
}

export async function issueSession(
  user: Pick<User, "id" | "role">,
  stage: SessionStage,
  meta: { ipHash?: string | null; userAgent?: string | null; mfaVerified?: boolean } = {},
  nowMs = now()
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const sessionId = id();
  const ttl = stage === "mfa_pending" ? 10 * 60_000 : SESSION_TTL_MS[user.role];
  const expiresAt = nowMs + ttl;
  await run(
    `INSERT INTO sessions (id, user_id, token_hash, stage, created_at, expires_at, last_seen_at, mfa_verified_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId,
    user.id,
    hashSessionToken(token),
    stage,
    nowMs,
    expiresAt,
    nowMs,
    meta.mfaVerified ? nowMs : null,
    meta.ipHash ?? null,
    meta.userAgent ? meta.userAgent.slice(0, 256) : null
  );
  return { token, sessionId, expiresAt };
}

export interface ResolvedSession {
  session: SessionRow;
  user: User;
}

/** Validates a raw cookie token. Returns null for unknown, revoked, expired, or inactive-user sessions. */
export async function resolveSession(token: string, nowMs = now()): Promise<ResolvedSession | null> {
  if (!token || token.length > 128) return null;
  const session = await one<SessionRow>("SELECT * FROM sessions WHERE token_hash = ?", hashSessionToken(token));
  if (!session) return null;
  if (session.revoked_at !== null) return null;
  if (Number(session.expires_at) <= nowMs) return null;
  const user = await one<User>("SELECT * FROM users WHERE id = ?", session.user_id);
  if (!user || user.status !== "active") return null;
  // Throttled activity touch (at most once per 5 minutes).
  if (nowMs - Number(session.last_seen_at) > 5 * 60_000) {
    await run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", nowMs, session.id);
  }
  return { session, user };
}

/** Promotes an mfa_pending session to a full, MFA-verified one by ROTATING the token (old one dies). */
export async function upgradeSession(sessionId: string, user: Pick<User, "id" | "role">, nowMs = now()): Promise<IssuedSession> {
  const changed = await execute(
    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND stage = 'mfa_pending' AND revoked_at IS NULL",
    nowMs,
    sessionId
  );
  if (changed !== 1) throw new Error("session_not_upgradable");
  return issueSession(user, "full", { mfaVerified: true }, nowMs);
}

/**
 * After MFA enrolment: EVERY other session of the user dies (they were
 * password-only), and the current one is rotated into an MFA-verified session.
 */
export async function rotateAfterMfaEnrollment(currentSessionId: string, user: Pick<User, "id" | "role">, nowMs = now()): Promise<IssuedSession> {
  await run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", nowMs, user.id);
  void currentSessionId; // revoked with the rest; a fresh token replaces it
  return issueSession(user, "full", { mfaVerified: true }, nowMs);
}

export async function revokeSession(sessionId: string, nowMs = now()): Promise<void> {
  await run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", nowMs, sessionId);
}

export async function revokeSessionByToken(token: string, nowMs = now()): Promise<void> {
  await run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", nowMs, hashSessionToken(token));
}

/** "Log out everywhere" (optionally keeping the current session). */
export async function revokeAllSessions(userId: string, exceptSessionId: string | null = null, nowMs = now()): Promise<number> {
  return execute(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL${exceptSessionId ? " AND id <> ?" : ""}`,
    ...(exceptSessionId ? [nowMs, userId, exceptSessionId] : [nowMs, userId])
  );
}

export async function listActiveSessions(userId: string, nowMs = now()): Promise<SessionRow[]> {
  return q<SessionRow>(
    "SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND stage = 'full' ORDER BY last_seen_at DESC",
    userId,
    nowMs
  );
}

/** Housekeeping: drop rows that expired or were revoked more than a week ago. */
export async function purgeSessions(nowMs = now()): Promise<void> {
  const cutoff = nowMs - 7 * 86_400_000;
  await run("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)", cutoff, cutoff);
}
