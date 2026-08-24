import Link from "next/link";
import { listClicksForReview } from "@/services/tracking";
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
  duplicate_ip: "IP مكرر",
  high_volume_ip: "حجم مرتفع من نفس المصدر",
  campaign_inactive: "حملة غير نشطة",
  admin_rejected: "رفض إداري",
};

export default async function AdminClicksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const activeTab = tab === "rejected" ? "rejected" : "pending_review";
  const clicks = await listClicksForReview(activeTab, 200);

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
              activeTab === t.key ? "bg-brand-600 text-white" : "border border-white/15 bg-[#17171C] text-zinc-400"
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
                {["الوقت", "الحملة", "Creator", "السبب", "IP Hash", "المصدر", ""].map((h) => (
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
                  </td>
                  <td className="px-4 py-3 font-semibold">@{k.username}</td>
                  <td className="px-4 py-3">
                    <Badge variant={activeTab === "rejected" ? "danger" : "warning"}>
                      {REASON_LABELS[k.reject_reason ?? ""] ?? k.reject_reason ?? "—"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-zinc-500">{k.ip_hash.slice(0, 10)}…</code>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{k.source}</td>
                  <td className="px-4 py-3"><ReviewButtons clickId={k.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-white/[0.06] px-4 py-2 text-xs text-zinc-500">
            {formatNumber(clicks.length)} زيارة معروضة (بحد أقصى 200)
          </p>
        </Card>
      )}
    </div>
  );
}
