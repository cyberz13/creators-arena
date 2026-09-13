import { id, now, q, run, one } from "@/lib/db";
import type { Notification } from "@/lib/types";

export type NotificationType =
  | "campaign_joined"
  | "rank_first"
  | "rank_overtaken"
  | "campaign_ending_soon"
  | "campaign_ended"
  | "campaign_won"
  | "prize_approved"
  | "prize_paid"
  | "account_approved";

/**
 * Inserts a notification. When `dedupeKey` is given the insert is idempotent
 * (unique index on notifications.dedupe_key), so retried or concurrent
 * processes — e.g. two instances finalizing the same campaign — never
 * produce duplicates. Callers invoke this INSIDE the transaction that
 * produced the event, so a notification never outlives a rolled-back write.
 */
export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body = "",
  campaignId: string | null = null,
  dedupeKey: string | null = null
) {
  await run(
    `INSERT INTO notifications (id, user_id, type, title, body, campaign_id, read, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    id(),
    userId,
    type,
    title,
    body,
    campaignId,
    dedupeKey,
    now()
  );
}

export async function listNotifications(userId: string, limit = 30): Promise<Notification[]> {
  return q<Notification>(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    userId,
    limit
  );
}

export async function unreadCount(userId: string): Promise<number> {
  const row = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0",
    userId
  );
  return row?.c ?? 0;
}

export async function markAllRead(userId: string) {
  await run("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", userId);
}
