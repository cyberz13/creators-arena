"use client";

import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Generic admin action button: optionally asks for a reason (and an extra
 * value like a date or the admin's password for re-authentication), confirms,
 * then runs the server action.
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
  askValue?: { prompt: string; type: "datetime-local" | "password" | "text" };
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  onRun: (reason: string, value: string) => Promise<{ error: string | null } | void>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askingPassword, setAskingPassword] = useState(false);
  const [password, setPassword] = useState("");

  function execute(value: string) {
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
      else {
        setAskingPassword(false);
        setPassword("");
      }
    });
  }

  function run() {
    if (askValue?.type === "password") {
      setAskingPassword(true);
      return;
    }
    let value = "";
    if (askValue) {
      const hint = askValue.type === "datetime-local" ? "\n(مثال: 2026-09-01T20:00)" : "";
      const v = window.prompt(askValue.prompt + hint);
      if (v === null) return;
      value = v;
    }
    execute(value);
  }

  return (
    <span className="inline-flex flex-col gap-1">
      {askingPassword ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            execute(password);
          }}
        >
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={askValue?.prompt}
            className="h-8 w-44 rounded-lg border border-white/15 bg-black/30 px-2 text-xs text-white"
            required
          />
          <Button type="submit" variant={variant} size={size} disabled={pending}>
            {pending ? pendingLabel : "تأكيد"}
          </Button>
          <Button type="button" variant="outline" size={size} onClick={() => setAskingPassword(false)}>
            إلغاء
          </Button>
        </form>
      ) : (
        <Button variant={variant} size={size} onClick={run} disabled={pending}>
          {pending ? pendingLabel : label}
        </Button>
      )}
      {error && <span className="text-xs font-semibold text-red-400">{error}</span>}
    </span>
  );
}
