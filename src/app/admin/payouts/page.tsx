import Link from "next/link";
import { listPayouts } from "@/services/payouts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PAYOUT_LABELS } from "@/components/campaign-status";
import { PayoutButtons } from "./payout-buttons";
import { formatDate, formatNumber, formatSAR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "الجوائز" };

export default async function AdminPayoutsPage() {
  const payouts = await listPayouts();
  const totals = {
    pending: payouts.filter((p) => p.status === "pending").reduce((a, p) => a + p.amount, 0),
    approved: payouts.filter((p) => p.status === "approved").reduce((a, p) => a + p.amount, 0),
    paid: payouts.filter((p) => p.status === "paid").reduce((a, p) => a + p.amount, 0),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">الجوائز والمدفوعات</h1>
        <p className="mt-1 text-sm text-zinc-400">تحديث حالة صرف الجوائز يدويًا — كل تغيير يُسجل</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ["بانتظار الاعتماد", formatSAR(totals.pending), "text-amber-300"],
          ["معتمدة", formatSAR(totals.approved), "text-brand-300"],
          ["مدفوعة", formatSAR(totals.paid), "text-emerald-300"],
        ].map(([label, value, color]) => (
          <Card key={label} className="p-4 text-center">
            <p className={`tabular text-lg font-bold ${color}`}>{value}</p>
            <p className="mt-0.5 text-xs text-zinc-400">{label}</p>
          </Card>
        ))}
      </div>

      {payouts.length === 0 ? (
        <Card className="p-10 text-center text-zinc-400">لا جوائز بعد — تُنشأ تلقائيًا عند انتهاء الحملات.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-xs text-zinc-500">
                {["الفائز", "الحملة", "المركز", "المبلغ", "الحالة", "آخر تحديث", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-start font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {payouts.map((p) => {
                const label = PAYOUT_LABELS[p.status];
                return (
                  <tr key={p.id} className="hover:bg-white/5">
                    <td className="px-4 py-3">
                      <Link href={`/admin/creators/${p.user_id}`} className="font-bold text-white hover:text-brand-300">
                        @{p.username}
                      </Link>
                      <p className="text-xs text-zinc-500">{p.creator_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/campaigns/${p.campaign_id}`} className="text-zinc-300 hover:text-brand-300">
                        {p.campaign_title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {p.prize_rank === 1 ? "🥇" : p.prize_rank === 2 ? "🥈" : p.prize_rank === 3 ? "🥉" : `#${p.prize_rank}`}
                    </td>
                    <td className="tabular px-4 py-3 font-bold text-amber-300">{formatSAR(p.amount)}</td>
                    <td className="px-4 py-3"><Badge variant={label.variant}>{label.label}</Badge></td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {p.updated_at ? formatDate(p.updated_at) : formatDate(p.created_at)}
                    </td>
                    <td className="px-4 py-3"><PayoutButtons payoutId={p.id} status={p.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-white/[0.06] px-4 py-2 text-xs text-zinc-500">
            {formatNumber(payouts.length)} سجل
          </p>
        </Card>
      )}
    </div>
  );
}
