"use client";

import { useActionState } from "react";
import { createCampaignAction, type FormState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";

const initial: FormState = { error: null };

function toLocalInput(ms: number) {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function CampaignForm() {
  const [state, action, pending] = useActionState(createCampaignAction, initial);
  const defaultStart = toLocalInput(Date.now());
  const defaultEnd = toLocalInput(Date.now() + 7 * 86_400_000);

  return (
    <form action={action} className="space-y-5">
      <Card className="space-y-4 p-5">
        <p className="font-bold text-white">🏬 بيانات المتجر</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="store_name">اسم المتجر</Label>
            <Input id="store_name" name="store_name" required placeholder="متجر لمسة" />
          </div>
          <div>
            <Label htmlFor="store_url">رابط المتجر</Label>
            <Input id="store_url" name="store_url" dir="ltr" type="url" required placeholder="https://store.com" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="store_logo_url">رابط شعار المتجر (اختياري)</Label>
            <Input id="store_logo_url" name="store_logo_url" dir="ltr" placeholder="https://..." />
          </div>
          <div>
            <Label htmlFor="image_url">صورة الحملة (اختياري)</Label>
            <Input id="image_url" name="image_url" dir="ltr" placeholder="https://..." />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <p className="font-bold text-white">🎯 بيانات الحملة</p>
        <div>
          <Label htmlFor="title">عنوان الحملة</Label>
          <Input id="title" name="title" required placeholder="🔥 تحدي متجر لمسة" />
        </div>
        <div>
          <Label htmlFor="description">وصف الحملة</Label>
          <Textarea id="description" name="description" placeholder="اجلب زيارات حقيقية للمتجر واربح..." />
        </div>
        <div>
          <Label htmlFor="requirements">شروط المشاركة (اختياري)</Label>
          <Textarea id="requirements" name="requirements" placeholder="مثال: المحتوى باللغة العربية، بدون إعلانات مدفوعة..." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="start_at">تاريخ البداية</Label>
            <Input id="start_at" name="start_at" type="datetime-local" required defaultValue={defaultStart} dir="ltr" />
          </div>
          <div>
            <Label htmlFor="end_at">تاريخ النهاية</Label>
            <Input id="end_at" name="end_at" type="datetime-local" required defaultValue={defaultEnd} dir="ltr" />
          </div>
        </div>
        <div>
          <Label htmlFor="prizes">الجوائز بالريال — مفصولة بفواصل حسب المراكز</Label>
          <Input id="prizes" name="prizes" required placeholder="500, 250, 100" dir="ltr" />
          <p className="mt-1 text-xs text-zinc-500">
            &quot;500&quot; = فائز واحد بـ500 ريال. &quot;500, 250, 100&quot; = ثلاثة فائزين.
            لا يمكن تعديل الجوائز بعد إطلاق الحملة.
          </p>
        </div>
      </Card>

      <FieldError message={state.error} />
      <div className="flex gap-3">
        <Button type="submit" name="intent" value="launch" size="lg" disabled={pending} className="flex-1">
          {pending ? "جارٍ الحفظ..." : "🚀 إطلاق الحملة"}
        </Button>
        <Button type="submit" name="intent" value="draft" size="lg" variant="outline" disabled={pending}>
          حفظ كمسودة
        </Button>
      </div>
    </form>
  );
}
