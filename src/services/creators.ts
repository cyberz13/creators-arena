import { id, now, one, q, run, tx } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import type { Category, CreatorProfile, User } from "@/lib/types";
import { DomainError } from "./campaigns";
import { logAdminAction } from "./adminActions";

export interface RegisterInput {
  name: string;
  username: string;
  email: string;
  password: string;
  phone?: string;
  tiktok?: string;
  instagram?: string;
  snapchat?: string;
  followers_count: number;
  category_id: string;
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;

export async function registerCreator(input: RegisterInput): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  if (!input.name.trim()) throw new DomainError("الاسم مطلوب");
  if (!USERNAME_RE.test(username))
    throw new DomainError("اسم المستخدم يجب أن يكون 3-30 حرفًا إنجليزيًا أو أرقامًا أو _ .");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("البريد الإلكتروني غير صالح");
  if (input.password.length < 8) throw new DomainError("كلمة المرور 8 أحرف على الأقل");
  if (await one("SELECT 1 FROM users WHERE email = ?", email)) throw new DomainError("البريد مسجل مسبقًا");
  if (await one("SELECT 1 FROM creator_profiles WHERE username = ?", username))
    throw new DomainError("اسم المستخدم محجوز");
  if (!(await one("SELECT 1 FROM categories WHERE id = ?", input.category_id)))
    throw new DomainError("التصنيف غير صالح");

  const passwordHash = await hashPassword(input.password);
  const userId = id();
  const ts = now();
  await tx(async () => {
    await run(
      `INSERT INTO users (id, email, password_hash, role, status, created_at)
       VALUES (?, ?, ?, 'creator', 'active', ?)`,
      userId,
      email,
      passwordHash,
      ts
    );
    await run(
      `INSERT INTO creator_profiles (user_id, name, username, phone, tiktok, instagram, snapchat,
         followers_count, category_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      input.name.trim(),
      username,
      input.phone?.trim() || null,
      input.tiktok?.trim() || null,
      input.instagram?.trim() || null,
      input.snapchat?.trim() || null,
      Math.max(0, Math.floor(input.followers_count || 0)),
      input.category_id,
      ts
    );
  });
  return userId;
}

export async function listCategories(): Promise<Category[]> {
  return q<Category>("SELECT * FROM categories WHERE active = 1 ORDER BY sort, name_ar");
}

export interface CreatorRow extends CreatorProfile {
  email: string;
  status: string;
  campaigns_count: number;
  qualified_total: number;
  wins: number;
  category_name: string | null;
}

export async function listCreators(filters?: {
  search?: string;
  categoryId?: string;
  minFollowers?: number;
}): Promise<CreatorRow[]> {
  const where: string[] = ["u.role = 'creator'"];
  const params: (string | number)[] = [];
  if (filters?.search) {
    where.push("(cp.username LIKE ? OR cp.name LIKE ? OR u.email LIKE ?)");
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }
  if (filters?.categoryId) {
    where.push("cp.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters?.minFollowers) {
    where.push("cp.followers_count >= ?");
    params.push(filters.minFollowers);
  }
  return q<CreatorRow>(
    `SELECT cp.*, u.email, u.status, cat.name_ar AS category_name,
       (SELECT COUNT(*) FROM campaign_participants p WHERE p.user_id = u.id) AS campaigns_count,
       (SELECT COALESCE(SUM(p.qualified_count),0) FROM campaign_participants p WHERE p.user_id = u.id) AS qualified_total,
       (SELECT COUNT(*) FROM campaign_participants p WHERE p.user_id = u.id AND p.is_winner = 1) AS wins
     FROM users u
     JOIN creator_profiles cp ON cp.user_id = u.id
     LEFT JOIN categories cat ON cat.id = cp.category_id
     WHERE ${where.join(" AND ")}
     ORDER BY qualified_total DESC`,
    ...params
  );
}

export async function getCreatorDetail(userId: string) {
  const creator = await one<CreatorRow>(
    `SELECT cp.*, u.email, u.status, cat.name_ar AS category_name,
       (SELECT COUNT(*) FROM campaign_participants p WHERE p.user_id = u.id) AS campaigns_count,
       (SELECT COALESCE(SUM(p.qualified_count),0) FROM campaign_participants p WHERE p.user_id = u.id) AS qualified_total,
       (SELECT COUNT(*) FROM campaign_participants p WHERE p.user_id = u.id AND p.is_winner = 1) AS wins
     FROM users u
     JOIN creator_profiles cp ON cp.user_id = u.id
     LEFT JOIN categories cat ON cat.id = cp.category_id
     WHERE u.id = ?`,
    userId
  );
  if (!creator) return null;
  const participations = await q<{
    campaign_id: string;
    title: string;
    status: string;
    qualified_count: number;
    total_clicks: number;
    final_rank: number | null;
    is_winner: number;
    end_at: number;
  }>(
    `SELECT p.campaign_id, c.title, c.status, p.qualified_count, p.total_clicks,
            p.final_rank, p.is_winner, c.end_at
     FROM campaign_participants p JOIN campaigns c ON c.id = p.campaign_id
     WHERE p.user_id = ? ORDER BY c.end_at DESC`,
    userId
  );
  const prizes = await q<{
    campaign_id: string;
    title: string;
    amount: number;
    status: string;
    prize_rank: number;
  }>(
    `SELECT po.campaign_id, c.title, po.amount, po.status, po.prize_rank
     FROM payouts po JOIN campaigns c ON c.id = po.campaign_id
     WHERE po.user_id = ? ORDER BY po.created_at DESC`,
    userId
  );
  return { creator, participations, prizes };
}

export async function setUserStatus(
  userId: string,
  status: "active" | "disabled",
  adminId: string,
  reason: string
) {
  const user = await one<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user) throw new DomainError("المستخدم غير موجود");
  if (user.role === "admin") throw new DomainError("لا يمكن تعطيل حساب Admin");
  await run("UPDATE users SET status = ? WHERE id = ?", status, userId);
  await logAdminAction(
    adminId,
    status === "disabled" ? "user_disable" : "user_enable",
    "user",
    userId,
    reason
  );
}

export interface CreatorHomeStats {
  totalQualified: number;
  activeCampaigns: number;
  totalCampaigns: number;
  wins: number;
  totalPrizes: number;
  paidPrizes: number;
}

export async function creatorHomeStats(userId: string): Promise<CreatorHomeStats> {
  const agg = (await one<{ tq: number; tc: number; wins: number }>(
    `SELECT COALESCE(SUM(qualified_count),0) AS tq, COUNT(*) AS tc,
            COALESCE(SUM(is_winner),0) AS wins
     FROM campaign_participants WHERE user_id = ?`,
    userId
  ))!;
  const active = (await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM campaign_participants p
     JOIN campaigns c ON c.id = p.campaign_id
     WHERE p.user_id = ? AND c.status = 'active'`,
    userId
  ))!;
  const prizes = (await one<{ total: number; paid: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END),0) AS paid
     FROM payouts WHERE user_id = ? AND status != 'rejected'`,
    userId
  ))!;
  return {
    totalQualified: agg.tq,
    activeCampaigns: active.c,
    totalCampaigns: agg.tc,
    wins: agg.wins,
    totalPrizes: prizes.total,
    paidPrizes: prizes.paid,
  };
}
