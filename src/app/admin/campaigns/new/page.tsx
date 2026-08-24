import { CampaignForm } from "./campaign-form";

export const metadata = { title: "إنشاء حملة" };

export default function NewCampaignPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-white">إنشاء حملة جديدة</h1>
      <p className="mt-1 text-sm text-zinc-400">
        أدخل بيانات المتجر المتفق معه وتفاصيل التحدي. المتجر لا يملك حسابًا — أنت من يدير الحملة.
      </p>
      <div className="mt-6">
        <CampaignForm />
      </div>
    </div>
  );
}
