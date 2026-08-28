/** Verify the season leaderboard order against the tie-break rule. */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
const rows = await sql.unsafe(`
  SELECT cp.username,
    COALESCE(SUM(p.qualified_count),0) AS total,
    MAX(p.last_qualified_at) AS reached_at
  FROM campaign_participants p
  JOIN creator_profiles cp ON cp.user_id = p.user_id
  GROUP BY cp.username
  ORDER BY total DESC, reached_at ASC NULLS LAST`);
for (const r of rows) {
  const t = r.reached_at ? new Date(Number(r.reached_at)).toISOString().slice(0, 19).replace("T", " ") : "—";
  console.log(`@${r.username}: ${r.total} (بلغ مجموعه ${t} UTC)`);
}
await sql.end();
