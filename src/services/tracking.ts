import { execute, id, one, q, run, tx, txSerializeOn } from "@/lib/db";
import { dayKey } from "@/lib/utils";
import type { Click, ClickStatus, TrackingLink } from "@/lib/types";
import { classifyClick, detectSource } from "./fraud";
import { ensureLifecycle, getCampaign } from "./campaigns";
import { currentLeader } from "./leaderboard";
import { notify } from "./notifications";
import { logAdminAction } from "./adminActions";
import { DomainError } from "./errors";
import { campaignLockKey, notifyWinners, recomputeStandings, SYSTEM_ACTOR_ID, ensureSystemActor } from "./results";
import { getIpIntel } from "./ip-intel";

export interface IncomingClick {
  code: string;
  ipHash: string;
  sessionId: string;
  deviceHash: string;
  userAgent: string;
  referer: string | null;
  utmSource: string | null;
  hasSecFetch?: boolean;
  webdriver?: boolean;
  geoCountry?: string | null;
  geoCity?: string | null;
  /** Forensic JSON from the JS challenge (elapsed ms, interaction count, …). */
  signals?: string | null;
  nowMs?: number;
  /**
   * Stable key for this exact request (the consumed challenge nonce). Lets the
   * data layer replay — not re-execute — the click if the commit outcome was
   * lost in transit. Optional for callers without a nonce (bot short-circuit).
   */
  idempotencyKey?: string;
}

/** Request-time signals persisted with the click so a later re-evaluation sees exactly what the request had. */
export interface StoredSignals {
  /** sec-fetch-* headers present on the navigation. */
  sf?: boolean;
  /** navigator.webdriver reported by the challenge. */
  wd?: boolean;
  [k: string]: unknown;
}

export function parseSignals(raw: string | null | undefined): StoredSignals {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StoredSignals) : {};
  } catch {
    return {};
  }
}

/** Adds request facts without clobbering what the route already stored (e.g. its numeric `wd`). */
function mergeSignals(raw: string | null | undefined, extra: StoredSignals): string {
  const base = parseSignals(raw);
  for (const [k, v] of Object.entries(extra)) if (base[k] === undefined) base[k] = v;
  return JSON.stringify(base);
}

/** `wd` may be stored as 1/0 (route) or true/false (services). */
function truthyFlag(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

export interface ClickResult {
  redirectUrl: string | null; // null => unknown code (404)
  status: ClickStatus | null; // null when nothing was recorded
}

interface LinkContext extends TrackingLink {
  excluded: number;
  user_status: string;
  participation_status: string;
}

/**
 * The full /go/:code pipeline: resolve link → (inside one transaction, behind
 * the campaign's shared lock) re-check campaign state and eligibility → fraud
 * verdict → persist click → counters/daily stats → rank notifications.
 * Everything that decides or records the outcome happens in the transaction,
 * so a concurrent finalization or review can never interleave with it.
 */
export async function recordClick(input: IncomingClick): Promise<ClickResult> {
  const nowMs = input.nowMs ?? Date.now();
  const link = await one<LinkContext>(
    `SELECT t.*, p.excluded, u.status AS user_status, u.participation_status
     FROM tracking_links t
     JOIN campaign_participants p ON p.id = t.participant_id
     JOIN users u ON u.id = t.user_id
     WHERE t.code = ?`,
    input.code
  );
  if (!link) return { redirectUrl: null, status: null };

  const campaignBefore = (await getCampaign(link.campaign_id))!;
  await ensureLifecycle(campaignBefore);

  const { verdict, previousLeader, storeUrl } = await tx(async () => {
    // Shared campaign lock: clicks run concurrently with each other, but a
    // review/finalization (exclusive) drains them first and blocks new ones.
    await txSerializeOn(campaignLockKey(link.campaign_id), "shared");
    await txSerializeOn(`click-ip:${link.campaign_id}:${input.ipHash}`);
    await txSerializeOn(`click-sess:${link.campaign_id}:${input.sessionId}`);
    await txSerializeOn(`click-dev:${link.campaign_id}:${input.deviceHash}`);

    const campaign = (await one<{ status: string; store_url: string }>(
      "SELECT status, store_url FROM campaigns WHERE id = ?",
      link.campaign_id
    ))!;
    const eligible =
      Number(link.excluded) === 0 && link.user_status === "active" && link.participation_status === "active";

    const v =
      campaign.status !== "active"
        ? { status: "rejected" as const, reason: "campaign_inactive" }
        : !eligible
          ? { status: "rejected" as const, reason: "ineligible" }
          : await classifyClick({
              campaignId: link.campaign_id,
              ipHash: input.ipHash,
              sessionId: input.sessionId,
              deviceHash: input.deviceHash,
              userAgent: input.userAgent,
              hasSecFetch: input.hasSecFetch ?? true,
              webdriver: input.webdriver ?? false,
              nowMs,
            });

    const prev = v.status === "qualified" ? await currentLeader(link.campaign_id) : null;

    await run(
      `INSERT INTO clicks (id, tracking_link_id, campaign_id, user_id, status, reject_reason,
         ip_hash, session_id, device_hash, user_agent, referer, source,
         geo_country, geo_city, signals, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id(),
      link.id,
      link.campaign_id,
      link.user_id,
      v.status,
      v.reason,
      input.ipHash,
      input.sessionId,
      input.deviceHash,
      input.userAgent,
      input.referer,
      detectSource(input.referer, input.utmSource),
      input.geoCountry ?? null,
      input.geoCity ?? null,
      // sec-fetch / webdriver are stored with the click: a held click is later
      // re-evaluated against the SAME request facts, never assumed clean.
      mergeSignals(input.signals, { sf: input.hasSecFetch ?? true, wd: input.webdriver ?? false }),
      nowMs
    );
    await applyCounterDelta(link, v.status, nowMs, +1);
    if (v.status === "qualified") await notifyRankChanges(link.campaign_id, link.user_id, prev);
    return { verdict: v, previousLeader: prev, storeUrl: campaign.store_url };
  }, { idempotencyKey: input.idempotencyKey ? `click:${input.idempotencyKey}` : undefined });
  void previousLeader;

  return { redirectUrl: storeUrl, status: verdict.status };
}

async function applyCounterDelta(
  link: Pick<TrackingLink, "campaign_id" | "participant_id">,
  status: ClickStatus,
  nowMs: number,
  delta: 1 | -1
) {
  const col =
    status === "qualified" ? "qualified_count" : status === "rejected" ? "rejected_count" : "pending_count";
  await run(
    `UPDATE campaign_participants
     SET total_clicks = total_clicks + ?, ${col} = ${col} + ?${
       status === "qualified" && delta === 1 ? ", last_qualified_at = ?" : ""
     }
     WHERE id = ?`,
    ...(status === "qualified" && delta === 1
      ? [delta, delta, nowMs, link.participant_id]
      : [delta, delta, link.participant_id])
  );
  const day = dayKey(nowMs);
  const statCol = status === "qualified" ? "qualified" : status === "rejected" ? "rejected" : "pending";
  await run(
    `INSERT INTO campaign_daily_stats (id, campaign_id, day, clicks, ${statCol})
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, day)
     DO UPDATE SET clicks = campaign_daily_stats.clicks + ?, ${statCol} = campaign_daily_stats.${statCol} + ?`,
    id(),
    link.campaign_id,
    day,
    delta,
    delta,
    delta,
    delta
  );
}

async function notifyRankChanges(campaignId: string, creatorId: string, previousLeader: string | null) {
  const newLeader = await currentLeader(campaignId);
  if (!newLeader || newLeader === previousLeader) return;
  if (newLeader !== creatorId) return;
  const campaign = await getCampaign(campaignId);
  if (!campaign) return;
  await notify(
    newLeader,
    "rank_first",
    `👑 أنت الآن في المركز الأول!`,
    `تصدرت ترتيب ${campaign.title} — حافظ على الصدارة حتى نهاية الحملة.`,
    campaignId
  );
  if (previousLeader) {
    await notify(
      previousLeader,
      "rank_overtaken",
      `⚠️ فقدت الصدارة في ${campaign.title}`,
      "تم تجاوزك — انشر رابطك من جديد لاستعادة المركز الأول.",
      campaignId
    );
  }
}

// ---------------- Admin click review ----------------

export interface ClickReviewRow extends Click {
  username: string;
  campaign_title: string;
}

export interface ReviewPage {
  rows: ClickReviewRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listClicksForReview(
  status: ClickStatus = "pending_review",
  page = 1,
  pageSize = 100
): Promise<ReviewPage> {
  const safePage = Math.max(1, Math.floor(page));
  const size = Math.min(200, Math.max(10, Math.floor(pageSize)));
  const total = Number(
    (await one<{ n: number }>("SELECT COUNT(*) AS n FROM clicks WHERE status = ?", status))?.n ?? 0
  );
  const rows = await q<ClickReviewRow>(
    `SELECT k.*, cp.username, c.title AS campaign_title
     FROM clicks k
     JOIN creator_profiles cp ON cp.user_id = k.user_id
     JOIN campaigns c ON c.id = k.campaign_id
     WHERE k.status = ?
     ORDER BY k.created_at DESC LIMIT ? OFFSET ?`,
    status,
    size,
    (safePage - 1) * size
  );
  return { rows, total, page: safePage, pageSize: size };
}

export interface ReviewOptions {
  /** Explicit correction of FINAL results (logged separately; reason required). */
  correction?: boolean;
}

/**
 * Move a click to qualified/rejected and keep every derived number consistent:
 *  - state check + conditional UPDATE inside one transaction behind the
 *    campaign's exclusive lock (no double-apply under concurrent reviews);
 *  - `last_qualified_at` is re-derived from the click log (tie-break rule);
 *  - audit row in the same transaction;
 *  - ended campaigns: provisional results are re-derived; FINAL results are
 *    untouchable without an explicit correction.
 */
export async function reviewClick(
  clickId: string,
  newStatus: "qualified" | "rejected",
  adminId: string,
  reason: string,
  opts: ReviewOptions = {}
) {
  await tx(async () => {
    const before = await one<Click>("SELECT * FROM clicks WHERE id = ?", clickId);
    if (!before) throw new DomainError("الزيارة غير موجودة");
    await txSerializeOn(campaignLockKey(before.campaign_id));
    const click = (await one<Click>("SELECT * FROM clicks WHERE id = ?", clickId))!;
    if (click.status === newStatus) return;

    const campaign = (await one<{ status: string; results_status: string; title: string; id: string }>(
      "SELECT id, status, results_status, title FROM campaigns WHERE id = ?",
      click.campaign_id
    ))!;
    if (campaign.results_status === "final" && !opts.correction)
      throw new DomainError("نتائج هذه الحملة مثبتة — استخدم «تصحيح النتائج» الصريح مع سبب موثق");
    if (opts.correction && !reason.trim()) throw new DomainError("سبب التصحيح مطلوب");

    const changed = await execute(
      "UPDATE clicks SET status = ?, reject_reason = ? WHERE id = ? AND status = ?",
      newStatus,
      newStatus === "rejected" ? "admin_rejected" : null,
      clickId,
      click.status
    );
    if (changed !== 1) throw new DomainError("تغيرت حالة الزيارة أثناء المراجعة — أعد التحميل");

    const link = (await one<TrackingLink>("SELECT * FROM tracking_links WHERE id = ?", click.tracking_link_id))!;
    await applyReviewCounters(link, click, newStatus);
    await logAdminAction(
      adminId,
      opts.correction ? `click_correction_${newStatus}` : `click_review_${newStatus}`,
      "click",
      clickId,
      reason
    );

    if (campaign.status === "ended") {
      const r = await recomputeStandings(campaign.id, adminId);
      if (campaign.results_status === "final") {
        const full = await getCampaign(campaign.id);
        if (full) await notifyWinners(full, r);
      }
    }
  });
}

/** Counter + daily-stat deltas for a status change; last_qualified_at from the click log. */
async function applyReviewCounters(link: TrackingLink, click: Click, newStatus: ClickStatus) {
  const colOf = (s: ClickStatus) =>
    s === "qualified" ? "qualified_count" : s === "rejected" ? "rejected_count" : "pending_count";
  await run(
    `UPDATE campaign_participants
     SET ${colOf(click.status)} = ${colOf(click.status)} - 1,
         ${colOf(newStatus)} = ${colOf(newStatus)} + 1,
         last_qualified_at = (SELECT MAX(created_at) FROM clicks WHERE tracking_link_id = ? AND status = 'qualified')
     WHERE id = ?`,
    link.id,
    link.participant_id
  );
  const statOf = (s: ClickStatus) => (s === "qualified" ? "qualified" : s === "rejected" ? "rejected" : "pending");
  await run(
    `UPDATE campaign_daily_stats SET ${statOf(click.status)} = ${statOf(click.status)} - 1,
       ${statOf(newStatus)} = ${statOf(newStatus)} + 1
     WHERE campaign_id = ? AND day = ?`,
    click.campaign_id,
    dayKey(click.created_at)
  );
}

export type AutoResolveOutcome = "qualified" | "pending_review" | "rejected" | "unchanged" | "deferred";

/**
 * Re-evaluates ONE click held as `ip_unverified` now that a network verdict
 * may exist. This is NOT the admin override: the click goes through the full
 * fraud pipeline again (eligibility, bot/automation, rate, session/device
 * dedup, device cap, volume, sec-fetch) using the request facts stored with
 * it, with its own row excluded from the counts, inside one transaction that
 * holds the campaign lock exclusively plus the ip/session/device locks (same
 * order as recordClick) — so two duplicates re-evaluated concurrently can
 * never both qualify, and a live click cannot slip in between.
 *  - clean verdict + pipeline says qualified → qualified (system-logged);
 *  - pipeline says pending for another reason → stays pending with THAT reason;
 *  - pipeline says rejected (e.g. duplicate) → rejected;
 *  - risky verdict → stays pending as `risky_ip`;
 *  - campaign results FINAL → left for the admin ("deferred").
 * Ended (provisional) campaigns get their standings recomputed in the same transaction.
 */
export async function autoResolveHeldClick(clickId: string): Promise<AutoResolveOutcome> {
  await ensureSystemActor();
  return tx(async () => {
    const before = await one<Click>("SELECT * FROM clicks WHERE id = ?", clickId);
    if (!before || before.status !== "pending_review" || before.reject_reason !== "ip_unverified") return "unchanged";
    await txSerializeOn(campaignLockKey(before.campaign_id));
    await txSerializeOn(`click-ip:${before.campaign_id}:${before.ip_hash}`);
    await txSerializeOn(`click-sess:${before.campaign_id}:${before.session_id}`);
    await txSerializeOn(`click-dev:${before.campaign_id}:${before.device_hash ?? ""}`);
    // Re-read under the locks: a concurrent resolver may have handled it already.
    const click = await one<Click>("SELECT * FROM clicks WHERE id = ?", clickId);
    if (!click || click.status !== "pending_review" || click.reject_reason !== "ip_unverified") return "unchanged";

    const intel = await getIpIntel(click.ip_hash);
    if (!intel) return "unchanged";
    const campaign = (await one<{ id: string; status: string; results_status: string; title: string }>(
      "SELECT id, status, results_status, title FROM campaigns WHERE id = ?",
      click.campaign_id
    ))!;
    if (campaign.results_status === "final") return "deferred";
    if (Number(intel.risky)) {
      await run("UPDATE clicks SET reject_reason = 'risky_ip' WHERE id = ? AND reject_reason = 'ip_unverified'", click.id);
      return "pending_review";
    }

    const link = (await one<LinkContext>(
      `SELECT t.*, p.excluded, u.status AS user_status, u.participation_status
       FROM tracking_links t
       JOIN campaign_participants p ON p.id = t.participant_id
       JOIN users u ON u.id = t.user_id
       WHERE t.id = ?`,
      click.tracking_link_id
    ))!;
    const eligible =
      Number(link.excluded) === 0 && link.user_status === "active" && link.participation_status === "active";
    const sig = parseSignals(click.signals);
    const v = !eligible
      ? { status: "rejected" as const, reason: "ineligible" }
      : await classifyClick({
          campaignId: click.campaign_id,
          ipHash: click.ip_hash,
          sessionId: click.session_id,
          deviceHash: click.device_hash ?? "",
          userAgent: click.user_agent,
          // Missing stored facts are never assumed clean (legacy rows → review).
          hasSecFetch: sig.sf === true,
          webdriver: truthyFlag(sig.wd),
          nowMs: Number(click.created_at),
          intelNowMs: Date.now(),
          excludeClickId: click.id,
        });

    if (v.status === "pending_review") {
      if (v.reason === "ip_unverified") return "unchanged";
      await run(
        "UPDATE clicks SET reject_reason = ? WHERE id = ? AND status = 'pending_review' AND reject_reason = 'ip_unverified'",
        v.reason,
        click.id
      );
      await logAdminAction(SYSTEM_ACTOR_ID, "click_auto_hold", "click", click.id, `auto: ${v.reason}`);
      return "pending_review";
    }

    const prev = v.status === "qualified" ? await currentLeader(click.campaign_id) : null;
    const changed = await execute(
      "UPDATE clicks SET status = ?, reject_reason = ? WHERE id = ? AND status = 'pending_review' AND reject_reason = 'ip_unverified'",
      v.status,
      v.reason,
      click.id
    );
    if (changed !== 1) return "unchanged";
    await applyReviewCounters(link, click, v.status);
    await logAdminAction(
      SYSTEM_ACTOR_ID,
      `click_auto_${v.status}`,
      "click",
      click.id,
      v.status === "qualified" ? "auto: network verdict clean, pipeline passed" : `auto: ${v.reason}`
    );
    if (campaign.status === "ended") {
      await recomputeStandings(campaign.id, SYSTEM_ACTOR_ID); // provisional only (final → deferred above)
    } else if (v.status === "qualified") {
      await notifyRankChanges(click.campaign_id, click.user_id, prev);
    }
    return v.status;
  });
}

/**
 * Clicks held as `ip_unverified` are re-evaluated automatically once a fresh
 * network verdict exists (see autoResolveHeldClick). Oldest first, so among
 * duplicates the earliest click is the one that can qualify. Runs from the
 * lifecycle sweep and right after an IP lookup completes.
 */
export async function reevaluateIpUnverified(ipHash?: string, limit = 200): Promise<number> {
  const rows = await q<{ id: string }>(
    `SELECT id FROM clicks WHERE status = 'pending_review' AND reject_reason = 'ip_unverified'
     ${ipHash ? "AND ip_hash = ?" : ""} ORDER BY created_at ASC, id ASC LIMIT ?`,
    ...(ipHash ? [ipHash, limit] : [limit])
  );
  let resolved = 0;
  for (const row of rows) {
    if ((await autoResolveHeldClick(row.id)) === "qualified") resolved += 1;
  }
  return resolved;
}
