"use client";

import { setUserStatusAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";

export function StatusToggle({ userId, status }: { userId: string; status: string }) {
  return status === "active" ? (
    <ActionButton
      label="تعطيل الحساب"
      variant="destructive"
      askReason
      confirmText="سيمنع هذا الحساب من الدخول والمشاركة. متابعة؟"
      onRun={(reason) => setUserStatusAction(userId, "disabled", reason)}
    />
  ) : (
    <ActionButton
      label="إعادة تفعيل الحساب"
      variant="primary"
      askReason
      onRun={(reason) => setUserStatusAction(userId, "active", reason)}
    />
  );
}
