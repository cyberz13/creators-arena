import { CampaignForm } from "./campaign-form";
import { defaultCampaignWindow } from "@/lib/utils";

export const metadata = { title: "إنشاء حملة" };

export default function NewCampaignPage() {
  const window = defaultCampaignWindow();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-white">إنشاء حملة جديدة</h1>
      <p className="mt-1 text-sm text-zinc-400">
        أدخل بيانات المتجر المتفق معه وتفاصيل التحدي. المتجر لا يملك حسابًا — أنت من يدير الحملة.
      </p>
      <div className="mt-6">
        <CampaignForm defaultStart={window.start} defaultEnd={window.end} />
      </div>
    </div>
  );
}
