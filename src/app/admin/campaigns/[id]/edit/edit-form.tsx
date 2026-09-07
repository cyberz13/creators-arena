"use client";

import { useActionState } from "react";
import { updateCampaignDetailsAction, type FormState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import type { Campaign } from "@/lib/types";

const initial: FormState = { error: null };

export function EditCampaignForm({ campaign }: { campaign: Campaign }) {
  const [state, action, pending] = useActionState(updateCampaignDetailsAction, initial);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="campaign_id" value={campaign.id} />

      <Card className="space-y-4 p-5">
        <p className="font-bold text-white">🏬 بيانات المتجر</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="store_name">اسم المتجر</Label>
            <Input id="store_name" name="store_name" required defaultValue={campaign.store_name} />
          </div>
          <div>
            <Label htmlFor="store_url">رابط المتجر</Label>
            <Input id="store_url" name="store_url" dir="ltr" type="url" required defaultValue={campaign.store_url} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="store_logo_url">رابط شعار المتجر (اختياري)</Label>
            <Input id="store_logo_url" name="store_logo_url" dir="ltr" defaultValue={campaign.store_logo_url ?? ""} />
          </div>
          <div>
            <Label htmlFor="image_url">صورة الحملة (اختياري)</Label>
            <Input id="image_url" name="image_url" dir="ltr" defaultValue={campaign.image_url ?? ""} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <p className="font-bold text-white">🎯 بيانات الحملة</p>
        <div>
          <Label htmlFor="title">عنوان الحملة</Label>
          <Input id="title" name="title" required defaultValue={campaign.title} />
        </div>
        <div>
          <Label htmlFor="description">وصف الحملة</Label>
          <Textarea id="description" name="description" defaultValue={campaign.description} />
        </div>
        <div>
          <Label htmlFor="requirements">شروط المشاركة (اختياري)</Label>
          <Textarea id="requirements" name="requirements" defaultValue={campaign.requirements} />
        </div>
        <p className="text-xs text-zinc-500">
          التواريخ والجوائز مجمّدة بعد الإطلاق حفاظًا على عدالة المنافسة — لتمديد المدة استخدم زر
          «تمديد الحملة» في صفحة الحملة.
        </p>
      </Card>

      <FieldError message={state.error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "جارٍ الحفظ..." : "💾 حفظ التعديلات"}
      </Button>
    </form>
  );
}
