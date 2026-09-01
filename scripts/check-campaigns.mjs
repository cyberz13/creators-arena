// Diagnostic: recent campaigns + campaigns table columns (PGURL env).
import postgres from "postgres";
const sql = postgres(process.env.PGURL, { ssl: "require", max: 1, prepare: false });
const cols = await sql.unsafe(
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'campaigns' ORDER BY ordinal_position"
);
console.log("columns:", cols.map((c) => c.column_name).join(", "));
const rows = await sql.unsafe(
  "SELECT id, title, status, created_at, launched_at, report_token FROM campaigns ORDER BY created_at DESC LIMIT 5"
);
for (const r of rows) {
  console.log(
    new Date(Number(r.created_at)).toISOString(),
    "|", r.status,
    "|", r.title,
    "| token=" + (r.report_token ? "yes" : "no")
  );
}
console.log("total-listed=" + rows.length);
await sql.end();
