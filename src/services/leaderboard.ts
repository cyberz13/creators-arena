import { q } from "@/lib/db";
import type { LeaderboardEntry } from "@/lib/types";

/**
 * Ranking rule: most qualified visits wins; ties break in favor of whoever
 * reached their count first (earlier last_qualified_at), then earlier join.
 */
export async function getLeaderboard(campaignId: string, limit = 100): Promise<LeaderboardEntry[]> {
  const rows = await q<{
    user_id: string;
    username: string;
    name: string;
    avatar_url: string | null;
    qualified_count: number;
    last_qualified_at: number | null;
    is_winner: number;
  }>(
    `SELECT p.user_id, cp.username, cp.name, cp.avatar_url,
            p.qualified_count, p.last_qualified_at, p.is_winner
     FROM campaign_participants p
     JOIN creator_profiles cp ON cp.user_id = p.user_id
     WHERE p.campaign_id = ?
     ORDER BY p.qualified_count DESC,
              COALESCE(p.last_qualified_at, 9e15) ASC,
              p.joined_at ASC
     LIMIT ?`,
    campaignId,
    limit
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1, is_winner: r.is_winner === 1 }));
}

export interface MyPosition {
  rank: number;
  qualified_count: number;
  /** Visits needed to overtake the entry above (null when already #1). */
  gapToNext: number | null;
  nextUsername: string | null;
  totalParticipants: number;
}

export async function getMyPosition(campaignId: string, userId: string): Promise<MyPosition | null> {
  const board = await getLeaderboard(campaignId, 10_000);
  const idx = board.findIndex((e) => e.user_id === userId);
  if (idx === -1) return null;
  const me = board[idx];
  const above = idx > 0 ? board[idx - 1] : null;
  return {
    rank: me.rank,
    qualified_count: me.qualified_count,
    gapToNext: above ? above.qualified_count - me.qualified_count + 1 : null,
    nextUsername: above?.username ?? null,
    totalParticipants: board.length,
  };
}

/** Current #1 user id, or null when the board is empty / all zero. */
export async function currentLeader(campaignId: string): Promise<string | null> {
  const top = (await getLeaderboard(campaignId, 1))[0];
  return top && top.qualified_count > 0 ? top.user_id : null;
}
