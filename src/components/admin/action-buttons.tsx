"use client";

import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Generic admin action button: optionally asks for a reason (and an extra
 * value like a date), confirms, then runs the server action.
 */
export function ActionButton({
  label,
  pendingLabel = "جارٍ التنفيذ...",
  confirmText,
  askReason = false,
  askValue,
  variant = "outline",
  size = "sm",
  onRun,
}: {
  label: string;
  pendingLabel?: string;
  confirmText?: string;
  askReason?: boolean;
  askValue?: { prompt: string; type: "datetime-local" };
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  onRun: (reason: string, value: string) => Promise<{ error: string | null } | void>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    let value = "";
    if (askValue) {
      const v = window.prompt(askValue.prompt + "\n(مثال: 2026-09-01T20:00)");
      if (v === null) return;
      value = v;
    }
    let reason = "";
    if (askReason) {
      const r = window.prompt("سبب الإجراء (يُسجل في سجل الإدارة):");
      if (r === null) return;
      reason = r;
    }
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const res = await onRun(reason, value);
      if (res && res.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant={variant} size={size} onClick={run} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {error && <span className="text-xs font-semibold text-red-400">{error}</span>}
    </span>
  );
}
