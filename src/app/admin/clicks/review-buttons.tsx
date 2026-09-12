"use client";

import { reviewClickAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";

/**
 * Context-aware review actions: a pending click can go either way; a
 * rejected click can only be overturned to qualified. When the campaign's
 * results are already FINAL the buttons switch to a logged correction that
 * requires a written reason.
 */
export function ReviewButtons({
  clickId,
  currentStatus,
  resultsFinal = false,
}: {
  clickId: string;
  currentStatus: "pending_review" | "rejected";
  resultsFinal?: boolean;
}) {
  const suffix = resultsFinal ? " (تصحيح)" : "";
  return (
    <div className="flex gap-1.5">
      <ActionButton
        label={"✓ اعتماد" + suffix}
        variant="primary"
        askReason={resultsFinal}
        confirmText={
          resultsFinal
            ? "نتائج هذه الحملة مثبتة: سيُعاد اشتقاق الترتيب والاستحقاقات ويُسجَّل التصحيح. متابعة؟"
            : currentStatus === "rejected"
              ? "قلب قرار النظام: ستُحتسب هذه الزيارة في الترتيب فورًا. متابعة؟"
              : undefined
        }
        onRun={(reason) => reviewClickAction(clickId, "qualified", reason || "مراجعة يدوية", resultsFinal)}
      />
      {currentStatus === "pending_review" && (
        <ActionButton
          label={"✗ رفض" + suffix}
          variant="destructive"
          askReason={resultsFinal}
          confirmText={resultsFinal ? "تصحيح موثق على نتائج مثبتة. متابعة؟" : undefined}
          onRun={(reason) => reviewClickAction(clickId, "rejected", reason || "مراجعة يدوية", resultsFinal)}
        />
      )}
    </div>
  );
}
