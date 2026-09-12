"use client";

import { useActionState, useState, useTransition } from "react";
import {
  changePasswordAction,
  logoutEverywhereAction,
  resendVerificationAction,
  type FormState,
} from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, FieldError } from "@/components/ui/input";

const initial: FormState = { error: null, notice: null };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initial);
  return (
    <Card className="p-5">
      <p className="font-bold text-white">تغيير كلمة المرور</p>
      <form action={action} className="mt-4 space-y-3">
        <div>
          <Label htmlFor="current">كلمة المرور الحالية</Label>
          <Input id="current" name="current" type="password" dir="ltr" required autoComplete="current-password" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="next">الجديدة</Label>
            <Input id="next" name="next" type="password" dir="ltr" required minLength={10} autoComplete="new-password" />
          </div>
          <div>
            <Label htmlFor="confirm">تأكيدها</Label>
            <Input id="confirm" name="confirm" type="password" dir="ltr" required minLength={10} autoComplete="new-password" />
          </div>
        </div>
        <p className="text-xs text-zinc-500">10 أحرف على الأقل مع حروف وأرقام. سيُسجَّل خروجك من الأجهزة الأخرى.</p>
        <FieldError message={state.error} />
        {state.notice && <p className="text-sm font-semibold text-emerald-300">{state.notice}</p>}
        <Button type="submit" disabled={pending}>{pending ? "جارٍ الحفظ..." : "حفظ"}</Button>
      </form>
    </Card>
  );
}

export function SessionControls({ emailVerified, mailEnabled }: { emailVerified: boolean; mailEnabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card className="p-5">
      <p className="font-bold text-white">الجلسات والبريد</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await logoutEverywhereAction();
              setMsg(r.error ?? "تم تسجيل الخروج من كل الأجهزة الأخرى.");
            })
          }
        >
          تسجيل الخروج من كل الأجهزة الأخرى
        </Button>
        {!emailVerified && mailEnabled && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await resendVerificationAction();
                setMsg(r.error ?? "أرسلنا رسالة تأكيد جديدة إلى بريدك.");
              })
            }
          >
            إعادة إرسال رسالة تأكيد البريد
          </Button>
        )}
      </div>
      {!emailVerified && (
        <p className="mt-2 text-xs text-amber-300">بريدك غير مؤكد بعد{mailEnabled ? " — افتح رابط التأكيد الذي أرسلناه لك." : "."}</p>
      )}
      {msg && <p className="mt-2 text-sm text-zinc-300">{msg}</p>}
    </Card>
  );
}
