/**
 * Applies the Postgres schema + bootstrap data (categories, admin account)
 * to the Supabase database in DATABASE_URL. Idempotent — safe to re-run.
 *
 *   MIGRATION_DATABASE_URL="postgresql://..." CONFIRM_PROD_WRITE=I_UNDERSTAND npm run db:push
 */
import fs from "node:fs";
import postgres from "postgres";
import bcrypt from "bcryptjs";

// Migrations use a SEPARATE, higher-privilege connection (table owner). The
// application's runtime DATABASE_URL (limited role app_runtime) is not accepted.
const url = process.env.MIGRATION_DATABASE_URL;
if (!url || !/^postgres/.test(url)) {
  console.error("❌ ضع MIGRATION_DATABASE_URL (اتصال المالك — للترحيلات فقط، لا يوضع في Vercel) ثم أعد المحاولة");
  process.exit(1);
}
if (process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND") {
  console.error("❌ هذا السكربت يعدّل مخطط قاعدة حية. ضع CONFIRM_PROD_WRITE=I_UNDERSTAND للمتابعة");
  process.exit(1);
}
console.error("⚠️  migrating schema on: " + new URL(url).host);

const sql = postgres(url, { ssl: "require", max: 1, prepare: false });

const schema = fs
  .readFileSync("src/lib/schema.pg.sql", "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// Additive migrations FIRST: schema.sql's new indexes may reference columns
// that CREATE TABLE IF NOT EXISTS won't add to a pre-existing table.
await sql.unsafe("ALTER TABLE IF EXISTS clicks ADD COLUMN IF NOT EXISTS device_hash TEXT");
await sql.unsafe("ALTER TABLE IF EXISTS clicks ADD COLUMN IF NOT EXISTS geo_country TEXT");
await sql.unsafe("ALTER TABLE IF EXISTS clicks ADD COLUMN IF NOT EXISTS geo_city TEXT");
await sql.unsafe("ALTER TABLE IF EXISTS clicks ADD COLUMN IF NOT EXISTS signals TEXT");
await sql.unsafe("ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS report_token TEXT");
await sql.unsafe("ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS results_status TEXT NOT NULL DEFAULT 'open'");
await sql.unsafe("ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS report_token_expires_at BIGINT");
await sql.unsafe("ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS report_views INTEGER NOT NULL DEFAULT 0");
await sql.unsafe("ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS report_last_viewed_at BIGINT");
// Links issued before expiry existed get the standard 90-day validity from now.
await sql.unsafe("UPDATE campaigns SET report_token_expires_at = " + (Date.now() + 90 * 86400000) + " WHERE report_token IS NOT NULL AND report_token_expires_at IS NULL");
await sql.unsafe("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS participation_status TEXT NOT NULL DEFAULT 'active'");
await sql.unsafe("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS approved INTEGER NOT NULL DEFAULT 1");
await sql.unsafe("ALTER TABLE IF EXISTS campaign_participants ADD COLUMN IF NOT EXISTS excluded INTEGER NOT NULL DEFAULT 0");
await sql.unsafe("ALTER TABLE IF EXISTS campaign_participants ADD COLUMN IF NOT EXISTS excluded_reason TEXT");
await sql.unsafe("ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT");
await sql.unsafe("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 1");
await sql.unsafe("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS mfa_enabled INTEGER NOT NULL DEFAULT 0");
await sql.unsafe("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT");

for (const stmt of statements) {
  await sql.unsafe(stmt);
}
// Campaigns finalized before the results lifecycle existed were treated as final.
await sql.unsafe("UPDATE campaigns SET results_status = 'final' WHERE status IN ('ended','cancelled') AND results_status = 'open'");
console.log(`✅ Schema: ${statements.length} statement applied (+ additive migrations)`);

const CATEGORIES = [
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
for (let i = 0; i < CATEGORIES.length; i++) {
  const [id, ar, en] = CATEGORIES[i];
  await sql.unsafe(
    "INSERT INTO categories (id, name_ar, name_en, sort, active) VALUES ($1,$2,$3,$4,1) ON CONFLICT (id) DO NOTHING",
    [id, ar, en, i]
  );
}
console.log("✅ Categories");

const hasAdmin = await sql.unsafe("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
if (hasAdmin.length === 0) {
  const email = process.env.ADMIN_EMAIL ?? "admin@tahaddi.local";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error("❌ ضع ADMIN_PASSWORD في البيئة لإنشاء حساب الأدمن الأول");
    process.exit(1);
  }
  await sql.unsafe(
    "INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES ($1,$2,$3,'admin','active',$4)",
    [crypto.randomUUID(), email, bcrypt.hashSync(password, 10), Date.now()]
  );
  console.log(`✅ Admin account: ${email}`);
} else {
  console.log("✅ Admin account exists");
}

await sql.end();
console.log("\n🚀 Supabase جاهزة");
