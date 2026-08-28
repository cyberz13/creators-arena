"use client";

import { reviewClickAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";

/**
 * Context-aware review actions: a pending click can go either way; a
 * rejected click can only be overturned to qualified (re-rejecting it is
 * a no-op that used to look like a dead button).
 */
export function ReviewButtons({
  clickId,
  currentStatus,
}: {
  clickId: string;
  currentStatus: "pending_review" | "rejected";
}) {
  return (
    <div className="flex gap-1.5">
      <ActionButton
        label="✓ اعتماد"
        variant="primary"
        confirmText={
          currentStatus === "rejected"
            ? "قلب قرار النظام: ستُحتسب هذه الزيارة في الترتيب فورًا. متابعة؟"
            : undefined
        }
        onRun={() => reviewClickAction(clickId, "qualified", "مراجعة يدوية")}
      />
      {currentStatus === "pending_review" && (
        <ActionButton
          label="✗ رفض"
          variant="destructive"
          onRun={() => reviewClickAction(clickId, "rejected", "مراجعة يدوية")}
        />
      )}
    </div>
  );
}
