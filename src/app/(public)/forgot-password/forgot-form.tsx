"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

const initial: FormState = { error: null, notice: null };

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initial);
  if (state.notice) {
    return <p className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{state.notice}</p>;
  }
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input id="email" name="email" type="email" dir="ltr" required autoComplete="email" />
      </div>
      <FieldError message={state.error} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "جارٍ الإرسال..." : "إرسال رابط إعادة التعيين"}
      </Button>
    </form>
  );
}
