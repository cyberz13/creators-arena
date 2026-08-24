"use client";

import { updatePayoutAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";

export function PayoutButtons({ payoutId, status }: { payoutId: string; status: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "pending" && (
        <>
          <ActionButton label="اعتماد" variant="primary" onRun={() => updatePayoutAction(payoutId, "approved", "")} />
          <ActionButton label="رفض" variant="destructive" askReason onRun={(r) => updatePayoutAction(payoutId, "rejected", r)} />
        </>
      )}
      {status === "approved" && (
        <ActionButton
          label="💰 تم الدفع"
          variant="gold"
          confirmText="تأكيد أن الجائزة حُوّلت للفائز فعليًا؟"
          onRun={() => updatePayoutAction(payoutId, "paid", "")}
        />
      )}
      {status === "rejected" && (
        <ActionButton label="إعادة فتح" onRun={() => updatePayoutAction(payoutId, "pending", "إعادة فتح")} />
      )}
    </div>
  );
}
