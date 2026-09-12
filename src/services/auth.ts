import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { execute, id, now, one, run } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { registrationMode } from "@/lib/env";
import { mailEnabled, mailProvider, sendMail } from "@/lib/mailer";
import type { User } from "@/lib/types";
import { DomainError } from "./errors";
import { consumeRateLimit } from "./rate-limit";
import { revokeAllSessions } from "./sessions";
import { registerCreator, type RegisterInput } from "./creators";

/**
 * Account flows, kept free of Next.js so they are unit-testable:
 *  - authenticate(): DB-backed limits per IP and per e-mail, constant-time
 *    password check even for unknown accounts, ONE generic failure reason
 *    (existence and status are never revealed);
 *  - registration honours REGISTRATION_MODE and issues an e-mail verification;
 *  - password reset / e-mail verification use single-use hashed tokens;
 *  - changing or resetting a password revokes every other session.
 */

const LOGIN_IP_LIMIT = { limit: 10, windowMs: 15 * 60_000 };
const LOGIN_EMAIL_LIMIT = { limit: 20, windowMs: 15 * 60_000 };
const REGISTER_IP_LIMIT = { limit: 5, windowMs: 60 * 60_000 };
const RESET_IP_LIMIT = { limit: 5, windowMs: 15 * 60_000 };
const RESET_EMAIL_LIMIT = { limit: 3, windowMs: 60 * 60_000 };
const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 60 * 60_000;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** bcrypt hash of a random string, so unknown e-mails cost the same time as wrong passwords. */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString("hex"), 10);

export const GENERIC_LOGIN_ERROR = "بيانات الدخول غير صحيحة";
export const GENERIC_RATE_ERROR = "محاولات كثيرة — حاول مرة أخرى بعد قليل";

function emailKey(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}

export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN) throw new DomainError(`كلمة المرور ${PASSWORD_MIN} أحرف على الأقل`);
  if (password.length > PASSWORD_MAX) throw new DomainError("كلمة المرور طويلة جدًا");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw new DomainError("كلمة المرور يجب أن تحتوي حروفًا وأرقامًا");
}

export type LoginOutcome =
  | { ok: true; user: User; requiresMfa: boolean }
  | { ok: false; reason: "rate_limited" | "invalid" };

export async function authenticate(emailRaw: string, password: string, ipHash: string): Promise<LoginOutcome> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password || email.length > 254 || password.length > PASSWORD_MAX) return { ok: false, reason: "invalid" };

  const ipVerdict = await consumeRateLimit(`login:ip:${ipHash}`, LOGIN_IP_LIMIT.limit, LOGIN_IP_LIMIT.windowMs);
  if (!ipVerdict.allowed) return { ok: false, reason: "rate_limited" };
  // Per-account limit is looser than the per-IP one on purpose: an attacker
  // cannot lock a victim out from many IPs without also being throttled per IP.
  const emailVerdict = await consumeRateLimit(`login:email:${emailKey(email)}`, LOGIN_EMAIL_LIMIT.limit, LOGIN_EMAIL_LIMIT.windowMs);
  if (!emailVerdict.allowed) return { ok: false, reason: "rate_limited" };

  const user = await one<User>("SELECT * FROM users WHERE email = ? AND id <> 'system'", email);
  const match = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !match || user.status !== "active") return { ok: false, reason: "invalid" };
  return { ok: true, user, requiresMfa: user.role === "admin" && Number(user.mfa_enabled) === 1 };
}

export interface RegistrationResult {
  userId: string;
  needsApproval: boolean;
  verificationSent: boolean;
}

export async function registerAccount(input: RegisterInput, ipHash: string, origin: string): Promise<RegistrationResult> {
  const verdict = await consumeRateLimit(`register:ip:${ipHash}`, REGISTER_IP_LIMIT.limit, REGISTER_IP_LIMIT.windowMs);
  if (!verdict.allowed) throw new DomainError(GENERIC_RATE_ERROR);
  validatePassword(input.password);
  const userId = await registerCreator(input);
  const needsApproval = registrationMode() === "pending_approval";
  await run(
    "UPDATE users SET approved = ?, email_verified = 0 WHERE id = ?",
    needsApproval ? 0 : 1,
    userId
  );
  const verificationSent = await issueEmailVerification(userId, origin);
  return { userId, needsApproval, verificationSent };
}

// ---------------- one-time tokens ----------------

/** True when some transport will carry the message (resend, or the dev outbox). Production without a provider → false. */
function mailDeliverable(): boolean {
  try {
    return mailProvider() !== "none";
  } catch {
    return false;
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function issueToken(kind: "verify_email" | "reset_password", userId: string, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Only one live token per kind per user: older ones are invalidated.
  await run("UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL", now(), userId, kind);
  await run(
    "INSERT INTO auth_tokens (id, kind, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id(),
    kind,
    userId,
    tokenHash(token),
    now() + ttlMs,
    now()
  );
  return token;
}

/** Marks a token used atomically; returns the user id or null. */
async function consumeToken(kind: "verify_email" | "reset_password", token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await one<{ id: string; user_id: string; expires_at: number; used_at: number | null }>(
    "SELECT id, user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = ?",
    tokenHash(token),
    kind
  );
  if (!row || row.used_at !== null || Number(row.expires_at) <= now()) return null;
  const changed = await execute("UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL", now(), row.id);
  return changed === 1 ? row.user_id : null;
}

export async function issueEmailVerification(userId: string, origin: string): Promise<boolean> {
  const user = await one<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user || Number(user.email_verified) === 1) return false;
  if (!mailDeliverable()) return false; // a token nobody can receive is only a liability
  const token = await issueToken("verify_email", userId, VERIFY_TTL_MS);
  const res = await sendMail({
    to: user.email,
    subject: "تأكيد بريدك — CREATORS ARENA",
    text: `أهلًا بك في CREATORS ARENA.\n\nلتأكيد بريدك افتح الرابط التالي خلال 24 ساعة:\n${origin}/verify-email?token=${token}\n\nإن لم تطلب هذا الحساب تجاهل الرسالة.`,
  });
  return res.ok;
}

export async function verifyEmailToken(token: string): Promise<boolean> {
  const userId = await consumeToken("verify_email", token);
  if (!userId) return false;
  await run("UPDATE users SET email_verified = 1 WHERE id = ?", userId);
  return true;
}

/** Always resolves without revealing whether the address exists. */
export async function requestPasswordReset(emailRaw: string, ipHash: string, origin: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const ipVerdict = await consumeRateLimit(`reset:ip:${ipHash}`, RESET_IP_LIMIT.limit, RESET_IP_LIMIT.windowMs);
  if (!ipVerdict.allowed) return;
  const emailVerdict = await consumeRateLimit(`reset:email:${emailKey(email)}`, RESET_EMAIL_LIMIT.limit, RESET_EMAIL_LIMIT.windowMs);
  if (!emailVerdict.allowed) return;
  const user = await one<User>("SELECT * FROM users WHERE email = ? AND status = 'active' AND id <> 'system'", email);
  if (!user) return;
  if (!mailDeliverable()) {
    console.error("[auth] password reset requested but mail is not configured — no token issued");
    return;
  }
  const token = await issueToken("reset_password", user.id, RESET_TTL_MS);
  await sendMail({
    to: user.email,
    subject: "إعادة تعيين كلمة المرور — CREATORS ARENA",
    text: `طلب أحدهم إعادة تعيين كلمة مرور حسابك.\n\nإن كنت أنت، افتح الرابط التالي خلال ساعة:\n${origin}/reset-password?token=${token}\n\nوإلا تجاهل هذه الرسالة — كلمة مرورك لم تتغير.`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  validatePassword(newPassword);
  const userId = await consumeToken("reset_password", token);
  if (!userId) return false;
  await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(newPassword), userId);
  await revokeAllSessions(userId);
  return true;
}

export async function changePassword(userId: string, current: string, next: string, keepSessionId: string | null): Promise<void> {
  const user = await one<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user) throw new DomainError("الحساب غير موجود");
  if (!(await verifyPassword(current, user.password_hash))) throw new DomainError("كلمة المرور الحالية غير صحيحة");
  validatePassword(next);
  await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(next), userId);
  await revokeAllSessions(userId, keepSessionId);
}

/** Whether e-mail verification is enforced (only when a real provider can deliver mail). */
export function emailVerificationRequired(): boolean {
  return mailEnabled();
}
