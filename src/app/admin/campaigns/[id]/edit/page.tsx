import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign } from "@/services/campaigns";
import { CampaignStatusBadge } from "@/components/campaign-status";
import { EditCampaignForm } from "./edit-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "تعديل الحملة" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const locked = campaign.status === "ended" || campaign.status === "cancelled";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-white">تعديل الحملة</h1>
        <CampaignStatusBadge status={campaign.status} />
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        {campaign.title} —{" "}
        <Link href={`/admin/campaigns/${id}`} className="text-brand-400 hover:underline">
          العودة لصفحة الحملة
        </Link>
      </p>
      <div className="mt-6">
        {locked ? (
          <p className="rounded-2xl border border-white/10 bg-surface p-6 text-center text-zinc-400">
            هذه الحملة منتهية أو ملغاة — بياناتها أرشيف ولا تُعدَّل.
          </p>
        ) : (
          <EditCampaignForm campaign={campaign} />
        )}
      </div>
    </div>
  );
}
