import type { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

const DEFAULT_CATEGORIES: [string, string, string][] = [
  ["fashion", "موضة وأزياء", "Fashion"],
  ["beauty", "جمال وعناية", "Beauty"],
  ["food", "طعام ومطاعم", "Food"],
  ["lifestyle", "لايف ستايل", "Lifestyle"],
  ["tech", "تقنية", "Tech"],
  ["gaming", "قيمنق", "Gaming"],
  ["fitness", "لياقة وصحة", "Fitness"],
  ["travel", "سفر", "Travel"],
  ["general", "عام", "General"],
];

/** Idempotent: seeds default categories and the admin account on first run. */
export function ensureBootstrap(db: DatabaseSync) {
  const insertCat = db.prepare(
    "INSERT OR IGNORE INTO categories (id, name_ar, name_en, sort, active) VALUES (?, ?, ?, ?, 1)"
  );
  DEFAULT_CATEGORIES.forEach(([id, ar, en], i) => insertCat.run(id, ar, en, i));

  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!hasAdmin) {
    // Default credentials exist for local development only. A production
    // process must provision the admin explicitly (db-push requires
    // ADMIN_PASSWORD); refusing here closes the "known default" hole.
    const isProduction = process.env.NODE_ENV === "production";
    const adminEmail = process.env.ADMIN_EMAIL ?? (isProduction ? undefined : "admin@tahaddi.local");
    const password = process.env.ADMIN_PASSWORD ?? (isProduction ? undefined : "Admin@12345");
    if (!adminEmail || !password || (isProduction && password.length < 12)) {
      throw new Error("Configuration error: ADMIN_EMAIL and a strong ADMIN_PASSWORD are required to bootstrap the admin account in production");
    }
    db.prepare(
      "INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES (?, ?, ?, 'admin', 'active', ?)"
    ).run(crypto.randomUUID(), adminEmail, bcrypt.hashSync(password, 10), Date.now());
  }
}
