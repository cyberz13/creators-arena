"use client";

import { useActionState } from "react";
import { updateSettingsAction, type FormState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, FieldError } from "@/components/ui/input";

const initial: FormState = { error: null };

const FIELDS = [
  {
    key: "dedup_window_hours",
    label: "نافذة منع التكرار (ساعات)",
    hint: "نفس الزائر يُحتسب مرة واحدة لكل حملة خلال هذه المدة",
  },
  {
    key: "rate_limit_per_minute",
    label: "الحد الأقصى للنقرات في الدقيقة من نفس الـIP",
    hint: "ما يتجاوز هذا الحد يُرفض تلقائيًا (rate_limited)",
  },
  {
    key: "review_threshold_24h",
    label: "حد المراجعة اليدوية (نقرات/24 ساعة من نفس الـIP)",
    hint: "ما يتجاوزه يذهب إلى «قيد المراجعة» بدل الاحتساب المباشر",
  },
  {
    key: "max_devices_per_ip_24h",
    label: "أقصى أجهزة مختلفة لكل IP في اليوم",
    hint: "عدالة شبكات الجوال: أجهزة متعددة خلف نفس الشبكة تُحتسب حتى هذا الحد، وما بعده يذهب للمراجعة",
  },
] as const;

export function SettingsForm({ settings }: { settings: Record<string, number> }) {
  // keys are typed on the server action side; the form just renders FIELDS
  const [state, action, pending] = useActionState(updateSettingsAction, initial);
  return (
    <form action={action}>
      <Card className="space-y-5 p-5">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input id={f.key} name={f.key} type="number" min={0} dir="ltr" defaultValue={settings[f.key]} required />
            <p className="mt-1 text-xs text-zinc-500">{f.hint}</p>
          </div>
        ))}
        <FieldError message={state.error} />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
        </Button>
      </Card>
    </form>
  );
}
