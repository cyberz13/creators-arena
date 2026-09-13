"use client";

import { approveCreatorAction, setParticipationStatusAction, setUserStatusAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";

/**
 * Three independent controls, each with a declared effect:
 *  - account status: disabled = cannot log in AND never scores or wins;
 *  - participation: suspended = can log in, but no visit counts and no prize;
 *  - approval: unapproved accounts can log in but cannot join campaigns.
 */
export function StatusToggle({
  userId,
  status,
  participation,
  approved,
}: {
  userId: string;
  status: string;
  participation: string;
  approved: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {!approved && (
        <ActionButton
          label="✅ اعتماد الحساب"
          variant="primary"
          confirmText="سيتمكن هذا الصانع من الانضمام للحملات. متابعة؟"
          onRun={() => approveCreatorAction(userId)}
        />
      )}
      {participation === "active" ? (
        <ActionButton
          label="⏸ تعليق المشاركة"
          askReason
          confirmText="سيبقى الحساب قادرًا على الدخول لكن لن تُحتسب له زيارات ولن يفوز بجوائز حتى الرفع. متابعة؟"
          onRun={(reason) => setParticipationStatusAction(userId, "suspended", reason)}
        />
      ) : (
        <ActionButton
          label="▶ رفع تعليق المشاركة"
          variant="primary"
          askReason
          onRun={(reason) => setParticipationStatusAction(userId, "active", reason)}
        />
      )}
      {status === "active" ? (
        <ActionButton
          label="تعطيل الحساب"
          variant="destructive"
          askReason
          confirmText="سيمنع هذا الحساب من الدخول، ولن تُحتسب له زيارات ولن يفوز. متابعة؟"
          onRun={(reason) => setUserStatusAction(userId, "disabled", reason)}
        />
      ) : (
        <ActionButton
          label="إعادة تفعيل الحساب"
          variant="primary"
          askReason
          onRun={(reason) => setUserStatusAction(userId, "active", reason)}
        />
      )}
    </div>
  );
}
