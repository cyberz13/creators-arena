"use client";

import { useActionState } from "react";
import { registerAction, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldError } from "@/components/ui/input";
import type { Category } from "@/lib/types";

const initial: FormState = { error: null };

export function RegisterForm({ categories }: { categories: Category[] }) {
  const [state, action, pending] = useActionState(registerAction, initial);
  return (
    <form action={action} className="mt-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">الاسم</Label>
          <Input id="name" name="name" required placeholder="سارة العتيبي" />
        </div>
        <div>
          <Label htmlFor="username">اسم المستخدم</Label>
          <Input id="username" name="username" dir="ltr" required placeholder="sara.style" />
        </div>
      </div>
      <div>
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input id="email" name="email" type="email" dir="ltr" required autoComplete="email" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="password">كلمة المرور</Label>
          <Input id="password" name="password" type="password" dir="ltr" required minLength={8} autoComplete="new-password" />
        </div>
        <div>
          <Label htmlFor="phone">رقم الجوال (اختياري)</Label>
          <Input id="phone" name="phone" dir="ltr" placeholder="05xxxxxxxx" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="tiktok">TikTok</Label>
          <Input id="tiktok" name="tiktok" dir="ltr" placeholder="@username" />
        </div>
        <div>
          <Label htmlFor="instagram">Instagram</Label>
          <Input id="instagram" name="instagram" dir="ltr" placeholder="@username" />
        </div>
        <div>
          <Label htmlFor="snapchat">Snapchat (اختياري)</Label>
          <Input id="snapchat" name="snapchat" dir="ltr" placeholder="@username" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="followers_count">عدد المتابعين (تقريبي)</Label>
          <Input id="followers_count" name="followers_count" type="number" min={0} dir="ltr" required placeholder="5000" />
        </div>
        <div>
          <Label htmlFor="category_id">نوع المحتوى</Label>
          <Select id="category_id" name="category_id" required defaultValue="">
            <option value="" disabled>اختر التصنيف</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name_ar}</option>
            ))}
          </Select>
        </div>
      </div>
      <FieldError message={state.error} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب"}
      </Button>
    </form>
  );
}
