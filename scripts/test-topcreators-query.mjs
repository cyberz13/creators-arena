/** Run the exact production topCreators query (with $-params) against PG. */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
const rows = await sql.unsafe(
  `SELECT p.user_id, cp.username, cp.name, cp.followers_count, cat.name_ar AS category_name,
     COALESCE(SUM(p.qualified_count),0) AS qualified_total,
     COALESCE(SUM(p.is_winner),0) AS wins
   FROM campaign_participants p
   JOIN creator_profiles cp ON cp.user_id = p.user_id
   LEFT JOIN categories cat ON cat.id = cp.category_id
   GROUP BY p.user_id, cp.username, cp.name, cp.followers_count, cat.name_ar
   ORDER BY qualified_total DESC, COALESCE(MAX(p.last_qualified_at), 9e15) ASC LIMIT $1`,
  [20]
);
for (const r of rows) console.log(`@${r.username}: ${r.qualified_total}`);
await sql.end();
