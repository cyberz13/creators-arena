"use client";

import { useEffect, useRef, useState } from "react";
import type { LeaderboardEntry } from "@/lib/types";
import { SpotCard } from "./spot-card";

/**
 * Hero live-leaderboard card (Nocturne design), fed by the real campaign
 * board and polling the public API — no fake increments.
 */
export function LiveBoard({
  campaignId,
  campaignTitle,
  initial,
}: {
  campaignId: string | null;
  campaignTitle: string;
  initial: LeaderboardEntry[];
}) {
  const [board, setBoard] = useState(initial.slice(0, 4));
  const [delta, setDelta] = useState<number | null>(null);
  const totalRef = useRef(initial.reduce((a, e) => a + e.qualified_count, 0));

  useEffect(() => {
    if (!campaignId) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/leaderboard`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { board: LeaderboardEntry[] };
        const fresh = data.board.slice(0, 4);
        const total = data.board.reduce((a, e) => a + e.qualified_count, 0);
        if (total > totalRef.current) setDelta(total - totalRef.current);
        totalRef.current = total;
        setBoard(fresh);
      } catch {
        /* transient network error — keep last board */
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [campaignId]);

  const top = Math.max(1, ...board.map((e) => e.qualified_count));
  const gap = board.length >= 2 ? board[0].qualified_count - board[1].qualified_count : null;

  return (
    <SpotCard className="rounded-2xl bg-surface p-5 shadow-[0_0_0_1px_#595d6c,0_6px_18px_rgba(0,0,0,0.55)] sm:p-6">
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div dir="ltr" className="text-right text-[10px] uppercase tracking-[0.14em] text-brand-500">
            LIVE LEADERBOARD
          </div>
          <div className="mt-1.5 text-[17px] font-semibold text-[#e9e9ed]">{campaignTitle}</div>
        </div>
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-[11px] text-zinc-400">
          <span className="size-1.5 rounded-full bg-brand-500 [animation:pulseDot_2s_ease-out_infinite]" />
          يُحدَّث الآن
        </span>
      </div>

      <div className="relative mt-5 flex flex-col gap-0.5">
        {board.length === 0 && (
          <p className="py-6 text-center text-sm text-zinc-500">كن أول المنافسين في هذا التحدي</p>
        )}
        {board.map((r, i) => {
          const me = false;
          const pct = Math.round((r.qualified_count / top) * 100);
          return (
            <div
              key={r.user_id}
              className="grid grid-cols-[26px_1fr_auto] items-center gap-x-3 gap-y-2 rounded-lg px-2.5 py-3"
              style={{ background: me ? "#2b2741" : "transparent" }}
            >
              <span className={`num text-center text-[13px] font-semibold ${i === 0 ? "text-brand-300" : "text-zinc-500"}`}>
                {i + 1}
              </span>
              <span dir="ltr" className="truncate text-right text-sm text-zinc-300">
                @{r.username}
              </span>
              <span className="num text-[14.5px] font-semibold text-[#e9e9ed]">
                {r.qualified_count.toLocaleString("en-US")}
              </span>
              <span className="col-start-2 col-span-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                <span
                  className="block h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${pct}%`, background: i === 0 ? "#9184d9" : "#75798c" }}
                />
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-[var(--divider)] pt-4">
        <span className="text-[12.5px] text-zinc-400">
          {gap != null && gap > 0 ? (
            <>
              الصدارة متقدمة بـ<span className="num font-semibold text-[#e9e9ed]"> {gap.toLocaleString("en-US")} </span>زيارة
            </>
          ) : (
            "المنافسة على أشدّها الآن"
          )}
        </span>
        <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-brand-900 px-3 py-1.5 text-xs text-brand-200">
          <span className="size-[5px] rounded-full bg-brand-500 [animation:pulseDot_2s_ease-out_infinite]" />
          {delta != null ? (
            <>
              +<span className="num">{delta}</span> منذ آخر تحديث
            </>
          ) : (
            "بيانات حقيقية"
          )}
        </span>
      </div>
    </SpotCard>
  );
}
