/** One-time: removes smoke-test data from the production Supabase DB. */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
await sql.unsafe("DELETE FROM campaigns WHERE title LIKE '%الافتتاح%'");
await sql.unsafe("DELETE FROM users WHERE email = 'first.arena@example.com'");
await sql.unsafe("DELETE FROM admin_actions");
await sql.unsafe("DELETE FROM notifications");
const [c] = await sql.unsafe(
  "SELECT (SELECT COUNT(*) FROM campaigns) AS campaigns, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM clicks) AS clicks"
);
console.log(`بعد التنظيف: حملات=${c.campaigns} مستخدمون=${c.users} نقرات=${c.clicks}`);
await sql.end();
