import { createHash } from "node:crypto";
import { one } from "@/lib/db";
import { getSetting } from "./settings";
import type { ClickStatus, TrafficSource } from "@/lib/types";

const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|curl|wget|python-requests|httpie|axios|libwww|scrapy|headless|phantomjs|puppeteer|playwright|lighthouse|pingdom|monitor|facebookexternalhit|preview|whatsapp|telegrambot|go-http-client|okhttp|java\/|apache-httpclient/i;

export function isBotUserAgent(ua: string): boolean {
  if (!ua || ua.trim().length < 10) return true;
  return BOT_UA_PATTERN.test(ua);
}

/** Never store raw IPs — a salted SHA-256 hash is enough for dedup/rate limiting. */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "tahaddi-dev-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function detectSource(referer: string | null, utmSource: string | null): TrafficSource {
  const hint = `${utmSource ?? ""} ${referer ?? ""}`.toLowerCase();
  if (hint.includes("tiktok")) return "tiktok";
  if (hint.includes("instagram")) return "instagram";
  if (hint.includes("snapchat") || hint.includes("snap.com")) return "snapchat";
  if (!referer && !utmSource) return "direct";
  return "other";
}

export interface ClickContext {
  campaignId: string;
  ipHash: string;
  sessionId: string;
  userAgent: string;
  nowMs: number;
}

export interface Verdict {
  status: ClickStatus;
  reason: string | null;
}

/**
 * Initial fraud pipeline. Deliberately lenient: outright rejection only for
 * clear bots, floods, and same-visitor repeats; gray-zone volume goes to
 * pending_review for the admin to arbitrate.
 */
export async function classifyClick(ctx: ClickContext): Promise<Verdict> {
  if (isBotUserAgent(ctx.userAgent)) return { status: "rejected", reason: "bot" };

  const perMinuteLimit = await getSetting("rate_limit_per_minute");
  const lastMinute = await countClicks(ctx.campaignId, "ip_hash", ctx.ipHash, ctx.nowMs - 60_000);
  if (lastMinute >= perMinuteLimit) return { status: "rejected", reason: "rate_limited" };

  const dedupWindowMs = (await getSetting("dedup_window_hours")) * 3_600_000;
  const since = ctx.nowMs - dedupWindowMs;
  if (await hasQualified(ctx.campaignId, "session_id", ctx.sessionId, since))
    return { status: "rejected", reason: "duplicate_session" };
  if (await hasQualified(ctx.campaignId, "ip_hash", ctx.ipHash, since))
    return { status: "rejected", reason: "duplicate_ip" };

  const reviewThreshold = await getSetting("review_threshold_24h");
  const last24h = await countClicks(ctx.campaignId, "ip_hash", ctx.ipHash, ctx.nowMs - 86_400_000);
  if (last24h >= reviewThreshold) return { status: "pending_review", reason: "high_volume_ip" };

  return { status: "qualified", reason: null };
}

async function countClicks(
  campaignId: string,
  column: "ip_hash" | "session_id",
  value: string,
  sinceMs: number
): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM clicks WHERE campaign_id = ? AND ${column} = ? AND created_at >= ?`,
    campaignId,
    value,
    sinceMs
  );
  return row?.c ?? 0;
}

async function hasQualified(
  campaignId: string,
  column: "ip_hash" | "session_id",
  value: string,
  sinceMs: number
): Promise<boolean> {
  return !!(await one(
    `SELECT 1 FROM clicks
     WHERE campaign_id = ? AND ${column} = ? AND status = 'qualified' AND created_at >= ? LIMIT 1`,
    campaignId,
    value,
    sinceMs
  ));
}
