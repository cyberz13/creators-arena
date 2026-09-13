import { randomBytes } from "node:crypto";
import { execute, hourOfDayRiyadhExpr, now, one, q, run } from "@/lib/db";
import { DomainError } from "./errors";
import { logAdminAction } from "./adminActions";
import type { Campaign } from "@/lib/types";
import { dailyVisits, trafficSources, type DailyPoint } from "./analytics";

/**
 * The store-facing campaign report: a secret, no-account link the admin sends
 * to the store owner. Proves verified reach — visits, unique devices, cities,
 * sources, peak hours — plus how much fraud the platform blocked for them.
 */

export const REPORT_TOKEN_TTL_MS = 90 * 86_400_000;

export interface ReportLinkInfo {
  token: string;
  expiresAt: number;
  views: number;
  lastViewedAt: number | null;
}

/** Issues a token on first use (90-day validity). Returns the current link state. */
export async function ensureReportToken(campaignId: string): Promise<ReportLinkInfo> {
  const row = await one<{ report_token: string | null; report_token_expires_at: number | null; report_views: number; report_last_viewed_at: number | null }>(
    "SELECT report_token, report_token_expires_at, report_views, report_last_viewed_at FROM campaigns WHERE id = ?",
    campaignId
  );
  if (!row) throw new DomainError("الحملة غير موجودة");
  if (row.report_token && row.report_token_expires_at) {
    return { token: row.report_token, expiresAt: Number(row.report_token_expires_at), views: Number(row.report_views ?? 0), lastViewedAt: row.report_last_viewed_at === null ? null : Number(row.report_last_viewed_at) };
  }
  const token = randomBytes(16).toString("hex");
  const expiresAt = now() + REPORT_TOKEN_TTL_MS;
  await run(
    "UPDATE campaigns SET report_token = ?, report_token_expires_at = ?, report_views = 0, report_last_viewed_at = NULL WHERE id = ?",
    token,
    expiresAt,
    campaignId
  );
  return { token, expiresAt, views: 0, lastViewedAt: null };
}

/** Rotation: the old link stops working immediately; the new one is valid 90 days. Logged. */
export async function rotateReportToken(campaignId: string, adminId: string): Promise<ReportLinkInfo> {
  const token = randomBytes(16).toString("hex");
  const expiresAt = now() + REPORT_TOKEN_TTL_MS;
  const changed = await execute(
    "UPDATE campaigns SET report_token = ?, report_token_expires_at = ?, report_views = 0, report_last_viewed_at = NULL WHERE id = ?",
    token,
    expiresAt,
    campaignId
  );
  if (changed !== 1) throw new DomainError("الحملة غير موجودة");
  await logAdminAction(adminId, "report_token_rotate", "campaign", campaignId);
  return { token, expiresAt, views: 0, lastViewedAt: null };
}

/** Revocation: no link until an admin issues a new one. Logged. */
export async function revokeReportToken(campaignId: string, adminId: string): Promise<void> {
  await run("UPDATE campaigns SET report_token = NULL, report_token_expires_at = NULL WHERE id = ?", campaignId);
  await logAdminAction(adminId, "report_token_revoke", "campaign", campaignId);
}

/** Resolves a public report link; expired or revoked tokens are unknown. Records the view. */
export async function getCampaignByReportToken(token: string): Promise<Campaign | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const c = await one<Campaign & { report_token_expires_at: number | null }>(
    "SELECT * FROM campaigns WHERE report_token = ?",
    token
  );
  if (!c) return null;
  if (!c.report_token_expires_at || Number(c.report_token_expires_at) <= now()) return null;
  await run(
    "UPDATE campaigns SET report_views = COALESCE(report_views, 0) + 1, report_last_viewed_at = ? WHERE id = ? AND report_token = ?",
    now(),
    c.id,
    token
  );
  return c;
}

export interface StoreReport {
  /** Epoch ms when the report data was assembled. */
  generatedAt: number;
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
    q<{ hour: number; n: number }>(
      `SELECT ${hourOfDayRiyadhExpr("created_at")} AS hour, COUNT(*) AS n
       FROM clicks WHERE campaign_id = ? AND status = 'qualified'
       GROUP BY ${hourOfDayRiyadhExpr("created_at")}`,
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
    const h = Number(t.hour);
    if (h >= 0 && h < 24) hours[h] = Number(t.n);
  }

  return {
    generatedAt: Date.now(),
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
