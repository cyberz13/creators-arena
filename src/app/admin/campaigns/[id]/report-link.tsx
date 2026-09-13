"use client";

import { useState } from "react";
import { revokeReportTokenAction, rotateReportTokenAction } from "@/app/actions/admin";
import { ActionButton } from "@/components/admin/action-buttons";

/** Copyable secret store-report link with expiry, view count, rotate and revoke (admin only). */
export function ReportLink({
  campaignId,
  url,
  expiresInDays,
  views,
}: {
  campaignId: string;
  url: string;
  expiresInDays: number;
  views: number;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-xs text-zinc-400">تقرير المتجر:</span>
      <code dir="ltr" className="max-w-52 truncate text-xs text-zinc-300 sm:max-w-80">
        {url}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard unavailable */
          }
        }}
        className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-brand-500"
      >
        {copied ? "✓ نُسخ" : "نسخ"}
      </button>
      <span className="text-[11px] text-zinc-500">
        صالح {expiresInDays} يومًا · {views} مشاهدة
      </span>
      <ActionButton
        label="تدوير الرابط"
        confirmText="سيتوقف الرابط الحالي فورًا ويُنشأ رابط جديد صالح 90 يومًا. متابعة؟"
        onRun={() => rotateReportTokenAction(campaignId)}
      />
      <ActionButton
        label="إلغاء الرابط"
        variant="destructive"
        confirmText="سيتوقف الرابط ولن يكون هناك رابط حتى تنشئ واحدًا جديدًا. متابعة؟"
        onRun={(reason) => revokeReportTokenAction(campaignId, reason)}
      />
    </div>
  );
}
