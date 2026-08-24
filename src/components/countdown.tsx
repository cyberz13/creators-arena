"use client";

import { useEffect, useState } from "react";

function parts(untilMs: number) {
  const diff = Math.max(0, untilMs - Date.now());
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1000),
    done: diff <= 0,
  };
}

export function Countdown({ endAt, compact = false }: { endAt: number; compact?: boolean }) {
  const [t, setT] = useState(() => parts(endAt));
  useEffect(() => {
    const iv = setInterval(() => setT(parts(endAt)), 1000);
    return () => clearInterval(iv);
  }, [endAt]);

  if (t.done)
    return <span className="text-sm font-bold text-red-400">انتهى الوقت</span>;

  if (compact) {
    return (
      <span className="tabular text-sm font-bold text-zinc-200" suppressHydrationWarning>
        {t.days > 0 ? `${t.days} يوم ` : ""}
        {String(t.hours).padStart(2, "0")}:{String(t.minutes).padStart(2, "0")}:
        {String(t.seconds).padStart(2, "0")}
      </span>
    );
  }

  const cells = [
    { v: t.days, l: "يوم" },
    { v: t.hours, l: "ساعة" },
    { v: t.minutes, l: "دقيقة" },
    { v: t.seconds, l: "ثانية" },
  ];
  return (
    <div className="flex gap-2" suppressHydrationWarning>
      {cells.map((c) => (
        <div
          key={c.l}
          className="grid min-w-14 place-items-center rounded-xl bg-[#1D1D24] px-2 py-2 text-white"
        >
          <span className="tabular text-xl font-bold">{String(c.v).padStart(2, "0")}</span>
          <span className="text-[10px] text-zinc-400">{c.l}</span>
        </div>
      ))}
    </div>
  );
}
