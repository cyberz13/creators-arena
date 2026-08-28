"use client";

import { useState } from "react";

/** Copyable secret store-report link (shown only to the admin). */
export function ReportLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
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
    </div>
  );
}
