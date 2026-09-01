// Diagnostic: time each admin-overview query against Supabase (PGURL env).
import postgres from "postgres";
const sql = postgres(process.env.PGURL, {
  ssl: "require",
  max: Number(process.env.MAXC ?? 1),
  prepare: false,
});
console.log("max=" + (process.env.MAXC ?? 1));

const QUERIES = [
  ["creators", "SELECT COUNT(*) AS c FROM users WHERE role = 'creator'"],
  ["active", "SELECT COUNT(*) AS c FROM campaigns WHERE status = 'active'"],
  ["ended", "SELECT COUNT(*) AS c FROM campaigns WHERE status = 'ended'"],
  ["clicks-agg", "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END),0) AS q FROM clicks"],
  ["uniq-sessions", "SELECT COUNT(DISTINCT session_id) AS c FROM clicks"],
  ["payouts", "SELECT COALESCE(SUM(amount),0) AS t FROM payouts"],
  ["winners", "SELECT COUNT(*) AS c FROM campaign_participants WHERE is_winner = 1"],
  ["daily", "SELECT day, SUM(clicks) AS clicks FROM campaign_daily_stats GROUP BY day ORDER BY day"],
  ["sources", "SELECT source, COUNT(*) AS c FROM clicks WHERE status='qualified' GROUP BY source"],
];

// sequential
for (const [name, text] of QUERIES) {
  const t0 = Date.now();
  await sql.unsafe(text);
  console.log(`seq ${name}: ${Date.now() - t0}ms`);
}
// parallel burst (like Promise.all on one client)
const t0 = Date.now();
await Promise.all(QUERIES.map(([, text]) => sql.unsafe(text)));
console.log(`parallel-all: ${Date.now() - t0}ms`);
await sql.end();
