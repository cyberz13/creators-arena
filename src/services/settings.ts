import { one, run } from "@/lib/db";

/** Fraud/tracking knobs, editable from the admin panel. */
export const DEFAULT_SETTINGS = {
  // Same visitor (session or ip) counts once per campaign within this window.
  dedup_window_hours: 24,
  // Max clicks per ip_hash per campaign per minute before rejecting as rate_limited.
  rate_limit_per_minute: 5,
  // Clicks from same ip_hash per campaign per 24h beyond this go to pending_review.
  review_threshold_24h: 30,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSetting(key: SettingKey): Promise<number> {
  const row = await one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS[key];
}

export async function setSetting(key: SettingKey, value: number) {
  await run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    String(value)
  );
}

export async function getAllSettings(): Promise<Record<SettingKey, number>> {
  return {
    dedup_window_hours: await getSetting("dedup_window_hours"),
    rate_limit_per_minute: await getSetting("rate_limit_per_minute"),
    review_threshold_24h: await getSetting("review_threshold_24h"),
  };
}
