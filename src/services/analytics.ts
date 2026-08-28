import { one, q } from "@/lib/db";

export interface AdminOverview {
  creators: number;
  activeCampaigns: number;
  endedCampaigns: number;
  totalClicks: number;
  qualifiedVisits: number;
  rejectedVisits: number;
  pendingVisits: number;
  uniqueVisitors: number;
  totalPrizeMoney: number;
  paidPrizeMoney: number;
  winners: number;
}

export async function adminOverview(): Promise<AdminOverview> {
  const [creatorsRow, activeRow, endedRow, clicks, uniqueRow, prizes, winnersRow] =
    await Promise.all([
      one<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'creator'"),
      one<{ c: number }>("SELECT COUNT(*) AS c FROM campaigns WHERE status = 'active'"),
      one<{ c: number }>("SELECT COUNT(*) AS c FROM campaigns WHERE status = 'ended'"),
      one<{ total: number; qualified: number; rejected: number; pending: number }>(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END), 0) AS qualified,
           COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
           COALESCE(SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END), 0) AS pending
         FROM clicks`
      ).then((r) => r!),
      one<{ c: number }>("SELECT COUNT(DISTINCT session_id) AS c FROM clicks"),
      one<{ total: number; paid: number }>(
        `SELECT COALESCE(SUM(CASE WHEN status != 'rejected' THEN amount ELSE 0 END),0) AS total,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END),0) AS paid
         FROM payouts`
      ).then((r) => r!),
      one<{ c: number }>("SELECT COUNT(*) AS c FROM campaign_participants WHERE is_winner = 1"),
    ]);
  const creators = creatorsRow!.c;
  const activeCampaigns = activeRow!.c;
  const endedCampaigns = endedRow!.c;
  const uniqueVisitors = uniqueRow!.c;
  const winners = winnersRow!.c;
  return {
    creators,
    activeCampaigns,
    endedCampaigns,
    totalClicks: clicks.total ?? 0,
    qualifiedVisits: clicks.qualified ?? 0,
    rejectedVisits: clicks.rejected ?? 0,
    pendingVisits: clicks.pending ?? 0,
    uniqueVisitors,
    totalPrizeMoney: prizes.total,
    paidPrizeMoney: prizes.paid,
    winners,
  };
}

export interface DailyPoint {
  day: string;
  clicks: number;
  qualified: number;
  rejected: number;
}

export async function dailyVisits(campaignId?: string, days = 30): Promise<DailyPoint[]> {
  const sinceDay = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  if (campaignId) {
    return q<DailyPoint>(
      `SELECT day, SUM(clicks) AS clicks, SUM(qualified) AS qualified, SUM(rejected) AS rejected
       FROM campaign_daily_stats WHERE campaign_id = ? AND day >= ?
       GROUP BY day ORDER BY day`,
      campaignId,
      sinceDay
    );
  }
  return q<DailyPoint>(
    `SELECT day, SUM(clicks) AS clicks, SUM(qualified) AS qualified, SUM(rejected) AS rejected
     FROM campaign_daily_stats WHERE day >= ?
     GROUP BY day ORDER BY day`,
    sinceDay
  );
}

export async function trafficSources(
  campaignId?: string
): Promise<{ source: string; count: number }[]> {
  if (campaignId) {
    return q(
      `SELECT source, COUNT(*) AS count FROM clicks
       WHERE campaign_id = ? AND status = 'qualified' GROUP BY source ORDER BY count DESC`,
      campaignId
    ) as Promise<{ source: string; count: number }[]>;
  }
  return q(
    `SELECT source, COUNT(*) AS count FROM clicks
     WHERE status = 'qualified' GROUP BY source ORDER BY count DESC`
  ) as Promise<{ source: string; count: number }[]>;
}

export async function topCreators(limit = 10) {
  return q<{
    user_id: string;
    username: string;
    name: string;
    qualified_total: number;
    wins: number;
    followers_count: number;
    category_name: string | null;
  }>(
    `SELECT p.user_id, cp.username, cp.name, cp.followers_count, cat.name_ar AS category_name,
       COALESCE(SUM(p.qualified_count),0) AS qualified_total,
       COALESCE(SUM(p.is_winner),0) AS wins
     FROM campaign_participants p
     JOIN creator_profiles cp ON cp.user_id = p.user_id
     LEFT JOIN categories cat ON cat.id = cp.category_id
     GROUP BY p.user_id, cp.username, cp.name, cp.followers_count, cat.name_ar
     ORDER BY qualified_total DESC, COALESCE(MAX(p.last_qualified_at), 9e15) ASC LIMIT ?`,
    limit
  );
}

/** Lightweight public aggregates for the marketing pages. */
export interface PublicStats {
  creators: number;
  endedCampaigns: number;
  qualifiedVisits: number;
  prizeMoney: number;
}

export async function publicStats(): Promise<PublicStats> {
  const row = (await one<{ creators: number; ended: number; qualified: number; prizes: number }>(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE role = 'creator') AS creators,
       (SELECT COUNT(*) FROM campaigns WHERE status = 'ended') AS ended,
       (SELECT COALESCE(SUM(qualified_count),0) FROM campaign_participants) AS qualified,
       (SELECT COALESCE(SUM(amount),0) FROM payouts WHERE status != 'rejected') AS prizes`
  ))!;
  return {
    creators: row.creators,
    endedCampaigns: row.ended,
    qualifiedVisits: row.qualified,
    prizeMoney: row.prizes,
  };
}

export async function topCampaigns(limit = 10) {
  return q<{
    id: string;
    title: string;
    store_name: string;
    status: string;
    qualified_total: number;
    participants: number;
  }>(
    `SELECT c.id, c.title, c.store_name, c.status,
       COALESCE(SUM(p.qualified_count),0) AS qualified_total,
       COUNT(p.id) AS participants
     FROM campaigns c
     LEFT JOIN campaign_participants p ON p.campaign_id = c.id
     GROUP BY c.id ORDER BY qualified_total DESC LIMIT ?`,
    limit
  );
}
