"use client";

import Link from "next/link";
import { useActionState } from "react";
import { completeMfaAction, type FormState } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

const initial: FormState = { error: null };

export function EnrollForm() {
  const [state, action, pending] = useActionState(completeMfaAction, initial);
  if (state.recoveryCodes) {
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <p className="font-bold">✅ تم التفعيل. احفظ رموز الاستعادة الآن — لن تظهر مرة أخرى.</p>
          <p className="mt-1 text-amber-100/80">كل رمز يُستخدم مرة واحدة إذا فقدت تطبيق المصادقة.</p>
        </div>
        <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-xl bg-black/30 p-4 font-mono text-sm text-white">
          {state.recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Link href="/admin" className="block rounded-xl bg-brand-600 px-4 py-3 text-center font-bold text-white hover:bg-brand-500">
          حفظتها — الدخول للوحة الإدارة
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="code">رمز التحقق من التطبيق</Label>
        <Input id="code" name="code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" required placeholder="123456" />
      </div>
      <FieldError message={state.error} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "جارٍ التفعيل..." : "تأكيد وتفعيل"}
      </Button>
    </form>
  );
}
