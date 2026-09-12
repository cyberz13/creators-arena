"use client";

import { useActionState } from "react";
import { resetPasswordAction, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

const initial: FormState = { error: null };

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initial);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <Label htmlFor="password">كلمة المرور الجديدة</Label>
        <Input id="password" name="password" type="password" dir="ltr" required minLength={10} autoComplete="new-password" />
        <p className="mt-1 text-xs text-zinc-500">10 أحرف على الأقل، تتضمن حروفًا وأرقامًا.</p>
      </div>
      <div>
        <Label htmlFor="confirm">تأكيد كلمة المرور</Label>
        <Input id="confirm" name="confirm" type="password" dir="ltr" required minLength={10} autoComplete="new-password" />
      </div>
      <FieldError message={state.error} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}
      </Button>
    </form>
  );
}
