"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, getPendingMfaSession, replaceSessionCookie } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { requestOrigin } from "@/lib/origin";
import { hashIp } from "@/services/fraud";
import {
  authenticate,
  GENERIC_LOGIN_ERROR,
  GENERIC_RATE_ERROR,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
} from "@/services/auth";
import { verifyMfa } from "@/services/mfa";
import { revokeSession, upgradeSession } from "@/services/sessions";
import { DomainError } from "@/services/errors";

export interface FormState {
  error: string | null;
  notice?: string | null;
}

async function requestIpHash(): Promise<string> {
  return hashIp(clientIp(await headers()));
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(128),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: GENERIC_LOGIN_ERROR };
  const outcome = await authenticate(parsed.data.email, parsed.data.password, await requestIpHash());
  if (!outcome.ok) return { error: outcome.reason === "rate_limited" ? GENERIC_RATE_ERROR : GENERIC_LOGIN_ERROR };
  const { user, requiresMfa } = outcome;
  if (requiresMfa) {
    await createSession(user, "mfa_pending");
    redirect("/login/mfa");
  }
  await createSession(user, "full");
  redirect(user.role === "admin" ? "/admin" : "/dashboard");
}

const mfaSchema = z.object({ code: z.string().trim().min(6).max(16) });

export async function mfaLoginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const pending = await getPendingMfaSession();
  if (!pending) redirect("/login");
  const parsed = mfaSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: "أدخل رمز التحقق" };
  const ok = await verifyMfa(pending.user.id, parsed.data.code);
  if (!ok) return { error: "الرمز غير صحيح أو منتهٍ" };
  const fresh = await upgradeSession(pending.sessionId, pending.user);
  await replaceSessionCookie(fresh.token, pending.user);
  redirect("/admin");
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: z.string().trim().min(3).max(30),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  tiktok: z.string().trim().max(60).optional().or(z.literal("")),
  instagram: z.string().trim().max(60).optional().or(z.literal("")),
  snapchat: z.string().trim().max(60).optional().or(z.literal("")),
  followers_count: z.coerce.number().int().min(0).max(1_000_000_000),
  category_id: z.string().trim().min(1).max(40),
});

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "تحقق من البيانات المدخلة (الاسم، اسم المستخدم، البريد، عدد المتابعين)" };
  const d = parsed.data;
  let userId: string;
  let needsApproval = false;
  try {
    const result = await registerAccount(
      {
        name: d.name,
        username: d.username,
        email: d.email,
        password: d.password,
        phone: d.phone || undefined,
        tiktok: d.tiktok || undefined,
        instagram: d.instagram || undefined,
        snapchat: d.snapchat || undefined,
        followers_count: d.followers_count,
        category_id: d.category_id,
      },
      await requestIpHash(),
      await requestOrigin()
    );
    userId = result.userId;
    needsApproval = result.needsApproval;
    await createSession({ id: userId, role: "creator" }, "full");
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(needsApproval ? "/dashboard?welcome=pending" : "/dashboard?welcome=1");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

/** Revokes the pending MFA session and returns to the login form. */
export async function cancelMfaAction() {
  const pending = await getPendingMfaSession();
  if (pending) await revokeSession(pending.sessionId);
  await destroySession();
  redirect("/login");
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  // Always the same answer: the address' existence is never revealed.
  const notice = "إن كان البريد مسجلًا لدينا فستصلك رسالة بخطوات إعادة التعيين خلال دقائق.";
  if (!parsed.success) return { error: null, notice };
  await requestPasswordReset(parsed.data.email, await requestIpHash(), await requestOrigin());
  return { error: null, notice };
}

const resetSchema = z.object({
  token: z.string().min(20).max(64),
  password: z.string().min(1).max(128),
  confirm: z.string().min(1).max(128),
});

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "رابط غير صالح أو بيانات ناقصة" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "كلمتا المرور غير متطابقتين" };
  try {
    const ok = await resetPassword(parsed.data.token, parsed.data.password);
    if (!ok) return { error: "الرابط غير صالح أو منتهي الصلاحية — اطلب رابطًا جديدًا" };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/login?reset=1");
}

export async function verifyEmailAction(token: string): Promise<boolean> {
  if (typeof token !== "string" || token.length > 64) return false;
  return verifyEmailToken(token);
}
