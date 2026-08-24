import { id, now, q, run } from "@/lib/db";

export interface AdminActionRow {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  created_at: number;
  admin_email?: string;
}

export async function logAdminAction(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  reason = ""
) {
  await run(
    `INSERT INTO admin_actions (id, admin_id, action, target_type, target_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id(),
    adminId,
    action,
    targetType,
    targetId,
    reason,
    now()
  );
}

export async function listAdminActions(limit = 100): Promise<AdminActionRow[]> {
  return q<AdminActionRow>(
    `SELECT a.*, u.email AS admin_email
     FROM admin_actions a JOIN users u ON u.id = a.admin_id
     ORDER BY a.created_at DESC LIMIT ?`,
    limit
  );
}
