"use client";

import { confirmResultsAction, correctResultsAction, excludeParticipantAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";
import type { ResultsStatus } from "@/lib/types";

export function ResultsButtons({
  campaignId,
  resultsStatus,
  pendingClicks,
}: {
  campaignId: string;
  resultsStatus: ResultsStatus;
  pendingClicks: number;
}) {
  if (resultsStatus === "provisional") {
    return (
      <ActionButton
        label={pendingClicks > 0 ? `✅ تثبيت النتائج (${pendingClicks} زيارة قيد المراجعة)` : "✅ تثبيت النتائج"}
        variant="primary"
        size="md"
        confirmText="سيتم إعلان الفائزين وإتاحة اعتماد الجوائز. لا يمكن تعديل الزيارات بعدها إلا بتصحيح موثق. متابعة؟"
        onRun={() => confirmResultsAction(campaignId)}
      />
    );
  }
  if (resultsStatus === "final") {
    return (
      <ActionButton
        label="🛠 تصحيح النتائج (موثق)"
        askReason
        confirmText="سيُعاد اشتقاق الترتيب والاستحقاقات من الزيارات الحالية. الجوائز المدفوعة لا تتغير تلقائيًا. متابعة؟"
        onRun={(reason) => correctResultsAction(campaignId, reason)}
      />
    );
  }
  return null;
}

export function ExcludeButton({
  campaignId,
  userId,
  excluded,
}: {
  campaignId: string;
  userId: string;
  excluded: boolean;
}) {
  return excluded ? (
    <ActionButton
      label="إلغاء الاستبعاد"
      onRun={(reason) => excludeParticipantAction(campaignId, userId, false, reason || "إلغاء الاستبعاد")}
    />
  ) : (
    <ActionButton
      label="استبعاد من الحملة"
      variant="destructive"
      askReason
      confirmText="سيُحذف هذا المشارك من الترتيب والجوائز في هذه الحملة (يُسجَّل). متابعة؟"
      onRun={(reason) => excludeParticipantAction(campaignId, userId, true, reason)}
    />
  );
}
