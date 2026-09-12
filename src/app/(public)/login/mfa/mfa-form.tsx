"use client";

import { useActionState } from "react";
import { cancelMfaAction, mfaLoginAction, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

const initial: FormState = { error: null };

export function MfaForm() {
  const [state, action, pending] = useActionState(mfaLoginAction, initial);
  return (
    <div className="mt-6 space-y-4">
      <form action={action} className="space-y-4">
        <div>
          <Label htmlFor="code">الرمز</Label>
          <Input id="code" name="code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" required autoFocus placeholder="123456" />
        </div>
        <FieldError message={state.error} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "جارٍ التحقق..." : "تأكيد"}
        </Button>
      </form>
      <form action={cancelMfaAction}>
        <button className="w-full text-center text-sm text-zinc-500 hover:text-zinc-300">إلغاء والعودة لتسجيل الدخول</button>
      </form>
    </div>
  );
}
