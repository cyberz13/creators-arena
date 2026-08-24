"use client";

import {
  cancelCampaignAction,
  endCampaignAction,
  extendCampaignAction,
  launchCampaignAction,
} from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";
import type { CampaignStatus } from "@/lib/types";

export function ManageButtons({ campaignId, status }: { campaignId: string; status: CampaignStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <ActionButton
          label="🚀 إطلاق الحملة"
          variant="primary"
          size="md"
          confirmText="سيتم إطلاق الحملة وتجميد الجوائز. متابعة؟"
          onRun={() => launchCampaignAction(campaignId)}
        />
      )}
      {(status === "active" || status === "scheduled") && (
        <>
          <ActionButton
            label="⏳ تمديد الحملة"
            askValue={{ prompt: "تاريخ النهاية الجديد:", type: "datetime-local" }}
            askReason
            onRun={(reason, value) => extendCampaignAction(campaignId, value, reason)}
          />
          <ActionButton
            label="🏁 إنهاء مبكر"
            askReason
            confirmText="سيتم إنهاء الحملة الآن وتجميد النتائج وتحديد الفائزين. متابعة؟"
            onRun={(reason) => endCampaignAction(campaignId, reason)}
          />
        </>
      )}
      {status !== "ended" && status !== "cancelled" && (
        <ActionButton
          label="إلغاء الحملة"
          variant="destructive"
          askReason
          confirmText="إلغاء الحملة نهائيًا بدون فائزين. متابعة؟"
          onRun={(reason) => cancelCampaignAction(campaignId, reason)}
        />
      )}
    </div>
  );
}
