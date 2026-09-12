import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { execute, id, now, one, q, run } from "@/lib/db";
import { sessionSecret } from "@/lib/env";
import { decryptSecret, encryptSecret, generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import type { User } from "@/lib/types";
import { DomainError } from "./errors";
import { consumeRateLimit } from "./rate-limit";
import { logAdminAction } from "./adminActions";

/**
 * Admin MFA (TOTP). Mandatory: an admin without MFA is redirected to
 * enrolment before any admin page or action. Secrets are encrypted at rest;
 * recovery codes are stored only as peppered hashes and are single use.
 * Nothing here is ever written to logs.
 */

const RECOVERY_CODE_COUNT = 8;
const VERIFY_LIMIT = { limit: 8, windowMs: 10 * 60_000 };

function recoveryHash(code: string): string {
  return createHmac("sha256", `mfa-recovery:${sessionSecret()}`).update(code.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

function randomRecoveryCode(): string {
  const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export interface EnrollmentStart {
  secret: string;
  uri: string;
}

/** Generates (or re-uses a not-yet-confirmed) secret. Never returns a confirmed secret. */
export async function beginMfaEnrollment(user: Pick<User, "id" | "email" | "mfa_enabled" | "mfa_secret_enc">): Promise<EnrollmentStart> {
  if (Number(user.mfa_enabled) === 1) throw new DomainError("المصادقة الثنائية مفعّلة بالفعل");
  let secret: string;
  if (user.mfa_secret_enc) {
    secret = decryptSecret(user.mfa_secret_enc);
  } else {
    secret = generateTotpSecret();
    await run("UPDATE users SET mfa_secret_enc = ? WHERE id = ? AND mfa_enabled = 0", encryptSecret(secret), user.id);
  }
  return { secret, uri: otpauthUri(secret, user.email) };
}

/** Confirms the authenticator with a live code; returns the recovery codes ONCE. */
export async function completeMfaEnrollment(userId: string, code: string): Promise<string[]> {
  const user = await one<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user || !user.mfa_secret_enc) throw new DomainError("ابدأ التفعيل أولًا");
  if (Number(user.mfa_enabled) === 1) throw new DomainError("المصادقة الثنائية مفعّلة بالفعل");
  const verdict = await consumeRateLimit(`mfa:${userId}`, VERIFY_LIMIT.limit, VERIFY_LIMIT.windowMs);
  if (!verdict.allowed) throw new DomainError("محاولات كثيرة — انتظر قليلًا");
  if (!verifyTotp(decryptSecret(user.mfa_secret_enc), code)) throw new DomainError("الرمز غير صحيح");

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  await run("DELETE FROM mfa_recovery_codes WHERE user_id = ?", userId);
  for (const c of codes) {
    await run(
      "INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)",
      id(),
      userId,
      recoveryHash(c),
      now()
    );
  }
  const changed = await execute("UPDATE users SET mfa_enabled = 1 WHERE id = ? AND mfa_enabled = 0", userId);
  if (changed !== 1) throw new DomainError("تعذر التفعيل — أعد المحاولة");
  await logAdminAction(userId, "mfa_enrolled", "user", userId);
  return codes;
}

/** TOTP code or a single-use recovery code. Rate limited per user. */
export async function verifyMfa(userId: string, code: string): Promise<boolean> {
  const verdict = await consumeRateLimit(`mfa:${userId}`, VERIFY_LIMIT.limit, VERIFY_LIMIT.windowMs);
  if (!verdict.allowed) return false;
  const user = await one<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user || Number(user.mfa_enabled) !== 1 || !user.mfa_secret_enc) return false;
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed.replace(/\s+/g, ""))) {
    if (verifyTotp(decryptSecret(user.mfa_secret_enc), trimmed)) return true;
  }
  // recovery code (single use)
  const h = recoveryHash(trimmed);
  const rows = await q<{ id: string; code_hash: string }>(
    "SELECT id, code_hash FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL",
    userId
  );
  for (const r of rows) {
    if (r.code_hash.length === h.length && timingSafeEqual(Buffer.from(r.code_hash), Buffer.from(h))) {
      const used = await execute("UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", now(), r.id);
      if (used === 1) {
        await logAdminAction(userId, "mfa_recovery_code_used", "user", userId);
        return true;
      }
    }
  }
  return false;
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const row = await one<{ n: number }>("SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL", userId);
  return Number(row?.n ?? 0);
}
