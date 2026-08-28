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

/**
 * Server-side device fingerprint: request signals + the client-side probe
 * from the JS challenge (screen/timezone/cores). Stable across incognito
 * sessions and network switches — the third dedup key.
 */
export function computeDeviceHash(signals: {
  userAgent: string;
  acceptLanguage: string | null;
  chUa: string | null;
  chPlatform: string | null;
  clientProbe: string | null;
}): string {
  const salt = process.env.IP_HASH_SALT ?? "tahaddi-dev-salt";
  const material = [
    signals.userAgent,
    signals.acceptLanguage ?? "",
    signals.chUa ?? "",
    signals.chPlatform ?? "",
    signals.clientProbe ?? "",
  ].join("|");
  return createHash("sha256").update(`device:${salt}:${material}`).digest("hex").slice(0, 32);
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
  deviceHash: string;
  userAgent: string;
  /** Real modern browsers send sec-fetch-* headers on navigations. */
  hasSecFetch: boolean;
  /** navigator.webdriver reported true by the JS challenge (Selenium/Puppeteer). */
  webdriver?: boolean;
  nowMs: number;
}

export interface Verdict {
  status: ClickStatus;
  reason: string | null;
}

/**
 * Fraud pipeline v2 (device-aware, CGNAT-fair):
 *  - repeats are keyed on session AND device (incognito won't shed the device)
 *  - a shared IP no longer rejects by itself: distinct devices behind Saudi
 *    carrier NAT each count, up to a per-IP daily device cap → then review
 *  - missing sec-fetch headers on a modern-browser UA → review, not reject
 */
export async function classifyClick(ctx: ClickContext): Promise<Verdict> {
  if (isBotUserAgent(ctx.userAgent)) return { status: "rejected", reason: "bot" };
  if (ctx.webdriver) return { status: "rejected", reason: "automation" };

  const perMinuteLimit = await getSetting("rate_limit_per_minute");
  const lastMinute = await countClicks(ctx.campaignId, "ip_hash", ctx.ipHash, ctx.nowMs - 60_000);
  if (lastMinute >= perMinuteLimit) return { status: "rejected", reason: "rate_limited" };

  const dedupWindowMs = (await getSetting("dedup_window_hours")) * 3_600_000;
  const since = ctx.nowMs - dedupWindowMs;
  if (await hasQualified(ctx.campaignId, "session_id", ctx.sessionId, since))
    return { status: "rejected", reason: "duplicate_session" };
  if (await hasQualified(ctx.campaignId, "device_hash", ctx.deviceHash, since))
    return { status: "rejected", reason: "duplicate_device" };

  // Network intelligence (cached during the interstitial): VPN / proxy / Tor
  // / non-relay datacenter egress goes to review — the IP alone never rejects.
  if (await getSetting("ip_intel_enabled")) {
    const risky = await one<{ risky: number }>(
      "SELECT risky FROM ip_intel WHERE ip_hash = ?",
      ctx.ipHash
    );
    if (risky?.risky) return { status: "pending_review", reason: "risky_ip" };
  }

  // CGNAT fairness: same IP is fine for distinct devices, up to a cap.
  const deviceCap = await getSetting("max_devices_per_ip_24h");
  const devicesOnIp = await countQualifiedDevicesOnIp(
    ctx.campaignId,
    ctx.ipHash,
    ctx.nowMs - 86_400_000
  );
  if (devicesOnIp >= deviceCap) return { status: "pending_review", reason: "ip_device_cap" };

  const reviewThreshold = await getSetting("review_threshold_24h");
  const last24h = await countClicks(ctx.campaignId, "ip_hash", ctx.ipHash, ctx.nowMs - 86_400_000);
  if (last24h >= reviewThreshold) return { status: "pending_review", reason: "high_volume_ip" };

  if (!ctx.hasSecFetch) return { status: "pending_review", reason: "missing_sec_fetch" };

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
  column: "ip_hash" | "session_id" | "device_hash",
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

async function countQualifiedDevicesOnIp(
  campaignId: string,
  ipHash: string,
  sinceMs: number
): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT COUNT(DISTINCT device_hash) AS c FROM clicks
     WHERE campaign_id = ? AND ip_hash = ? AND status = 'qualified' AND created_at >= ?`,
    campaignId,
    ipHash,
    sinceMs
  );
  return row?.c ?? 0;
}
