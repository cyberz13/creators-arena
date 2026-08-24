import { getAllSettings } from "@/services/settings";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "الإعدادات" };

export default async function AdminSettingsPage() {
  const settings = await getAllSettings();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">إعدادات الحماية من التلاعب</h1>
        <p className="mt-1 text-sm text-zinc-400">
          تعديل حساسية نظام كشف الاحتيال — التغييرات تُطبق فورًا على الزيارات الجديدة.
        </p>
      </div>
      <SettingsForm settings={settings} />
    </div>
  );
}
