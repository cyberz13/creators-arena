import { DatabaseSync } from "node:sqlite";
import { migrate, setDbForTests, one, id, now, run } from "@/lib/db";
import { ensureBootstrap } from "@/lib/bootstrap";
import { createCampaign, type CampaignInput } from "@/services/campaigns";

export function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  setDbForTests(db);
  migrate(db);
  ensureBootstrap(db);
  return db;
}

export async function adminId(): Promise<string> {
  return (await one<{ id: string }>("SELECT id FROM users WHERE role = 'admin'"))!.id;
}

let creatorCounter = 0;

/** Fast creator factory (skips bcrypt for speed). */
export async function makeCreator(username?: string): Promise<string> {
  creatorCounter += 1;
  const uname = username ?? `creator${creatorCounter}`;
  const userId = id();
  await run(
    "INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES (?, ?, 'x', 'creator', 'active', ?)",
    userId,
    `${uname}@test.local`,
    now()
  );
  await run(
    `INSERT INTO creator_profiles (user_id, name, username, followers_count, category_id, created_at)
     VALUES (?, ?, ?, 1000, 'general', ?)`,
    userId,
    uname,
    uname,
    now()
  );
  return userId;
}

export async function makeCampaign(overrides: Partial<CampaignInput> = {}, launch = true) {
  const input: CampaignInput = {
    title: "تحدي متجر الاختبار",
    description: "وصف",
    requirements: "",
    store_name: "متجر الاختبار",
    store_url: "https://store.example.com",
    start_at: Date.now() - 3_600_000,
    end_at: Date.now() + 7 * 86_400_000,
    prizes: [500],
    ...overrides,
  };
  return createCampaign(input, await adminId(), launch);
}

let visitorCounter = 0;

/** Unique visitor identity per call (fresh ip + session + device). */
export function visitor() {
  visitorCounter += 1;
  return {
    ipHash: `ip-${visitorCounter}`,
    sessionId: `sess-${visitorCounter}`,
    deviceHash: `dev-${visitorCounter}`,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  };
}
