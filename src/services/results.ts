import { execute, id, now, one, q, run, tx, txSerializeOn } from "@/lib/db";
import type { Campaign, Payout, Prize } from "@/lib/types";
import { getStandings, type StandingEntry } from "./leaderboard";
import { notify } from "./notifications";
import { logAdminAction } from "./adminActions";
import { DomainError } from "./errors";

/**
 * Results lifecycle
 * -----------------
 *   active ──(end_at / admin end)──▶ ended + results_status = provisional
 *          ──(admin confirms, no pending clicks)──▶ results_status = final
 *          ──(explicit, logged correction)──▶ recomputed, paid entitlements protected
 *
 * Every routine below runs INSIDE a transaction holding the campaign's
 * advisory lock, so reviews, finalization and click counting never interleave.
 */

/** Actor used for automatic (non-admin) audit rows. Cannot log in: disabled + unusable hash. */
export const SYSTEM_ACTOR_ID = "system";

export async function ensureSystemActor(): Promise<void> {
  await run(
    `INSERT INTO users (id, email, password_hash, role, status, participation_status, approved, created_at)
     VALUES (?, 'system@internal.invalid', '!', 'admin', 'disabled', 'suspended', 1, ?)
     ON CONFLICT(id) DO NOTHING`,
    SYSTEM_ACTOR_ID,
    now()
  );
}

export function campaignLockKey(campaignId: string): string {
  return `campaign:${campaignId}`;
}

interface Recomputed {
  standings: StandingEntry[];
  prizes: Prize[];
}

/**
 * Re-derives final ranks, winners and payout rows from the current eligible
 * standings. Must run inside a transaction that holds the campaign lock.
 * Refuses to move a PAID entitlement: that requires a manual settlement.
 */
export async function recomputeStandings(campaignId: string, actorId: string): Promise<Recomputed> {
  const standings = await getStandings(campaignId);
  const prizes = await q<Prize>("SELECT * FROM prizes WHERE campaign_id = ? ORDER BY rank", campaignId);
  const ts = now();

  await run("UPDATE campaign_participants SET final_rank = NULL, is_winner = 0 WHERE campaign_id = ?", campaignId);
  for (const entry of standings) {
    await run("UPDATE campaign_participants SET final_rank = ? WHERE id = ?", entry.rank, entry.participant_id);
  }

  for (const prize of prizes) {
    const winner = standings[prize.rank - 1];
    const hasWinner = !!winner && winner.qualified_count > 0;
    const existing = await one<Payout>(
      "SELECT * FROM payouts WHERE campaign_id = ? AND prize_rank = ?",
      campaignId,
      prize.rank
    );
    if (hasWinner) {
      await run("UPDATE campaign_participants SET is_winner = 1 WHERE id = ?", winner.participant_id);
      if (!existing) {
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
      } else if (existing.user_id !== winner.user_id) {
        if (existing.status === "paid") {
          throw new DomainError(
            `الجائزة #${prize.rank} مدفوعة بالفعل لمستخدم آخر — النتيجة الجديدة تتطلب تسوية يدوية موثقة`
          );
        }
        const changed = await execute(
          `UPDATE payouts SET user_id = ?, amount = ?, status = 'pending', updated_by = ?, updated_at = ?
           WHERE id = ? AND status <> 'paid'`,
          winner.user_id,
          prize.amount,
          actorId,
          ts,
          existing.id
        );
        if (changed !== 1) throw new DomainError("تعذر تحديث استحقاق الجائزة — أعد المحاولة");
      }
    } else if (existing) {
      if (existing.status === "paid") {
        throw new DomainError(`الجائزة #${prize.rank} مدفوعة لكن لم يعد لها مستحق — تتطلب تسوية يدوية`);
      }
      await run("DELETE FROM payouts WHERE id = ? AND status <> 'paid'", existing.id);
    }
  }
  return { standings, prizes };
}

/** Winner notifications are sent only for confirmed results; dedupe keys make them idempotent. */
export async function notifyWinners(campaign: Campaign, r: Recomputed): Promise<void> {
  for (const prize of r.prizes) {
    const winner = r.standings[prize.rank - 1];
    if (!winner || winner.qualified_count <= 0) continue;
    await notify(
      winner.user_id,
      "campaign_won",
      `🏆 فزت بالمركز #${prize.rank} في ${campaign.title}!`,
      `جائزتك ${prize.amount} ريال — سيتم التواصل معك لصرفها.`,
      campaign.id,
      `campaign_won:${campaign.id}:${winner.user_id}:${prize.rank}`
    );
  }
}

/**
 * After a user's eligibility changed (account disabled/enabled, participation
 * suspended/resumed): every ENDED campaign they took part in is recomputed
 * under its campaign lock, in the caller's transaction. Payouts that are not
 * paid follow the new standings (reassigned or removed by recomputeStandings);
 * a PAID payout is never touched — the conflict is recorded as an admin
 * action (`results_conflict`) for manual settlement instead of blocking the
 * status change. Confirmed campaigns notify the (new) winners.
 */
export async function recomputeAfterEligibilityChange(userId: string, actorId: string, why: string): Promise<void> {
  const campaigns = await q<Campaign>(
    `SELECT c.* FROM campaigns c
     JOIN campaign_participants p ON p.campaign_id = c.id
     WHERE p.user_id = ? AND c.status = 'ended'
     ORDER BY c.id`,
    userId
  );
  for (const c of campaigns) {
    await txSerializeOn(campaignLockKey(c.id));
    try {
      const r = await recomputeStandings(c.id, actorId);
      await logAdminAction(actorId, "results_recomputed", "campaign", c.id, why);
      if (c.results_status === "final") await notifyWinners(c, r);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      await logAdminAction(actorId, "results_conflict", "campaign", c.id, `${why} — ${e.message}`);
    }
  }
}

async function lockedCampaign(campaignId: string): Promise<Campaign> {
  await txSerializeOn(campaignLockKey(campaignId));
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE id = ?", campaignId);
  if (!c) throw new DomainError("الحملة غير موجودة");
  return c;
}

/**
 * Admin confirms provisional results → final. Refused while any click of the
 * campaign is still pending review, so what is announced matches what is paid.
 */
export async function confirmResults(campaignId: string, adminId: string): Promise<void> {
  await tx(async () => {
    const c = await lockedCampaign(campaignId);
    if (c.status !== "ended") throw new DomainError("لا يمكن تثبيت نتائج حملة لم تنتهِ");
    if (c.results_status === "final") return;
    const pending = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM clicks WHERE campaign_id = ? AND status = 'pending_review'",
      campaignId
    );
    if (Number(pending?.n ?? 0) > 0) {
      throw new DomainError(`توجد ${pending!.n} زيارة قيد المراجعة — راجعها قبل تثبيت النتائج`);
    }
    const r = await recomputeStandings(campaignId, adminId);
    const changed = await execute(
      "UPDATE campaigns SET results_status = 'final' WHERE id = ? AND results_status = 'provisional'",
      campaignId
    );
    if (changed !== 1) throw new DomainError("تغيرت حالة النتائج — أعد التحميل");
    await notifyWinners(c, r);
    await logAdminAction(adminId, "results_confirm", "campaign", campaignId);
  });
}

/**
 * Explicit, logged correction of FINAL results (after a late review or an
 * eligibility change). Paid entitlements are never moved silently: the
 * recomputation throws and nothing changes until a manual settlement is done.
 */
export async function correctResults(campaignId: string, adminId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new DomainError("سبب التصحيح مطلوب");
  await tx(async () => {
    const c = await lockedCampaign(campaignId);
    if (c.status !== "ended" || c.results_status !== "final")
      throw new DomainError("التصحيح متاح للنتائج المثبتة فقط");
    const r = await recomputeStandings(campaignId, adminId);
    await notifyWinners(c, r);
    await logAdminAction(adminId, "results_correct", "campaign", campaignId, reason);
  });
}

/** Per-campaign exclusion (logged). Re-derives results when the campaign has ended. */
export async function excludeParticipant(
  campaignId: string,
  userId: string,
  adminId: string,
  reason: string,
  excluded = true
): Promise<void> {
  if (excluded && !reason.trim()) throw new DomainError("سبب الاستبعاد مطلوب");
  await tx(async () => {
    const c = await lockedCampaign(campaignId);
    const changed = await execute(
      "UPDATE campaign_participants SET excluded = ?, excluded_reason = ? WHERE campaign_id = ? AND user_id = ?",
      excluded ? 1 : 0,
      excluded ? reason : null,
      campaignId,
      userId
    );
    if (changed !== 1) throw new DomainError("المشارك غير موجود في هذه الحملة");
    if (c.status === "ended") {
      const r = await recomputeStandings(campaignId, adminId);
      if (c.results_status === "final") await notifyWinners(c, r);
    }
    await logAdminAction(
      adminId,
      excluded ? "participant_exclude" : "participant_include",
      "participant",
      `${campaignId}:${userId}`,
      reason
    );
  });
}
