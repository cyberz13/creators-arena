import Link from "next/link";
import { listAllCampaigns } from "@/services/campaigns";
import { Card } from "@/components/ui/card";
import { CampaignStatusBadge } from "@/components/campaign-status";
import { formatDay, formatNumber, formatSAR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "الحملات" };

export default async function AdminCampaignsPage() {
  const campaigns = await listAllCampaigns();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">الحملات</h1>
          <p className="mt-1 text-sm text-zinc-400">{formatNumber(campaigns.length)} حملة</p>
        </div>
        <Link
          href="/admin/campaigns/new"
          className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          + إنشاء حملة
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <Card className="p-10 text-center text-zinc-400">
          لا توجد حملات بعد — أنشئ أول حملة لمتجر متفق معه.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-start text-xs text-zinc-500">
                {["الحملة", "الحالة", "الفترة", "الجائزة", "المشاركون", "زيارات مؤهلة", "إجمالي النقرات"].map((h) => (
                  <th key={h} className="px-4 py-3 text-start font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <Link href={`/admin/campaigns/${c.id}`} className="font-bold text-white hover:text-brand-300">
                      {c.title}
                    </Link>
                    <p className="text-xs text-zinc-500">{c.store_name}</p>
                  </td>
                  <td className="px-4 py-3"><CampaignStatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {formatDay(c.start_at)}
                    <br />← {formatDay(c.end_at)}
                  </td>
                  <td className="tabular px-4 py-3 font-semibold text-amber-300">{formatSAR(c.prize_total)}</td>
                  <td className="tabular px-4 py-3">{formatNumber(c.participants_count)}</td>
                  <td className="tabular px-4 py-3 font-bold text-emerald-300">{formatNumber(c.qualified_total)}</td>
                  <td className="tabular px-4 py-3 text-zinc-400">{formatNumber(c.clicks_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
