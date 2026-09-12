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
      input.signals ?? null,
      nowMs
    );
    await applyCounterDelta(link, v.status, nowMs, +1);
    if (v.status === "qualified") await notifyRankChanges(link.campaign_id, link.user_id, prev);
    return { verdict: v, previousLeader: prev, storeUrl: campaign.store_url };
  });
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

/**
 * Clicks held as `ip_unverified` are resolved automatically once a fresh
 * network verdict exists: clean → qualified (system-logged), risky → stays in
 * review as `risky_ip`. Campaigns with FINAL results are left for the admin.
 * Runs from the lifecycle sweep and right after an IP lookup completes.
 */
export async function reevaluateIpUnverified(ipHash?: string, limit = 200): Promise<number> {
  await ensureSystemActor();
  const rows = await q<Click>(
    `SELECT * FROM clicks WHERE status = 'pending_review' AND reject_reason = 'ip_unverified'
     ${ipHash ? "AND ip_hash = ?" : ""} ORDER BY created_at ASC LIMIT ?`,
    ...(ipHash ? [ipHash, limit] : [limit])
  );
  let resolved = 0;
  for (const click of rows) {
    const intel = await getIpIntel(click.ip_hash);
    if (!intel) continue;
    if (Number(intel.risky)) {
      await run("UPDATE clicks SET reject_reason = 'risky_ip' WHERE id = ? AND reject_reason = 'ip_unverified'", click.id);
      continue;
    }
    try {
      await reviewClick(click.id, "qualified", SYSTEM_ACTOR_ID, "auto: network verdict clean");
      resolved += 1;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e; // final results etc. → admin handles it
    }
  }
  return resolved;
}
