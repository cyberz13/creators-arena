import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { one } from "./db";
import { isProduction } from "./env";
import { clientIp } from "./client-ip";
import type { CreatorProfile, User } from "./types";
import {
  issueSession,
  resolveSession,
  revokeSessionByToken,
  SESSION_TTL_MS,
  type SessionStage,
} from "@/services/sessions";
import { hashIp } from "@/services/fraud";

export { hashPassword, verifyPassword } from "./password";

/**
 * Cookie glue over the DB-backed session store (services/sessions.ts).
 * The cookie carries an opaque random token only.
 */
const SESSION_COOKIE = "tahaddi_session";

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    maxAge: maxAgeSeconds,
    path: "/",
  };
}

async function requestMeta() {
  try {
    const h = await headers();
    return { ipHash: hashIp(clientIp(h)), userAgent: h.get("user-agent") };
  } catch {
    return { ipHash: null, userAgent: null };
  }
}

/** Starts a session for a user (called after password — and MFA when required — succeed). */
export async function createSession(user: Pick<User, "id" | "role">, stage: SessionStage = "full") {
  const meta = await requestMeta();
  const issued = await issueSession(user, stage, meta);
  const maxAge = Math.floor((stage === "mfa_pending" ? 10 * 60_000 : SESSION_TTL_MS[user.role]) / 1000);
  (await cookies()).set(SESSION_COOKIE, issued.token, cookieOptions(maxAge));
  return issued;
}

/** Replaces the current cookie's session with a fresh full one (rotation). */
export async function replaceSessionCookie(token: string, user: Pick<User, "id" | "role">) {
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(Math.floor(SESSION_TTL_MS[user.role] / 1000)));
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionByToken(token);
  store.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  role: "admin" | "creator";
  profile: CreatorProfile | null;
  sessionId: string;
  approved: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

async function currentToken(): Promise<string | null> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** Fully authenticated user or null. mfa_pending sessions never resolve here. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const token = await currentToken();
    if (!token) return null;
    const resolved = await resolveSession(token);
    if (!resolved || resolved.session.stage !== "full") return null;
    const { user, session } = resolved;
    const profile =
      user.role === "creator"
        ? ((await one<CreatorProfile>("SELECT * FROM creator_profiles WHERE user_id = ?", user.id)) ?? null)
        : null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      profile,
      sessionId: session.id,
      approved: Number(user.approved) === 1,
      emailVerified: Number(user.email_verified) === 1,
      mfaEnabled: Number(user.mfa_enabled) === 1,
    };
  } catch {
    return null;
  }
}

/** The half-authenticated admin between password and TOTP (used by /login/mfa only). */
export async function getPendingMfaSession(): Promise<{ user: User; sessionId: string } | null> {
  const token = await currentToken();
  if (!token) return null;
  const resolved = await resolveSession(token);
  if (!resolved || resolved.session.stage !== "mfa_pending") return null;
  return { user: resolved.user, sessionId: resolved.session.id };
}

export async function requireCreator(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "creator") redirect("/admin");
  return user;
}

/**
 * Admin guard. MFA is mandatory: an admin who has not enrolled is sent to
 * /account/mfa (which calls this with allowUnenrolled) before anything else.
 */
export async function requireAdmin(opts: { allowUnenrolled?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  if (!user.mfaEnabled && !opts.allowUnenrolled) redirect("/account/mfa");
  return user;
}
