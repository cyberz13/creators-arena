"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import type { LeaderboardEntry } from "@/lib/types";
import { Avatar } from "./avatar";
import { Card } from "./ui/card";
import { cn, formatNumber } from "@/lib/utils";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({
  campaignId,
  initial,
  myUserId,
  live = true,
  pollMs = 30_000,
}: {
  campaignId: string;
  initial: LeaderboardEntry[];
  myUserId?: string | null;
  live?: boolean;
  pollMs?: number;
}) {
  const [board, setBoard] = useState(initial);

  useEffect(() => {
    if (!live) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/leaderboard`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setBoard(data.board);
        }
      } catch {
        /* transient network error — keep last board */
      }
    }, pollMs);
    return () => clearInterval(iv);
  }, [campaignId, live, pollMs]);

  const myIdx = myUserId ? board.findIndex((e) => e.user_id === myUserId) : -1;
  const me = myIdx >= 0 ? board[myIdx] : null;
  const above = myIdx > 0 ? board[myIdx - 1] : null;

  return (
    <div className="space-y-3">
      {me && (
        <Card
          className={cn(
            "border-2 p-4",
            me.rank === 1 ? "border-amber-500/40 bg-amber-500/10" : "border-brand-500/30 bg-brand-500/10"
          )}
        >
          {me.rank === 1 ? (
            <div className="flex items-center gap-3">
              <Crown className="size-8 text-amber-500" />
              <div>
                <p className="font-bold text-amber-300">👑 أنت في المركز الأول!</p>
                <p className="text-sm text-amber-300">حافظ على الصدارة حتى نهاية الحملة.</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="font-bold text-brand-200">🔥 أنت الآن في المركز #{me.rank}</p>
              {above && (
                <p className="mt-0.5 text-sm text-brand-300">
                  تحتاج{" "}
                  <span className="tabular font-bold">
                    {formatNumber(above.qualified_count - me.qualified_count + 1)}
                  </span>{" "}
                  زيارة لتتجاوز <span className="font-semibold">@{above.username}</span>
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="divide-y divide-white/5 overflow-hidden">
        {board.length === 0 && (
          <p className="p-6 text-center text-sm text-zinc-400">
            لا يوجد مشاركون بعد — كن أول المنافسين!
          </p>
        )}
        {board.slice(0, 50).map((e) => (
          <div
            key={e.user_id}
            className={cn(
              "flex items-center gap-3 px-4 py-3",
              e.user_id === myUserId && "bg-brand-500/10",
              e.rank === 1 && "bg-gradient-to-l from-amber-500/10 to-transparent"
            )}
          >
            <span className="tabular w-8 shrink-0 text-center text-sm font-bold text-zinc-400">
              {e.rank <= 3 ? MEDALS[e.rank - 1] : `#${e.rank}`}
            </span>
            <Avatar name={e.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">@{e.username}</p>
              <p className="truncate text-xs text-zinc-400">{e.name}</p>
            </div>
            {e.is_winner && <span title="فائز">🏆</span>}
            <div className="text-end">
              <p className="tabular text-sm font-bold text-white">
                {formatNumber(e.qualified_count)}
              </p>
              <p className="text-[11px] text-zinc-500">زيارة مؤهلة</p>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
