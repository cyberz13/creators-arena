import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignWithStats, getPrizes } from "@/services/campaigns";
import { getLeaderboard } from "@/services/leaderboard";
import { dailyVisits, trafficSources } from "@/services/analytics";
import { listPayouts } from "@/services/payouts";
import { q } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignStatusBadge, PAYOUT_LABELS } from "@/components/campaign-status";
import { Badge } from "@/components/ui/badge";
import { DailyVisitsChart, SourcesChart } from "@/components/charts";
import { ManageButtons } from "./manage-buttons";
import { formatDate, formatNumber, formatSAR } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PerfRow {
  user_id: string;
  username: string;
  name: string;
  total_clicks: number;
  qualified_count: number;
  rejected_count: number;
  pending_count: number;
  joined_at: number;
}

export default async function AdminCampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaignWithStats(id);
  if (!campaign) notFound();

  const prizes = await getPrizes(id);
  const board = await getLeaderboard(id);
  const daily = await dailyVisits(id, 60);
  const sources = await trafficSources(id);
  const payouts = (await listPayouts()).filter((p) => p.campaign_id === id);
  const perf = await q<PerfRow>(
    `SELECT p.user_id, cp.username, cp.name, p.total_clicks, p.qualified_count,
            p.rejected_count, p.pending_count, p.joined_at
     FROM campaign_participants p JOIN creator_profiles cp ON cp.user_id = p.user_id
     WHERE p.campaign_id = ? ORDER BY p.qualified_count DESC`,
    id
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white">{campaign.title}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {campaign.store_name} •{" "}
            <a href={campaign.store_url} target="_blank" className="text-brand-400 hover:underline" dir="ltr">
              {campaign.store_url}
            </a>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {formatDate(campaign.start_at)} ← {formatDate(campaign.end_at)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ManageButtons campaignId={id} status={campaign.status} />
          <Link href={`/campaigns/${id}`} className="text-sm font-semibold text-brand-400 hover:underline">
            عرض الصفحة العامة ←
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["المشاركون", formatNumber(campaign.participants_count)],
          ["إجمالي النقرات", formatNumber(campaign.clicks_total)],
          ["زيارات مؤهلة", formatNumber(campaign.qualified_total)],
          ["الجائزة", formatSAR(campaign.prize_total)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4 text-center">
            <p className="tabular text-xl font-bold text-white">{value}</p>
            <p className="mt-0.5 text-xs text-zinc-400">{label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>الزيارات اليومية</CardTitle></CardHeader>
          <CardContent><DailyVisitsChart data={daily} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>مصادر الزيارات</CardTitle></CardHeader>
          <CardContent><SourcesChart data={sources} /></CardContent>
        </Card>
      </div>

      {/* Prizes + winners */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>🏆 الجوائز (Snapshot مجمّد)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {prizes.map((p) => (
              <div key={p.rank} className="flex items-center justify-between rounded-xl bg-amber-500/10 px-4 py-2.5">
                <span className="font-semibold text-amber-300">المركز #{p.rank}</span>
                <span className="tabular font-bold text-amber-200">{formatSAR(p.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>الفائزون</CardTitle></CardHeader>
          <CardContent>
            {payouts.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">
                {campaign.status === "ended" ? "لا فائزين — لا زيارات مؤهلة" : "تُحدد النتائج عند انتهاء الحملة"}
              </p>
            ) : (
              <div className="space-y-2">
                {payouts.map((p) => {
                  const label = PAYOUT_LABELS[p.status];
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5">
                      <span className="font-semibold text-zinc-200">
                        #{p.prize_rank} @{p.username}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular font-bold">{formatSAR(p.amount)}</span>
                        <Badge variant={label.variant}>{label.label}</Badge>
                      </span>
                    </div>
                  );
                })}
                <Link href="/admin/payouts" className="block pt-1 text-center text-sm font-bold text-brand-400 hover:underline">
                  إدارة دفع الجوائز ←
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Creator performance */}
      <Card>
        <CardHeader><CardTitle>أداء صناع المحتوى ({formatNumber(perf.length)})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {perf.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">لا مشاركين بعد</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs text-zinc-500">
                  {["#", "Creator", "مؤهلة", "مرفوضة", "قيد المراجعة", "إجمالي", "نسبة التأهيل"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-start font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {perf.map((p, i) => (
                  <tr key={p.user_id} className="hover:bg-white/5">
                    <td className="px-4 py-2.5 font-bold text-zinc-500">
                      {board.find((b) => b.user_id === p.user_id)?.rank ?? i + 1}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/creators/${p.user_id}`} className="font-bold text-white hover:text-brand-300">
                        @{p.username}
                      </Link>
                      <p className="text-xs text-zinc-500">{p.name}</p>
                    </td>
                    <td className="tabular px-4 py-2.5 font-bold text-emerald-300">{formatNumber(p.qualified_count)}</td>
                    <td className="tabular px-4 py-2.5 text-red-400">{formatNumber(p.rejected_count)}</td>
                    <td className="tabular px-4 py-2.5 text-amber-400">{formatNumber(p.pending_count)}</td>
                    <td className="tabular px-4 py-2.5 text-zinc-400">{formatNumber(p.total_clicks)}</td>
                    <td className="tabular px-4 py-2.5 text-zinc-400">
                      {p.total_clicks > 0 ? `${Math.round((p.qualified_count / p.total_clicks) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
