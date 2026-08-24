import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { one } from "./db";
import type { CreatorProfile, User } from "./types";

export { hashPassword, verifyPassword } from "./password";

const SESSION_COOKIE = "tahaddi_session";
const SESSION_DAYS = 30;

function secret() {
  return new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-secret-change-in-production");
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  role: "admin" | "creator";
  profile: CreatorProfile | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const userId = payload.sub;
    if (!userId) return null;
    const user = await one<User>("SELECT * FROM users WHERE id = ?", userId);
    if (!user || user.status !== "active") return null;
    const profile =
      (await one<CreatorProfile>("SELECT * FROM creator_profiles WHERE user_id = ?", userId)) ?? null;
    return { id: user.id, email: user.email, role: user.role, profile };
  } catch {
    return null;
  }
}

export async function requireCreator(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "creator") redirect("/admin");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}
