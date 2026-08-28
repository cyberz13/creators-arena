/**
 * Applies the Postgres schema + bootstrap data (categories, admin account)
 * to the Supabase database in DATABASE_URL. Idempotent — safe to re-run.
 *
 *   DATABASE_URL="postgresql://..." npm run db:push
 */
import fs from "node:fs";
import postgres from "postgres";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres/.test(url)) {
  console.error("❌ ضع DATABASE_URL (رابط Supabase) في البيئة أو .env.local ثم أعد المحاولة");
  process.exit(1);
}

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

for (const stmt of statements) {
  await sql.unsafe(stmt);
}
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
