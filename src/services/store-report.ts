import { randomBytes } from "node:crypto";
import { one, q, run } from "@/lib/db";
import type { Campaign } from "@/lib/types";
import { dailyVisits, trafficSources, type DailyPoint } from "./analytics";

/**
 * The store-facing campaign report: a secret, no-account link the admin sends
 * to the store owner. Proves verified reach — visits, unique devices, cities,
 * sources, peak hours — plus how much fraud the platform blocked for them.
 */

export async function ensureReportToken(campaignId: string): Promise<string> {
  const row = await one<{ report_token: string | null }>(
    "SELECT report_token FROM campaigns WHERE id = ?",
    campaignId
  );
  if (row?.report_token) return row.report_token;
  const token = randomBytes(16).toString("hex");
  await run("UPDATE campaigns SET report_token = ? WHERE id = ?", token, campaignId);
  return token;
}

export async function getCampaignByReportToken(token: string): Promise<Campaign | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  return (
    (await one<Campaign>("SELECT * FROM campaigns WHERE report_token = ?", token)) ?? null
  );
}

export interface StoreReport {
  qualified: number;
  uniqueDevices: number;
  blocked: number; // rejected by the fraud pipeline
  pending: number;
  creators: number;
  daily: DailyPoint[];
  cities: { city: string; country: string | null; count: number }[];
  sources: { source: string; count: number }[];
  /** 24 buckets, Riyadh time (UTC+3), qualified visits per hour of day. */
  hours: number[];
  topCreators: { username: string; name: string; qualified_count: number }[];
}

export async function buildStoreReport(campaignId: string): Promise<StoreReport> {
  const [counts, participants, daily, sources, cities, times, topCreators] = await Promise.all([
    one<{ q: number; r: number; p: number; d: number }>(
      `SELECT
         SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS q,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS r,
         SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS p,
         COUNT(DISTINCT CASE WHEN status = 'qualified' THEN COALESCE(device_hash, id) END) AS d
       FROM clicks WHERE campaign_id = ?`,
      campaignId
    ),
    one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM campaign_participants WHERE campaign_id = ?",
      campaignId
    ),
    dailyVisits(campaignId, 90),
    trafficSources(campaignId),
    q<{ city: string; country: string | null; count: number }>(
      `SELECT geo_city AS city, geo_country AS country, COUNT(*) AS count
       FROM clicks
       WHERE campaign_id = ? AND status = 'qualified' AND geo_city IS NOT NULL
       GROUP BY geo_city, geo_country ORDER BY count DESC LIMIT 8`,
      campaignId
    ),
    q<{ created_at: number }>(
      "SELECT created_at FROM clicks WHERE campaign_id = ? AND status = 'qualified'",
      campaignId
    ),
    q<{ username: string; name: string; qualified_count: number }>(
      `SELECT cp.username, cp.name, p.qualified_count
       FROM campaign_participants p JOIN creator_profiles cp ON cp.user_id = p.user_id
       WHERE p.campaign_id = ? AND p.qualified_count > 0
       ORDER BY p.qualified_count DESC, p.last_qualified_at ASC LIMIT 5`,
      campaignId
    ),
  ]);

  const hours = new Array<number>(24).fill(0);
  for (const t of times) {
    hours[new Date(Number(t.created_at) + 3 * 3_600_000).getUTCHours()] += 1;
  }

  return {
    qualified: counts?.q ?? 0,
    uniqueDevices: counts?.d ?? 0,
    blocked: counts?.r ?? 0,
    pending: counts?.p ?? 0,
    creators: participants?.c ?? 0,
    daily,
    cities,
    sources,
    hours,
    topCreators,
  };
}
