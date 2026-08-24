"use client";

import { reviewClickAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";

export function ReviewButtons({ clickId }: { clickId: string }) {
  return (
    <div className="flex gap-1.5">
      <ActionButton
        label="✓ اعتماد"
        variant="primary"
        onRun={() => reviewClickAction(clickId, "qualified", "مراجعة يدوية")}
      />
      <ActionButton
        label="✗ رفض"
        variant="destructive"
        onRun={() => reviewClickAction(clickId, "rejected", "مراجعة يدوية")}
      />
    </div>
  );
}
