/** Post-fix verdict: how were the last 10 minutes of clicks classified per IP? */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
const since = Date.now() - 10 * 60 * 1000;
const rows = await sql.unsafe(
  `SELECT ip_hash, status, reject_reason, COUNT(*) AS c
   FROM clicks WHERE created_at > $1
   GROUP BY ip_hash, status, reject_reason
   ORDER BY ip_hash, status`,
  [since]
);
if (rows.length === 0) console.log("لا نقرات خلال آخر 10 دقائق");
for (const x of rows) {
  console.log(`${x.ip_hash.slice(0, 10)}…  ${x.status}  ${x.reject_reason ?? "-"}  ×${x.c}`);
}
await sql.end();
