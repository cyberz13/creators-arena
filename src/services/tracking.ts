import { id, one, q, run, tx, txSerializeOn } from "@/lib/db";
import { dayKey } from "@/lib/utils";
import type { Click, ClickStatus, TrackingLink } from "@/lib/types";
import { classifyClick, detectSource } from "./fraud";
import { ensureLifecycle, getCampaign } from "./campaigns";
import { currentLeader } from "./leaderboard";
import { notify } from "./notifications";
import { logAdminAction } from "./adminActions";

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

/**
 * The full /go/:code pipeline: resolve link → campaign state → fraud verdict
 * → persist click → update counters/daily stats → leaderboard notifications.
 * Returns the store URL to redirect to (or null for unknown codes).
 */
export async function recordClick(input: IncomingClick): Promise<ClickResult> {
  const nowMs = input.nowMs ?? Date.now();
  const link = await one<TrackingLink>("SELECT * FROM tracking_links WHERE code = ?", input.code);
  if (!link) return { redirectUrl: null, status: null };

  let campaign = (await getCampaign(link.campaign_id))!;
  campaign = await ensureLifecycle(campaign);

  // Classify INSIDE the transaction, behind per-key advisory locks:
  // concurrent clicks from the same ip/session serialize here, so the
  // dedup check can never race its own write (the leak a production
  // audit caught: several "qualified" from one IP within one minute).
  const { verdict, previousLeader } = await tx(async () => {
    await txSerializeOn(`click-ip:${link.campaign_id}:${input.ipHash}`);
    await txSerializeOn(`click-sess:${link.campaign_id}:${input.sessionId}`);
    await txSerializeOn(`click-dev:${link.campaign_id}:${input.deviceHash}`);

    const v =
      campaign.status !== "active"
        ? { status: "rejected" as const, reason: "campaign_inactive" }
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
    return { verdict: v, previousLeader: prev };
  });

  if (verdict.status === "qualified") {
    await notifyRankChanges(link.campaign_id, link.user_id, previousLeader);
  }

  return { redirectUrl: campaign.store_url, status: verdict.status };
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

export async function listClicksForReview(
  status: ClickStatus = "pending_review",
  limit = 200
): Promise<ClickReviewRow[]> {
  return q<ClickReviewRow>(
    `SELECT k.*, cp.username, c.title AS campaign_title
     FROM clicks k
     JOIN creator_profiles cp ON cp.user_id = k.user_id
     JOIN campaigns c ON c.id = k.campaign_id
     WHERE k.status = ?
     ORDER BY k.created_at DESC LIMIT ?`,
    status,
    limit
  );
}

/** Admin override: move a click to qualified/rejected and fix all counters. Logged. */
export async function reviewClick(
  clickId: string,
  newStatus: "qualified" | "rejected",
  adminId: string,
  reason: string
) {
  const click = await one<Click>("SELECT * FROM clicks WHERE id = ?", clickId);
  if (!click) throw new Error("الزيارة غير موجودة");
  if (click.status === newStatus) return;
  const link = (await one<TrackingLink>(
    "SELECT * FROM tracking_links WHERE id = ?",
    click.tracking_link_id
  ))!;
  await tx(async () => {
    // Reverse old status counters (keep total_clicks — the click still happened).
    const oldCol =
      click.status === "qualified"
        ? "qualified_count"
        : click.status === "rejected"
          ? "rejected_count"
          : "pending_count";
    await run(`UPDATE campaign_participants SET ${oldCol} = ${oldCol} - 1 WHERE id = ?`, link.participant_id);
    const newCol = newStatus === "qualified" ? "qualified_count" : "rejected_count";
    await run(
      `UPDATE campaign_participants SET ${newCol} = ${newCol} + 1${
        newStatus === "qualified" ? ", last_qualified_at = ?" : ""
      } WHERE id = ?`,
      ...(newStatus === "qualified" ? [click.created_at, link.participant_id] : [link.participant_id])
    );
    const day = dayKey(click.created_at);
    const oldStat =
      click.status === "qualified" ? "qualified" : click.status === "rejected" ? "rejected" : "pending";
    const newStat = newStatus === "qualified" ? "qualified" : "rejected";
    await run(
      `UPDATE campaign_daily_stats SET ${oldStat} = ${oldStat} - 1, ${newStat} = ${newStat} + 1
       WHERE campaign_id = ? AND day = ?`,
      click.campaign_id,
      day
    );
    await run(
      "UPDATE clicks SET status = ?, reject_reason = ? WHERE id = ?",
      newStatus,
      newStatus === "rejected" ? "admin_rejected" : null,
      clickId
    );
  });
  await logAdminAction(adminId, `click_review_${newStatus}`, "click", clickId, reason);
}
