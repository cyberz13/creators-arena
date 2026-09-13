import Link from "next/link";
import { listClicksForReview } from "@/services/tracking";
import { q } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewButtons } from "./review-buttons";
import { cn, formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "مراجعة الزيارات" };

const REASON_LABELS: Record<string, string> = {
  bot: "Bot",
  rate_limited: "ضغط متكرر سريع",
  duplicate_session: "جلسة مكررة",
  duplicate_device: "جهاز مكرر",
  duplicate_ip: "IP مكرر",
  ip_device_cap: "تجاوز حد الأجهزة لنفس الشبكة",
  high_volume_ip: "حجم مرتفع من نفس المصدر",
  missing_sec_fetch: "متصفح بلا بصمة تصفح",
  automation: "متصفح مؤتمت (Selenium/Puppeteer)",
  risky_ip: "شبكة مشبوهة (VPN / مركز بيانات)",
  ip_unverified: "بانتظار فحص الشبكة",
  ineligible: "مشارك غير مؤهل (معلّق/مستبعد)",
  campaign_inactive: "حملة غير نشطة",
  admin_rejected: "رفض إداري",
};

export default async function AdminClicksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { tab, page } = await searchParams;
  const activeTab = tab === "rejected" ? "rejected" : "pending_review";
  const pageNum = Math.max(1, Number(page) || 1);
  const result = await listClicksForReview(activeTab, pageNum, 100);
  const clicks = result.rows;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  // Which of the listed campaigns already have FINAL results (reviews become corrections).
  const campaignIds = [...new Set(clicks.map((k) => k.campaign_id))];
  const finalIds = new Set<string>();
  if (campaignIds.length > 0) {
    const rows = await q<{ id: string }>(
      `SELECT id FROM campaigns WHERE results_status = 'final' AND id IN (${campaignIds.map(() => "?").join(",")})`,
      ...campaignIds
    );
    for (const r of rows) finalIds.add(r.id);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">مراجعة الزيارات</h1>
        <p className="mt-1 text-sm text-zinc-400">
          الزيارات المشبوهة تنتظر قرارك — الاعتماد يضيفها للترتيب فورًا
        </p>
      </div>

      <div className="flex gap-2">
        {[
          { key: "pending_review", label: "قيد المراجعة" },
          { key: "rejected", label: "المرفوضة" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/admin/clicks?tab=${t.key}`}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold",
              activeTab === t.key ? "bg-brand-600 text-white" : "border border-white/15 bg-surface text-zinc-400"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {clicks.length === 0 ? (
        <Card className="p-10 text-center text-zinc-400">
          {activeTab === "pending_review" ? "🎉 لا زيارات بانتظار المراجعة" : "لا زيارات مرفوضة"}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-xs text-zinc-500">
                {["الوقت", "الحملة", "Creator", "السبب", "المدينة", "IP Hash", "المصدر", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-start font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {clicks.map((k) => (
                <tr key={k.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-xs text-zinc-400">{formatDate(k.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/campaigns/${k.campaign_id}`} className="font-semibold text-zinc-200 hover:text-brand-300">
                      {k.campaign_title}
                    </Link>
                    {finalIds.has(k.campaign_id) && (
                      <span className="ms-1 text-[11px] text-amber-300">(نتائج مثبتة)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold">@{k.username}</td>
                  <td className="px-4 py-3">
                    <Badge variant={activeTab === "rejected" ? "danger" : "warning"}>
                      {REASON_LABELS[k.reject_reason ?? ""] ?? k.reject_reason ?? "—"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {k.geo_city ?? "—"}
                    {k.geo_country ? <span className="text-zinc-500"> ({k.geo_country})</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-zinc-500">{k.ip_hash.slice(0, 10)}…</code>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{k.source}</td>
                  <td className="px-4 py-3">
                    <ReviewButtons clickId={k.id} currentStatus={activeTab} resultsFinal={finalIds.has(k.campaign_id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-xs text-zinc-500">
            <span>
              {formatNumber(result.total)} زيارة — صفحة {result.page} من {pages}
            </span>
            <span className="flex gap-3">
              {result.page > 1 && (
                <Link className="font-semibold text-brand-400" href={`/admin/clicks?tab=${activeTab}&page=${result.page - 1}`}>
                  → السابقة
                </Link>
              )}
              {result.page < pages && (
                <Link className="font-semibold text-brand-400" href={`/admin/clicks?tab=${activeTab}&page=${result.page + 1}`}>
                  التالية ←
                </Link>
              )}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
