import { listAdminActions } from "@/services/adminActions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "سجل الإجراءات" };

const ACTION_LABELS: Record<string, string> = {
  campaign_create_launch: "إنشاء وإطلاق حملة",
  campaign_create_draft: "إنشاء مسودة حملة",
  campaign_update_draft: "تعديل مسودة",
  campaign_launch: "إطلاق حملة",
  campaign_end_early: "إنهاء مبكر",
  campaign_cancel: "إلغاء حملة",
  campaign_extend: "تمديد حملة",
  user_disable: "تعطيل حساب",
  user_enable: "تفعيل حساب",
  click_review_qualified: "اعتماد زيارة",
  click_review_rejected: "رفض زيارة",
  payout_approved: "اعتماد جائزة",
  payout_paid: "دفع جائزة",
  payout_rejected: "رفض جائزة",
  payout_pending: "إعادة فتح جائزة",
};

export default async function AdminActionsPage() {
  const actions = await listAdminActions(200);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">سجل الإجراءات الإدارية</h1>
        <p className="mt-1 text-sm text-zinc-400">كل تدخل إداري مسجل هنا للمساءلة والشفافية</p>
      </div>
      {actions.length === 0 ? (
        <Card className="p-10 text-center text-zinc-400">لا إجراءات بعد</Card>
      ) : (
        <Card className="divide-y divide-white/5">
          {actions.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="brand">{ACTION_LABELS[a.action] ?? a.action}</Badge>
                  <span className="text-xs text-zinc-500">{a.target_type} • {a.target_id.slice(0, 8)}…</span>
                </div>
                {a.reason && <p className="mt-1 text-sm text-zinc-400">السبب: {a.reason}</p>}
              </div>
              <p className="text-xs text-zinc-500">{formatDate(a.created_at)}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
