import { now, one, q, run } from "@/lib/db";
import type { Payout, PayoutStatus } from "@/lib/types";
import { logAdminAction } from "./adminActions";
import { notify } from "./notifications";
import { DomainError } from "./campaigns";

export interface PayoutRow extends Payout {
  username: string;
  creator_name: string;
  campaign_title: string;
}

export async function listPayouts(status?: PayoutStatus): Promise<PayoutRow[]> {
  const where = status ? "WHERE po.status = ?" : "";
  const params = status ? [status] : [];
  return q<PayoutRow>(
    `SELECT po.*, cp.username, cp.name AS creator_name, c.title AS campaign_title
     FROM payouts po
     JOIN creator_profiles cp ON cp.user_id = po.user_id
     JOIN campaigns c ON c.id = po.campaign_id
     ${where}
     ORDER BY po.created_at DESC`,
    ...params
  );
}

const ALLOWED: Record<PayoutStatus, PayoutStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  paid: [],
  rejected: ["pending"],
};

export async function updatePayoutStatus(
  payoutId: string,
  newStatus: PayoutStatus,
  adminId: string,
  reason = ""
) {
  const payout = await one<Payout>("SELECT * FROM payouts WHERE id = ?", payoutId);
  if (!payout) throw new DomainError("سجل الجائزة غير موجود");
  if (!ALLOWED[payout.status].includes(newStatus))
    throw new DomainError(`لا يمكن الانتقال من ${payout.status} إلى ${newStatus}`);
  await run(
    "UPDATE payouts SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?",
    newStatus,
    adminId,
    now(),
    payoutId
  );
  await logAdminAction(adminId, `payout_${newStatus}`, "payout", payoutId, reason);
  if (newStatus === "approved") {
    await notify(
      payout.user_id,
      "prize_approved",
      "✅ تم اعتماد جائزتك",
      `جائزة بقيمة ${payout.amount} ريال قيد الصرف.`,
      payout.campaign_id
    );
  } else if (newStatus === "paid") {
    await notify(
      payout.user_id,
      "prize_paid",
      "💰 تم دفع جائزتك",
      `تم تحويل ${payout.amount} ريال لك. مبروك!`,
      payout.campaign_id
    );
  }
}

export async function listMyPrizes(userId: string): Promise<PayoutRow[]> {
  return q<PayoutRow>(
    `SELECT po.*, cp.username, cp.name AS creator_name, c.title AS campaign_title
     FROM payouts po
     JOIN creator_profiles cp ON cp.user_id = po.user_id
     JOIN campaigns c ON c.id = po.campaign_id
     WHERE po.user_id = ?
     ORDER BY po.created_at DESC`,
    userId
  );
}
