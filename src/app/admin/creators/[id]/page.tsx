import Link from "next/link";
import { notFound } from "next/navigation";
import { getCreatorDetail } from "@/services/creators";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/avatar";
import { CampaignStatusBadge, PAYOUT_LABELS } from "@/components/campaign-status";
import { StatusToggle } from "./status-toggle";
import { formatNumber, formatSAR } from "@/lib/utils";
import type { CampaignStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminCreatorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCreatorDetail(id);
  if (!detail) notFound();
  const { creator, participations, prizes } = detail;
  const avg =
    creator.campaigns_count > 0 ? Math.round(creator.qualified_total / creator.campaigns_count) : 0;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={creator.name} size="lg" />
            <div>
              <h1 className="text-xl font-bold text-white">{creator.name}</h1>
              <p className="text-sm text-zinc-400" dir="ltr">@{creator.username} • {creator.email}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {creator.category_name && <Badge variant="brand">{creator.category_name}</Badge>}
                <Badge>{formatNumber(creator.followers_count)} متابع</Badge>
                {creator.status === "active" ? (
                  <Badge variant="success">نشط</Badge>
                ) : (
                  <Badge variant="danger">معطّل</Badge>
                )}
              </div>
            </div>
          </div>
          <StatusToggle userId={id} status={creator.status} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-4">
          {[
            ["الحملات", formatNumber(creator.campaigns_count)],
            ["زيارات مؤهلة", formatNumber(creator.qualified_total)],
            ["مرات الفوز", formatNumber(creator.wins)],
            ["متوسط الزيارات/حملة", formatNumber(avg)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/5 p-3 text-center">
              <p className="tabular text-lg font-bold text-white">{value}</p>
              <p className="text-xs text-zinc-400">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-400">
          {creator.tiktok && <span dir="ltr">TikTok: {creator.tiktok}</span>}
          {creator.instagram && <span dir="ltr">Instagram: {creator.instagram}</span>}
          {creator.snapchat && <span dir="ltr">Snapchat: {creator.snapchat}</span>}
          {creator.phone && <span dir="ltr">📱 {creator.phone}</span>}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>المشاركات</CardTitle></CardHeader>
          <CardContent className="divide-y divide-white/5 p-0">
            {participations.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">لا مشاركات</p>}
            {participations.map((p) => (
              <Link key={p.campaign_id} href={`/admin/campaigns/${p.campaign_id}`} className="flex items-center justify-between px-5 py-3 hover:bg-white/5">
                <div>
                  <p className="font-bold text-white">{p.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                    <CampaignStatusBadge status={p.status as CampaignStatus} />
                    {p.final_rank && <span>المركز النهائي #{p.final_rank}</span>}
                    {p.is_winner === 1 && <span>🏆 فائز</span>}
                  </div>
                </div>
                <span className="tabular font-bold text-emerald-300">{formatNumber(p.qualified_count)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>الجوائز</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {prizes.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">لا جوائز بعد</p>}
            {prizes.map((p, i) => {
              const label = PAYOUT_LABELS[p.status];
              return (
                <div key={i} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5">
                  <span className="text-sm font-semibold text-zinc-200">
                    {p.title} — المركز #{p.prize_rank}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular font-bold text-amber-300">{formatSAR(p.amount)}</span>
                    <Badge variant={label.variant}>{label.label}</Badge>
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
