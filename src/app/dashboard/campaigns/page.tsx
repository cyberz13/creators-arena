import Link from "next/link";
import { requireCreator } from "@/lib/auth";
import { listMyCampaigns } from "@/services/campaigns";
import { getMyPosition } from "@/services/leaderboard";
import { listMyPrizes } from "@/services/payouts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CampaignStatusBadge, PAYOUT_LABELS } from "@/components/campaign-status";
import { formatNumber, formatSAR, formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "حملاتي" };

export default async function MyCampaignsPage() {
  const user = await requireCreator();
  const campaigns = await Promise.all(
    (await listMyCampaigns(user.id)).map(async (c) => ({
      ...c,
      position: c.status === "active" ? await getMyPosition(c.id, user.id) : null,
    }))
  );
  const prizes = await listMyPrizes(user.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">حملاتي</h1>
        <p className="mt-1 text-sm text-zinc-400">كل التحديات التي شاركت فيها ونتائجك</p>
      </div>

      {prizes.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">🏆 جوائزي</h2>
          <div className="space-y-2">
            {prizes.map((p) => {
              const label = PAYOUT_LABELS[p.status];
              return (
                <Card key={p.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-bold text-white">{p.campaign_title}</p>
                    <p className="text-sm text-zinc-400">المركز #{p.prize_rank}</p>
                  </div>
                  <div className="text-end">
                    <p className="tabular font-bold text-amber-300">{formatSAR(p.amount)}</p>
                    <Badge variant={label.variant}>{label.label}</Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {campaigns.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-4xl">🎯</p>
          <p className="mt-3 font-bold text-zinc-300">لم تشارك في أي تحدٍّ بعد</p>
          <Link href="/campaigns" className="mt-2 inline-block font-bold text-brand-400 hover:text-brand-300">
            تصفح التحديات المتاحة ←
          </Link>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const rank = c.status === "ended" ? c.final_rank : c.position?.rank;
            return (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
                <Card className="p-4 transition-shadow hover:shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-bold text-white">{c.title}</p>
                        <CampaignStatusBadge status={c.status} />
                        {c.is_winner === 1 && <span>🏆</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-zinc-400">
                        {c.store_name} • انضممت {formatDay(c.joined_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-5 text-center">
                      <div>
                        <p className="tabular font-bold text-white">{formatNumber(c.my_qualified)}</p>
                        <p className="text-[11px] text-zinc-500">زيارة مؤهلة</p>
                      </div>
                      <div>
                        <p className="tabular font-bold text-white">{rank ? `#${rank}` : "—"}</p>
                        <p className="text-[11px] text-zinc-500">
                          {c.status === "ended" ? "المركز النهائي" : "مركزي الحالي"}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
