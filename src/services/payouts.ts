import { execute, now, one, q, tx, txSerializeOn } from "@/lib/db";
import type { Payout, PayoutStatus } from "@/lib/types";
import { logAdminAction } from "./adminActions";
import { notify } from "./notifications";
import { DomainError } from "./errors";

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

/** `paid` is terminal: money that left the account is never "un-paid" by a status flip. */
const ALLOWED: Record<PayoutStatus, PayoutStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  paid: [],
  rejected: ["pending"],
};

export interface PayoutUpdateOptions {
  /** Set by the action layer after the admin re-entered their password (required for `paid`). */
  reauthenticated?: boolean;
}

/**
 * Atomic state transition:
 *  - read + validate inside the transaction, behind the payout's advisory lock;
 *  - conditional UPDATE on the previous status with an affected-row check, so
 *    two admins clicking at once cannot both "win";
 *  - audit row and notification are written in the same transaction (dedupe
 *    keys keep a retried request from double-notifying);
 *  - approving/paying requires confirmed (final) results.
 */
export async function updatePayoutStatus(
  payoutId: string,
  newStatus: PayoutStatus,
  adminId: string,
  reason = "",
  opts: PayoutUpdateOptions = {}
) {
  if (newStatus === "paid" && !opts.reauthenticated) {
    throw new DomainError("تأكيد الدفع يتطلب إعادة إدخال كلمة مرور الأدمن");
  }
  await tx(async () => {
    await txSerializeOn(`payout:${payoutId}`);
    const payout = await one<Payout>("SELECT * FROM payouts WHERE id = ?", payoutId);
    if (!payout) throw new DomainError("سجل الجائزة غير موجود");
    if (!ALLOWED[payout.status].includes(newStatus))
      throw new DomainError(`لا يمكن الانتقال من ${payout.status} إلى ${newStatus}`);
    if (newStatus === "approved" || newStatus === "paid") {
      const c = await one<{ results_status: string }>(
        "SELECT results_status FROM campaigns WHERE id = ?",
        payout.campaign_id
      );
      if (c?.results_status !== "final")
        throw new DomainError("ثبّت نتائج الحملة أولًا قبل اعتماد الجوائز أو صرفها");
    }
    const changed = await execute(
      "UPDATE payouts SET status = ?, updated_by = ?, updated_at = ? WHERE id = ? AND status = ?",
      newStatus,
      adminId,
      now(),
      payoutId,
      payout.status
    );
    if (changed !== 1) throw new DomainError("تغيرت حالة الجائزة أثناء المعالجة — أعد التحميل");
    await logAdminAction(adminId, `payout_${newStatus}`, "payout", payoutId, reason);
    if (newStatus === "approved") {
      await notify(
        payout.user_id,
        "prize_approved",
        "✅ تم اعتماد جائزتك",
        `جائزة بقيمة ${payout.amount} ريال قيد الصرف.`,
        payout.campaign_id,
        `payout_approved:${payoutId}`
      );
    } else if (newStatus === "paid") {
      await notify(
        payout.user_id,
        "prize_paid",
        "💰 تم دفع جائزتك",
        `تم تحويل ${payout.amount} ريال لك. مبروك!`,
        payout.campaign_id,
        `payout_paid:${payoutId}`
      );
    }
  });
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
