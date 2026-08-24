import Link from "next/link";
import { Eye, Medal, Megaphone, Wallet } from "lucide-react";
import { requireCreator } from "@/lib/auth";
import { creatorHomeStats } from "@/services/creators";
import { listActiveCampaigns, listMyCampaigns } from "@/services/campaigns";
import { getMyPosition } from "@/services/leaderboard";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { CampaignCard } from "@/components/campaign-card";
import { CopyLink } from "@/components/copy-link";
import { appUrl, formatNumber, formatRemaining, formatSAR } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CreatorHome() {
  const user = await requireCreator();
  const stats = await creatorHomeStats(user.id);
  const myCampaigns = await listMyCampaigns(user.id);
  const myActive = await Promise.all(
    myCampaigns
      .filter((c) => c.status === "active")
      .map(async (c) => ({ ...c, position: await getMyPosition(c.id, user.id) }))
  );
  const joinedIds = new Set(myCampaigns.map((c) => c.id));
  const available = (await listActiveCampaigns("newest")).filter((c) => !joinedIds.has(c.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          أهلًا {user.profile?.name?.split(" ")[0]} 👋
        </h1>
        <p className="mt-1 text-sm text-zinc-400">جاهز تتصدر اليوم؟</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="أرباحي" value={formatSAR(stats.totalPrizes)} hint={stats.paidPrizes > 0 ? `${formatSAR(stats.paidPrizes)} مدفوعة` : undefined} icon={<Wallet className="size-5" />} accent="gold" />
        <StatCard label="الحملات النشطة" value={formatNumber(stats.activeCampaigns)} icon={<Megaphone className="size-5" />} accent="brand" />
        <StatCard label="إجمالي الزيارات" value={formatNumber(stats.totalQualified)} icon={<Eye className="size-5" />} accent="green" />
        <StatCard label="مرات الفوز" value={formatNumber(stats.wins)} icon={<Medal className="size-5" />} accent="gold" />
      </div>

      {/* My active campaigns with link + position */}
      {myActive.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">🔥 تحدياتك الجارية</h2>
          <div className="space-y-4">
            {myActive.map((c) => {
              const pos = c.position;
              return (
                <Card key={c.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link href={`/campaigns/${c.id}`} className="font-bold text-white hover:text-brand-300">
                        {c.title}
                      </Link>
                      <p className="mt-0.5 text-sm text-zinc-400">
                        {c.store_name} • ينتهي خلال {formatRemaining(c.end_at)} • الجائزة {formatSAR(c.prize_total)}
                      </p>
                    </div>
                    {pos && (
                      <div className="rounded-xl bg-brand-500/10 px-3 py-2 text-center">
                        <p className="tabular text-lg font-bold text-brand-300">#{pos.rank}</p>
                        <p className="text-[11px] text-brand-400">
                          {pos.rank === 1
                            ? "👑 المتصدر"
                            : pos.gapToNext != null
                              ? `${formatNumber(pos.gapToNext)} زيارة للتقدم`
                              : ""}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    <CopyLink url={`${appUrl()}/go/${c.tracking_code}`} title={c.title} />
                  </div>
                  <p className="tabular mt-2 text-sm text-zinc-400">
                    زياراتك المؤهلة: <span className="font-bold text-white">{formatNumber(c.my_qualified)}</span>
                  </p>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Available campaigns */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">التحديات المتاحة</h2>
          <Link href="/campaigns" className="text-sm font-bold text-brand-400 hover:text-brand-300">
            عرض الكل ←
          </Link>
        </div>
        {available.length === 0 ? (
          <Card className="p-8 text-center text-zinc-400">
            {myActive.length > 0
              ? "أنت مشارك في كل التحديات المتاحة 💪"
              : "لا توجد تحديات متاحة حاليًا — سنعلمك عند إطلاق تحدٍّ جديد."}
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.slice(0, 6).map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
