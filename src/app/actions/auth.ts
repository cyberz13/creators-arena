"use server";

import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import type { User } from "@/lib/types";
import { registerCreator } from "@/services/creators";
import { DomainError } from "@/services/campaigns";

export interface FormState {
  error: string | null;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "أدخل البريد وكلمة المرور" };

  const user = await one<User>("SELECT * FROM users WHERE email = ?", email);
  if (!user || !(await verifyPassword(password, user.password_hash)))
    return { error: "بيانات الدخول غير صحيحة" };
  if (user.status !== "active") return { error: "هذا الحساب معطّل — تواصل مع الإدارة" };

  await createSession(user.id);
  redirect(user.role === "admin" ? "/admin" : "/dashboard");
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const userId = await registerCreator({
      name: String(formData.get("name") ?? ""),
      username: String(formData.get("username") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      phone: String(formData.get("phone") ?? "") || undefined,
      tiktok: String(formData.get("tiktok") ?? "") || undefined,
      instagram: String(formData.get("instagram") ?? "") || undefined,
      snapchat: String(formData.get("snapchat") ?? "") || undefined,
      followers_count: Number(formData.get("followers_count") ?? 0),
      category_id: String(formData.get("category_id") ?? ""),
    });
    await createSession(userId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
