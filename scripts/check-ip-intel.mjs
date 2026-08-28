// Diagnostic: list cached network-intel rows (run with PGURL env for prod).
import postgres from "postgres";
const sql = postgres(process.env.PGURL, { ssl: "require", max: 1, prepare: false });
const rows = await sql.unsafe(
  "SELECT ip_hash, risky, flags, asn_org, country, city, checked_at FROM ip_intel ORDER BY checked_at DESC LIMIT 10"
);
for (const r of rows) {
  console.log(
    new Date(Number(r.checked_at)).toISOString(),
    "|", r.ip_hash.slice(0, 10) + "…",
    "| risky=" + r.risky,
    "|", r.flags ?? "-",
    "|", r.asn_org ?? "-",
    "|", (r.city ?? "-") + "," + (r.country ?? "-")
  );
}
console.log("rows=" + rows.length);
await sql.end();
