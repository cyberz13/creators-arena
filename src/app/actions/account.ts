"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, replaceSessionCookie, requireAdmin } from "@/lib/auth";
import { one } from "@/lib/db";
import { requestOrigin } from "@/lib/origin";
import { changePassword, issueEmailVerification } from "@/services/auth";
import { completeMfaEnrollment } from "@/services/mfa";
import { revokeAllSessions } from "@/services/sessions";
import { DomainError } from "@/services/errors";
import type { User } from "@/lib/types";

export interface FormState {
  error: string | null;
  notice?: string | null;
  /** MFA enrolment: recovery codes shown exactly once. */
  recoveryCodes?: string[];
}

const passwordSchema = z.object({
  current: z.string().min(1).max(128),
  next: z.string().min(1).max(128),
  confirm: z.string().min(1).max(128),
});

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { error: "انتهت الجلسة — سجّل دخولك مجددًا" };
  const parsed = passwordSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "أكمل الحقول" };
  if (parsed.data.next !== parsed.data.confirm) return { error: "كلمتا المرور غير متطابقتين" };
  try {
    await changePassword(user.id, parsed.data.current, parsed.data.next, user.sessionId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  return { error: null, notice: "تم تغيير كلمة المرور وتسجيل الخروج من الأجهزة الأخرى." };
}

export async function logoutEverywhereAction(): Promise<{ error: string | null }> {
  const user = await getSessionUser();
  if (!user) return { error: "انتهت الجلسة" };
  await revokeAllSessions(user.id, user.sessionId);
  revalidatePath("/dashboard/profile");
  return { error: null };
}

export async function resendVerificationAction(): Promise<{ error: string | null }> {
  const user = await getSessionUser();
  if (!user) return { error: "انتهت الجلسة" };
  await issueEmailVerification(user.id, await requestOrigin());
  return { error: null };
}

const mfaSchema = z.object({ code: z.string().trim().min(6).max(8) });

export async function completeMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin({ allowUnenrolled: true });
  const parsed = mfaSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: "أدخل الرمز المكوّن من 6 أرقام" };
  const row = await one<User>("SELECT * FROM users WHERE id = ?", admin.id);
  if (!row) return { error: "الحساب غير موجود" };
  try {
    const result = await completeMfaEnrollment(admin.id, parsed.data.code, admin.sessionId);
    await replaceSessionCookie(result.session.token, { id: admin.id, role: admin.role });
    return { error: null, recoveryCodes: result.recoveryCodes };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}
