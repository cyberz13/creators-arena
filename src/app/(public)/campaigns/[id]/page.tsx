import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, Store, Timer, Trophy, Users } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import {
  getCampaignWithStats,
  getPrizes,
  getTrackingLink,
} from "@/services/campaigns";
import { getLeaderboard } from "@/services/leaderboard";
import { listPayouts } from "@/services/payouts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CampaignStatusBadge } from "@/components/campaign-status";
import { Countdown } from "@/components/countdown";
import { CopyLink } from "@/components/copy-link";
import { JoinButton } from "@/components/join-button";
import { Leaderboard } from "@/components/leaderboard";
import { appUrl, formatNumber, formatSAR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANK_LABELS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس"];

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaignWithStats(id);
  if (!campaign || campaign.status === "draft") notFound();

  const user = await getSessionUser();
  const prizes = await getPrizes(id);
  const board = await getLeaderboard(id);
  const myLink = user?.role === "creator" ? await getTrackingLink(id, user.id) : undefined;
  const winners =
    campaign.status === "ended" ? (await listPayouts()).filter((p) => p.campaign_id === id) : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <Card className="overflow-hidden">
        <div className="relative bg-[#08080A] p-6 text-white sm:p-8">
          <div className="absolute inset-0 [background-image:radial-gradient(circle_at_15%_20%,rgba(139,92,246,0.4)_0,transparent_50%)]" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-white/20 text-zinc-300">
                <Store className="size-3" /> {campaign.store_name}
              </Badge>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl">🔥 {campaign.title}</h1>
            {campaign.description && (
              <p className="mt-2 max-w-2xl text-zinc-400">{campaign.description}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-x-reverse divide-white/5 border-t border-white/[0.06] sm:grid-cols-4">
          <div className="p-4 text-center">
            <Trophy className="mx-auto size-5 text-amber-500" />
            <p className="tabular mt-1 text-lg font-bold text-white">{formatSAR(campaign.prize_total)}</p>
            <p className="text-xs text-zinc-500">الجائزة</p>
          </div>
          <div className="p-4 text-center">
            <Users className="mx-auto size-5 text-brand-500" />
            <p className="tabular mt-1 text-lg font-bold text-white">{formatNumber(campaign.participants_count)}</p>
            <p className="text-xs text-zinc-500">المشاركون</p>
          </div>
          <div className="p-4 text-center">
            <Eye className="mx-auto size-5 text-emerald-500" />
            <p className="tabular mt-1 text-lg font-bold text-white">{formatNumber(campaign.qualified_total)}</p>
            <p className="text-xs text-zinc-500">زيارة مؤهلة</p>
          </div>
          <div className="p-4 text-center">
            <Timer className="mx-auto size-5 text-red-500" />
            <div className="mt-1 flex justify-center">
              {campaign.status === "active" || campaign.status === "scheduled" ? (
                <Countdown endAt={campaign.end_at} compact />
              ) : (
                <span className="text-lg font-bold text-white">انتهى</span>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {campaign.status === "scheduled" ? "تبدأ قريبًا" : "الوقت المتبقي"}
            </p>
          </div>
        </div>
      </Card>

      {/* Prize breakdown */}
      {prizes.length > 1 && (
        <Card className="mt-4 p-5">
          <p className="mb-3 font-bold text-white">🏆 توزيع الجوائز</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {prizes.map((p) => (
              <div key={p.rank} className="rounded-xl bg-amber-500/10 p-3 text-center">
                <p className="text-sm font-semibold text-amber-300">
                  المركز {RANK_LABELS[p.rank - 1] ?? `#${p.rank}`}
                </p>
                <p className="tabular text-xl font-bold text-amber-200">{formatSAR(p.amount)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Winners (ended) */}
      {campaign.status === "ended" && (
        <Card className="mt-4 border-2 border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-transparent p-6 text-center">
          <p className="text-3xl">🏆</p>
          <h2 className="mt-1 text-xl font-bold text-white">انتهت الحملة</h2>
          {winners.length > 0 ? (
            <div className="mx-auto mt-4 max-w-md space-y-2">
              {winners
                .sort((a, b) => a.prize_rank - b.prize_rank)
                .map((w) => (
                  <div key={w.id} className="flex items-center justify-between rounded-xl bg-[#17171C] p-3 shadow-sm">
                    <span className="font-bold text-white">
                      {w.prize_rank === 1 ? "🥇" : w.prize_rank === 2 ? "🥈" : "🥉"} @{w.username}
                    </span>
                    <span className="tabular font-bold text-amber-300">{formatSAR(w.amount)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-2 text-zinc-400">لم تُسجل زيارات مؤهلة في هذه الحملة.</p>
          )}
        </Card>
      )}

      {/* Participation box */}
      {campaign.status === "active" && (
        <Card className="mt-4 p-5">
          {!user ? (
            <div className="text-center">
              <p className="font-bold text-white">سجّل لتنافس على الجائزة</p>
              <p className="mt-1 text-sm text-zinc-400">التسجيل يستغرق أقل من دقيقة</p>
              <div className="mt-4 flex justify-center gap-3">
                <Link href="/register"><Button>انضم كصانع محتوى</Button></Link>
                <Link href="/login"><Button variant="outline">لدي حساب</Button></Link>
              </div>
            </div>
          ) : user.role === "admin" ? (
            <p className="text-center text-sm text-zinc-400">
              أنت مسجل كـ Admin — إدارة الحملة من <Link className="font-bold text-brand-400" href={`/admin/campaigns/${id}`}>لوحة التحكم</Link>.
            </p>
          ) : myLink ? (
            <div>
              <p className="mb-3 font-bold text-white">🔗 رابطك الخاص — انشره الآن</p>
              <CopyLink url={`${appUrl()}/go/${myLink.code}`} title={campaign.title} />
              <p className="mt-3 text-xs text-zinc-500">
                كل زيارة حقيقية عبر رابطك تُحتسب لك في الترتيب. الزيارات المكررة والوهمية لا تُحتسب.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="font-bold text-white">جاهز للمنافسة؟</p>
              <JoinButton campaignId={id} />
            </div>
          )}
        </Card>
      )}

      {/* How to participate */}
      {campaign.status === "active" && !myLink && (
        <Card className="mt-4 p-5">
          <p className="mb-3 font-bold text-white">كيف تشارك؟</p>
          <ol className="space-y-2">
            {["انضم للحملة", "انسخ رابطك الخاص", "شاركه مع جمهورك", "اجلب أكبر عدد من الزيارات", "تصدّر القائمة واربح 🏆"].map(
              (s, i) => (
                <li key={s} className="flex items-center gap-3 text-sm text-zinc-300">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-300">
                    {i + 1}
                  </span>
                  {s}
                </li>
              )
            )}
          </ol>
          {campaign.requirements && (
            <p className="mt-4 rounded-xl bg-white/5 p-3 text-sm text-zinc-400">
              <span className="font-bold">شروط المشاركة: </span>
              {campaign.requirements}
            </p>
          )}
        </Card>
      )}

      {/* Leaderboard */}
      <div className="mt-6">
        <h2 className="mb-3 text-xl font-bold text-white">🏆 Leaderboard</h2>
        <Leaderboard
          campaignId={id}
          initial={board}
          myUserId={user?.role === "creator" ? user.id : null}
          live={campaign.status === "active"}
        />
      </div>
    </div>
  );
}
