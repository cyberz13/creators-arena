// Diagnostic: live connections + long-running queries on Supabase (PGURL env).
import postgres from "postgres";
const sql = postgres(process.env.PGURL, { ssl: "require", max: 1, prepare: false });
const acts = await sql.unsafe(
  `SELECT pid, state, wait_event_type, wait_event,
          EXTRACT(EPOCH FROM (now() - query_start))::int AS secs,
          LEFT(query, 90) AS q
   FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid()
   ORDER BY query_start ASC NULLS LAST LIMIT 20`
);
for (const a of acts) {
  console.log(`pid=${a.pid} state=${a.state} wait=${a.wait_event_type ?? "-"}/${a.wait_event ?? "-"} secs=${a.secs ?? "-"} | ${(a.q ?? "").replace(/\s+/g, " ")}`);
}
console.log("connections=" + acts.length);
const locks = await sql.unsafe(
  "SELECT COUNT(*) AS c FROM pg_locks WHERE locktype = 'advisory'"
);
console.log("advisory-locks=" + locks[0].c);
await sql.end();
