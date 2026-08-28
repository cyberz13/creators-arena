import postgres from "postgres";
const sql = postgres(process.env.PGURL, { ssl: "require", max: 1, prepare: false });
const since = Date.now() - 20 * 60_000;
const rows = await sql.unsafe(
  `SELECT status, reject_reason, user_agent, created_at FROM clicks WHERE created_at > ${since} ORDER BY created_at DESC LIMIT 10`
);
for (const r of rows) {
  console.log(new Date(Number(r.created_at)).toISOString(), "|", r.status, "|", r.reject_reason, "|", (r.user_agent || "").slice(0, 45));
}
console.log("recent-clicks=" + rows.length);
await sql.end();
