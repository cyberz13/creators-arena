import { id, now, one, q, run, tx } from "@/lib/db";
import type { Campaign, Participant, Prize, TrackingLink } from "@/lib/types";
import { notify } from "./notifications";
import { logAdminAction } from "./adminActions";
import { getLeaderboard } from "./leaderboard";

export interface CampaignInput {
  title: string;
  description: string;
  requirements: string;
  store_name: string;
  store_url: string;
  store_logo_url?: string | null;
  image_url?: string | null;
  start_at: number;
  end_at: number;
  /** Prize amounts by rank: [500] or [500, 250, 100]. */
  prizes: number[];
}

export class DomainError extends Error {}

function validateInput(input: CampaignInput) {
  if (!input.title.trim()) throw new DomainError("عنوان الحملة مطلوب");
  if (!input.store_name.trim()) throw new DomainError("اسم المتجر مطلوب");
  let url: URL;
  try {
    url = new URL(input.store_url);
  } catch {
    throw new DomainError("رابط المتجر غير صالح");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new DomainError("رابط المتجر يجب أن يكون http/https");
  if (input.end_at <= input.start_at) throw new DomainError("تاريخ النهاية يجب أن يكون بعد البداية");
  if (input.prizes.length === 0) throw new DomainError("حدد جائزة واحدة على الأقل");
  if (input.prizes.some((p) => !Number.isInteger(p) || p <= 0))
    throw new DomainError("قيم الجوائز يجب أن تكون أرقامًا موجبة");
}

export async function createCampaign(
  input: CampaignInput,
  adminId: string,
  launch: boolean
): Promise<Campaign> {
  validateInput(input);
  const campaignId = id();
  const ts = now();
  const prizeTotal = input.prizes.reduce((a, b) => a + b, 0);
  if (launch && input.end_at <= ts)
    throw new DomainError("لا يمكن إطلاق حملة تاريخ نهايتها في الماضي");
  const status = launch ? (input.start_at > ts ? "scheduled" : "active") : "draft";
  await tx(async () => {
    await run(
      `INSERT INTO campaigns (id, title, description, requirements, store_name, store_url,
         store_logo_url, image_url, status, start_at, end_at, prize_total, winners_count,
         created_by, created_at, launched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      campaignId,
      input.title.trim(),
      input.description.trim(),
      input.requirements.trim(),
      input.store_name.trim(),
      input.store_url.trim(),
      input.store_logo_url ?? null,
      input.image_url ?? null,
      status,
      input.start_at,
      input.end_at,
      prizeTotal,
      input.prizes.length,
      adminId,
      ts,
      launch ? ts : null
    );
    for (let i = 0; i < input.prizes.length; i++) {
      await run(
        "INSERT INTO prizes (id, campaign_id, rank, amount) VALUES (?, ?, ?, ?)",
        id(),
        campaignId,
        i + 1,
        input.prizes[i]
      );
    }
  });
  await logAdminAction(
    adminId,
    launch ? "campaign_create_launch" : "campaign_create_draft",
    "campaign",
    campaignId
  );
  return (await getCampaign(campaignId))!;
}

export async function launchCampaign(campaignId: string, adminId: string): Promise<Campaign> {
  const c = await getCampaign(campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  if (c.status !== "draft") throw new DomainError("لا يمكن إطلاق حملة ليست مسودة");
  const ts = now();
  if (c.end_at <= ts) throw new DomainError("تاريخ نهاية الحملة في الماضي — عدّل التواريخ أولًا");
  const status = c.start_at > ts ? "scheduled" : "active";
  await run("UPDATE campaigns SET status = ?, launched_at = ? WHERE id = ?", status, ts, campaignId);
  await logAdminAction(adminId, "campaign_launch", "campaign", campaignId);
  return (await getCampaign(campaignId))!;
}

/** Draft campaigns are fully editable. After launch the prize snapshot and dates are frozen. */
export async function updateDraftCampaign(
  campaignId: string,
  input: CampaignInput,
  adminId: string
): Promise<Campaign> {
  const c = await getCampaign(campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  if (c.status !== "draft") throw new DomainError("لا يمكن تعديل حملة بعد إطلاقها");
  validateInput(input);
  const prizeTotal = input.prizes.reduce((a, b) => a + b, 0);
  await tx(async () => {
    await run(
      `UPDATE campaigns SET title=?, description=?, requirements=?, store_name=?, store_url=?,
         store_logo_url=?, image_url=?, start_at=?, end_at=?, prize_total=?, winners_count=?
       WHERE id=?`,
      input.title.trim(),
      input.description.trim(),
      input.requirements.trim(),
      input.store_name.trim(),
      input.store_url.trim(),
      input.store_logo_url ?? null,
      input.image_url ?? null,
      input.start_at,
      input.end_at,
      prizeTotal,
      input.prizes.length,
      campaignId
    );
    await run("DELETE FROM prizes WHERE campaign_id = ?", campaignId);
    for (let i = 0; i < input.prizes.length; i++) {
      await run(
        "INSERT INTO prizes (id, campaign_id, rank, amount) VALUES (?, ?, ?, ?)",
        id(),
        campaignId,
        i + 1,
        input.prizes[i]
      );
    }
  });
  await logAdminAction(adminId, "campaign_update_draft", "campaign", campaignId);
  return (await getCampaign(campaignId))!;
}

export async function getCampaign(campaignId: string): Promise<Campaign | undefined> {
  return one<Campaign>("SELECT * FROM campaigns WHERE id = ?", campaignId);
}

export async function getPrizes(campaignId: string): Promise<Prize[]> {
  return q<Prize>("SELECT * FROM prizes WHERE campaign_id = ? ORDER BY rank", campaignId);
}

/**
 * Lazy lifecycle transitions: scheduled→active when start passes,
 * active→ended (+finalization) when end passes. Called on every read path.
 */
export async function ensureLifecycle(c: Campaign): Promise<Campaign> {
  const ts = now();
  if (c.status === "scheduled" && ts >= c.start_at && ts < c.end_at) {
    await run("UPDATE campaigns SET status = 'active' WHERE id = ? AND status = 'scheduled'", c.id);
    return (await getCampaign(c.id))!;
  }
  if ((c.status === "active" || c.status === "scheduled") && ts >= c.end_at) {
    await finalizeCampaign(c.id);
    return (await getCampaign(c.id))!;
  }
  return c;
}

/** Sweep all campaigns needing a transition (used by dashboards and the tracking route). */
export async function sweepLifecycles() {
  const due = await q<Campaign>(
    "SELECT * FROM campaigns WHERE status IN ('scheduled','active') AND (end_at <= ? OR (status = 'scheduled' AND start_at <= ?))",
    now(),
    now()
  );
  for (const c of due) await ensureLifecycle(c);
  await notifyEndingSoon();
}

/** One-time "ending soon" notification to participants of campaigns within 24h of the end. */
async function notifyEndingSoon() {
  const soon = await q<Campaign>(
    "SELECT * FROM campaigns WHERE status = 'active' AND end_at > ? AND end_at <= ?",
    now(),
    now() + 24 * 3_600_000
  );
  for (const c of soon) {
    const alreadySent = await one(
      "SELECT 1 FROM notifications WHERE campaign_id = ? AND type = 'campaign_ending_soon' LIMIT 1",
      c.id
    );
    if (alreadySent) continue;
    const participants = await q<{ user_id: string }>(
      "SELECT user_id FROM campaign_participants WHERE campaign_id = ?",
      c.id
    );
    for (const p of participants) {
      await notify(
        p.user_id,
        "campaign_ending_soon",
        `⏰ ${c.title} ينتهي خلال أقل من 24 ساعة`,
        "ادفع بجمهورك الآن — الترتيب النهائي يُجمّد عند انتهاء الوقت.",
        c.id
      );
    }
  }
}

/**
 * Freeze results: final ranks, winners by prize snapshot, payouts (pending), notifications.
 * Idempotent — safe to call twice.
 */
export async function finalizeCampaign(campaignId: string) {
  const c = await getCampaign(campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  if (c.status === "ended" || c.status === "cancelled") return;
  const board = await getLeaderboard(campaignId);
  const prizes = await getPrizes(campaignId);
  const ts = now();
  await tx(async () => {
    await run("UPDATE campaigns SET status = 'ended', finalized_at = ? WHERE id = ?", ts, campaignId);
    for (const entry of board) {
      await run(
        "UPDATE campaign_participants SET final_rank = ? WHERE campaign_id = ? AND user_id = ?",
        entry.rank,
        campaignId,
        entry.user_id
      );
    }
    for (const prize of prizes) {
      const winner = board[prize.rank - 1];
      if (!winner || winner.qualified_count <= 0) continue;
      await run(
        "UPDATE campaign_participants SET is_winner = 1 WHERE campaign_id = ? AND user_id = ?",
        campaignId,
        winner.user_id
      );
      await run(
        `INSERT INTO payouts (id, campaign_id, user_id, prize_rank, amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(campaign_id, prize_rank) DO NOTHING`,
        id(),
        campaignId,
        winner.user_id,
        prize.rank,
        prize.amount,
        ts
      );
    }
  });
  for (const entry of board) {
    const prize = prizes[entry.rank - 1];
    if (prize && entry.qualified_count > 0) {
      await notify(
        entry.user_id,
        "campaign_won",
        `🏆 فزت بالمركز #${entry.rank} في ${c.title}!`,
        `جائزتك ${prize.amount} ريال — سيتم التواصل معك لصرفها.`,
        campaignId
      );
    } else {
      await notify(
        entry.user_id,
        "campaign_ended",
        `انتهت حملة ${c.title}`,
        `أنهيت الحملة في المركز #${entry.rank} بعدد ${entry.qualified_count} زيارة مؤهلة.`,
        campaignId
      );
    }
  }
}

// ---------------- Admin overrides (always logged) ----------------

export async function adminEndCampaign(campaignId: string, adminId: string, reason: string) {
  const c = await getCampaign(campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  if (c.status !== "active" && c.status !== "scheduled")
    throw new DomainError("الحملة ليست نشطة");
  await run("UPDATE campaigns SET end_at = ? WHERE id = ?", now(), campaignId);
  await finalizeCampaign(campaignId);
  await logAdminAction(adminId, "campaign_end_early", "campaign", campaignId, reason);
}

export async function adminCancelCampaign(campaignId: string, adminId: string, reason: string) {
  const c = await getCampaign(campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  if (c.status === "ended") throw new DomainError("لا يمكن إلغاء حملة منتهية");
  await run("UPDATE campaigns SET status = 'cancelled' WHERE id = ?", campaignId);
  await logAdminAction(adminId, "campaign_cancel", "campaign", campaignId, reason);
}

export async function adminExtendCampaign(
  campaignId: string,
  newEndAt: number,
  adminId: string,
  reason: string
) {
  const c = await getCampaign(campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  if (c.status !== "active" && c.status !== "scheduled")
    throw new DomainError("يمكن تمديد الحملات النشطة أو المجدولة فقط");
  if (newEndAt <= c.end_at) throw new DomainError("التاريخ الجديد يجب أن يكون بعد النهاية الحالية");
  await run("UPDATE campaigns SET end_at = ? WHERE id = ?", newEndAt, campaignId);
  await logAdminAction(adminId, "campaign_extend", "campaign", campaignId, reason);
}

// ---------------- Participation ----------------

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomCode(len = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export async function joinCampaign(campaignId: string, userId: string): Promise<TrackingLink> {
  const c = await getCampaign(campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  const live = await ensureLifecycle(c);
  if (live.status !== "active") throw new DomainError("المشاركة متاحة في الحملات النشطة فقط");
  const existing = await one<Participant>(
    "SELECT * FROM campaign_participants WHERE campaign_id = ? AND user_id = ?",
    campaignId,
    userId
  );
  if (existing) {
    return (await one<TrackingLink>(
      "SELECT * FROM tracking_links WHERE participant_id = ?",
      existing.id
    ))!;
  }
  const ts = now();
  const participantId = id();
  const link = await tx(async () => {
    await run(
      `INSERT INTO campaign_participants (id, campaign_id, user_id, joined_at)
       VALUES (?, ?, ?, ?)`,
      participantId,
      campaignId,
      userId,
      ts
    );
    let code = randomCode();
    while (await one("SELECT 1 FROM tracking_links WHERE code = ?", code)) code = randomCode();
    const linkId = id();
    await run(
      `INSERT INTO tracking_links (id, code, campaign_id, participant_id, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      linkId,
      code,
      campaignId,
      participantId,
      userId,
      ts
    );
    return (await one<TrackingLink>("SELECT * FROM tracking_links WHERE id = ?", linkId))!;
  });
  await notify(
    userId,
    "campaign_joined",
    `انضممت إلى ${live.title} 🎯`,
    "انسخ رابطك الخاص وشاركه مع جمهورك الآن.",
    campaignId
  );
  return link;
}

export async function getParticipant(
  campaignId: string,
  userId: string
): Promise<Participant | undefined> {
  return one<Participant>(
    "SELECT * FROM campaign_participants WHERE campaign_id = ? AND user_id = ?",
    campaignId,
    userId
  );
}

export async function getTrackingLink(
  campaignId: string,
  userId: string
): Promise<TrackingLink | undefined> {
  return one<TrackingLink>(
    "SELECT * FROM tracking_links WHERE campaign_id = ? AND user_id = ?",
    campaignId,
    userId
  );
}

export interface CampaignWithStats extends Campaign {
  participants_count: number;
  qualified_total: number;
  clicks_total: number;
}

const STATS_SELECT = `
  c.*,
  (SELECT COUNT(*) FROM campaign_participants p WHERE p.campaign_id = c.id) AS participants_count,
  (SELECT COALESCE(SUM(p.qualified_count), 0) FROM campaign_participants p WHERE p.campaign_id = c.id) AS qualified_total,
  (SELECT COALESCE(SUM(p.total_clicks), 0) FROM campaign_participants p WHERE p.campaign_id = c.id) AS clicks_total
`;

export type MarketplaceSort = "newest" | "prize" | "ending" | "popular";

export async function listActiveCampaigns(
  sort: MarketplaceSort = "newest"
): Promise<CampaignWithStats[]> {
  await sweepLifecycles();
  const order = {
    newest: "c.launched_at DESC",
    prize: "c.prize_total DESC",
    ending: "c.end_at ASC",
    popular: "participants_count DESC",
  }[sort];
  return q<CampaignWithStats>(
    `SELECT ${STATS_SELECT} FROM campaigns c WHERE c.status = 'active' ORDER BY ${order}`
  );
}

export async function listAllCampaigns(): Promise<CampaignWithStats[]> {
  await sweepLifecycles();
  return q<CampaignWithStats>(`SELECT ${STATS_SELECT} FROM campaigns c ORDER BY c.created_at DESC`);
}

export async function getCampaignWithStats(
  campaignId: string
): Promise<CampaignWithStats | undefined> {
  const c = await one<CampaignWithStats>(
    `SELECT ${STATS_SELECT} FROM campaigns c WHERE c.id = ?`,
    campaignId
  );
  if (!c) return undefined;
  const fresh = await ensureLifecycle(c);
  return fresh.status === c.status ? c : { ...c, ...fresh };
}

export interface MyCampaignRow extends CampaignWithStats {
  joined_at: number;
  my_qualified: number;
  my_clicks: number;
  final_rank: number | null;
  is_winner: number;
  tracking_code: string;
}

export async function listMyCampaigns(userId: string): Promise<MyCampaignRow[]> {
  await sweepLifecycles();
  return q<MyCampaignRow>(
    `SELECT ${STATS_SELECT},
       p.joined_at AS joined_at, p.qualified_count AS my_qualified, p.total_clicks AS my_clicks,
       p.final_rank AS final_rank, p.is_winner AS is_winner, t.code AS tracking_code
     FROM campaigns c
     JOIN campaign_participants p ON p.campaign_id = c.id AND p.user_id = ?
     JOIN tracking_links t ON t.participant_id = p.id
     ORDER BY c.end_at DESC`,
    userId
  );
}
