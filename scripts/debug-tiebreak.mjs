/** Raw values behind the tie-break mystery. */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
const rows = await sql.unsafe(`
  SELECT cp.username, p.campaign_id, p.qualified_count, p.last_qualified_at,
    pg_typeof(p.last_qualified_at) AS t,
    COALESCE(MAX(p.last_qualified_at) OVER (PARTITION BY p.user_id), 9e15) AS coalesced
  FROM campaign_participants p
  JOIN creator_profiles cp ON cp.user_id = p.user_id
  WHERE cp.username IN ('sami1990','cyberzaak')
  ORDER BY cp.username`);
for (const r of rows) {
  console.log(
    `@${r.username} | campaign=${String(r.campaign_id).slice(0, 8)} | q=${r.qualified_count} | ` +
      `last_qualified_at=${r.last_qualified_at} (${r.t}) | coalesced=${r.coalesced}`
  );
}
await sql.end();
