"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "./ui/button";

export function CopyLink({ url, title }: { url: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (http origin) — select fallback
      window.prompt("انسخ الرابط:", url);
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ url, title: title ?? "رابطي في تحدي" });
      } catch {
        /* user cancelled */
      }
    } else {
      copy();
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="tabular flex-1 truncate rounded-xl border border-dashed border-brand-500/40 bg-brand-500/10 px-3 py-2.5 text-sm font-semibold text-brand-200 ltr:text-left" dir="ltr">
        {url}
      </code>
      <div className="flex gap-2">
        <Button variant="secondary" size="md" onClick={copy} className="flex-1 sm:flex-none">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "تم النسخ" : "نسخ الرابط"}
        </Button>
        <Button variant="primary" size="md" onClick={share} className="flex-1 sm:flex-none">
          <Share2 className="size-4" />
          مشاركة
        </Button>
      </div>
    </div>
  );
}
