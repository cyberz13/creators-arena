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
  | "prize_paid";

export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body = "",
  campaignId: string | null = null
) {
  await run(
    `INSERT INTO notifications (id, user_id, type, title, body, campaign_id, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    id(),
    userId,
    type,
    title,
    body,
    campaignId,
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
