import Link from "next/link";
import { Banknote, CheckCircle2, Eye, Megaphone, MousePointerClick, Trophy, Users, XCircle } from "lucide-react";
import { adminOverview, dailyVisits, topCampaigns, topCreators, trafficSources } from "@/services/analytics";
import { sweepLifecycles } from "@/services/campaigns";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyVisitsChart, SourcesChart, TopBarChart } from "@/components/charts";
import { formatNumber, formatSAR } from "@/lib/utils";
import { CampaignStatusBadge } from "@/components/campaign-status";
import type { CampaignStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "لوحة الإدارة" };

export default async function AdminHome() {
  await sweepLifecycles();
  const [o, daily, sources, creators, campaigns] = await Promise.all([
    adminOverview(),
    dailyVisits(undefined, 30),
    trafficSources(),
    topCreators(8),
    topCampaigns(8),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">نظرة عامة</h1>
          <p className="mt-1 text-sm text-zinc-400">أداء المنصة بالكامل</p>
        </div>
        <Link
          href="/admin/campaigns/new"
          className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          + إنشاء حملة
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="صناع المحتوى" value={formatNumber(o.creators)} icon={<Users className="size-5" />} />
        <StatCard label="الحملات النشطة" value={formatNumber(o.activeCampaigns)} hint={`${formatNumber(o.endedCampaigns)} منتهية`} icon={<Megaphone className="size-5" />} accent="green" />
        <StatCard label="إجمالي النقرات" value={formatNumber(o.totalClicks)} hint={`${formatNumber(o.uniqueVisitors)} زائر فريد`} icon={<MousePointerClick className="size-5" />} accent="slate" />
        <StatCard label="زيارات مؤهلة" value={formatNumber(o.qualifiedVisits)} icon={<CheckCircle2 className="size-5" />} accent="green" />
        <StatCard label="زيارات مرفوضة" value={formatNumber(o.rejectedVisits)} hint={`${formatNumber(o.pendingVisits)} قيد المراجعة`} icon={<XCircle className="size-5" />} accent="red" />
        <StatCard label="إجمالي الجوائز" value={formatSAR(o.totalPrizeMoney)} hint={`${formatSAR(o.paidPrizeMoney)} مدفوعة`} icon={<Banknote className="size-5" />} accent="gold" />
        <StatCard label="الفائزون" value={formatNumber(o.winners)} icon={<Trophy className="size-5" />} accent="gold" />
        <StatCard label="نسبة التأهيل" value={o.totalClicks > 0 ? `${Math.round((o.qualifiedVisits / o.totalClicks) * 100)}%` : "—"} icon={<Eye className="size-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>الزيارات اليومية (آخر 30 يوم)</CardTitle></CardHeader>
          <CardContent><DailyVisitsChart data={daily} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>مصادر الزيارات</CardTitle></CardHeader>
          <CardContent><SourcesChart data={sources} /></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>أفضل صناع المحتوى</CardTitle></CardHeader>
          <CardContent>
            <TopBarChart data={creators.map((c) => ({ label: `@${c.username}`, value: c.qualified_total }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>أفضل الحملات</CardTitle></CardHeader>
          <CardContent className="divide-y divide-white/5">
            {campaigns.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">لا توجد حملات بعد</p>}
            {campaigns.map((c) => (
              <Link key={c.id} href={`/admin/campaigns/${c.id}`} className="flex items-center justify-between py-2.5 hover:bg-white/5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{c.title}</p>
                  <p className="text-xs text-zinc-500">{c.store_name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <CampaignStatusBadge status={c.status as CampaignStatus} />
                  <span className="tabular text-sm font-bold text-zinc-300">{formatNumber(c.qualified_total)}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
