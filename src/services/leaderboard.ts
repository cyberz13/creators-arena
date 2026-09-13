import { q } from "@/lib/db";
import type { LeaderboardEntry } from "@/lib/types";

/**
 * Ranking rule (the single source of truth, also used for final results):
 *   1. most qualified visits;
 *   2. tie → whoever REACHED that count first: `last_qualified_at` is the
 *      time the participant's latest qualified visit occurred (re-derived from
 *      the click log whenever a review changes a click), so a late approval
 *      of an old visit cannot jump the queue;
 *   3. still tied → earlier join.
 *
 * Eligibility is enforced here, not in the UI: a disabled account, a creator
 * whose participation is suspended, or a participant excluded from this
 * campaign never appears in standings, never ranks and never wins.
 */
const STANDINGS_SQL = `
  SELECT p.id AS participant_id, p.user_id, cp.username, cp.name, cp.avatar_url,
         p.qualified_count, p.last_qualified_at, p.is_winner, p.joined_at
  FROM campaign_participants p
  JOIN creator_profiles cp ON cp.user_id = p.user_id
  JOIN users u ON u.id = p.user_id
  WHERE p.campaign_id = ?
    AND p.excluded = 0
    AND u.status = 'active'
    AND u.participation_status = 'active'
  ORDER BY p.qualified_count DESC,
           COALESCE(p.last_qualified_at, 9e15) ASC,
           p.joined_at ASC`;

interface StandingRow {
  participant_id: string;
  user_id: string;
  username: string;
  name: string;
  avatar_url: string | null;
  qualified_count: number;
  last_qualified_at: number | null;
  is_winner: number;
  joined_at: number;
}

export interface StandingEntry extends LeaderboardEntry {
  participant_id: string;
}

/** Complete, eligible-only standings — used for finalization (no display limit). */
export async function getStandings(campaignId: string): Promise<StandingEntry[]> {
  const rows = await q<StandingRow>(STANDINGS_SQL, campaignId);
  return rows.map((r, i) => ({
    participant_id: r.participant_id,
    user_id: r.user_id,
    username: r.username,
    name: r.name,
    avatar_url: r.avatar_url,
    qualified_count: Number(r.qualified_count),
    last_qualified_at: r.last_qualified_at === null ? null : Number(r.last_qualified_at),
    rank: i + 1,
    is_winner: Number(r.is_winner) === 1,
  }));
}

/** Display board (limited). Same ordering and eligibility as the standings. */
export async function getLeaderboard(campaignId: string, limit = 100): Promise<LeaderboardEntry[]> {
  const rows = await q<StandingRow>(STANDINGS_SQL + " LIMIT ?", campaignId, limit);
  return rows.map((r, i) => ({
    user_id: r.user_id,
    username: r.username,
    name: r.name,
    avatar_url: r.avatar_url,
    qualified_count: Number(r.qualified_count),
    last_qualified_at: r.last_qualified_at === null ? null : Number(r.last_qualified_at),
    rank: i + 1,
    is_winner: Number(r.is_winner) === 1,
  }));
}

/**
 * Public DTO: what anonymous visitors and the polling API may see. No internal
 * ids, no timestamps, no e-mail — `username` is the public identifier.
 */
export interface PublicBoardEntry {
  rank: number;
  username: string;
  name: string;
  avatar_url: string | null;
  qualified_count: number;
  is_winner: boolean;
}

export function toPublicBoard(entries: LeaderboardEntry[]): PublicBoardEntry[] {
  return entries.map((e) => ({
    rank: e.rank,
    username: e.username,
    name: e.name,
    avatar_url: e.avatar_url,
    qualified_count: e.qualified_count,
    is_winner: e.is_winner === true,
  }));
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
  const board = await getStandings(campaignId);
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
