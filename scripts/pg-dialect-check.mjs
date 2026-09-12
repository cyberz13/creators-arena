/**
 * PostgreSQL dialect validation on PGlite (a real Postgres compiled to WASM —
 * no server, no native binaries, never touches any external database).
 *
 * Proves that every PostgreSQL-only code path parses and behaves as intended:
 *   - schema.pg.sql applies from scratch and the additive db-push ALTERs are re-runnable;
 *   - migrations/0001_deny_by_default.sql applies with the Supabase roles present and
 *     yields the state scripts/db-security-check.mjs expects;
 *   - the atomic rate-limit upsert, dedupe-keyed notifications, one-time challenge
 *     consumption, conditional payout update, Riyadh hour-of-day aggregation and the
 *     advisory lock calls all execute on PostgreSQL.
 * Multi-connection concurrency is NOT covered here (PGlite is single-session);
 * that is scripts/pg-concurrency-test.mjs (CI job with postgres:16).
 *
 *   node scripts/pg-dialect-check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const db = new PGlite();
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures += 1; };
const statements = (sqlText) => sqlText.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);

try {
  // 1. schema from scratch + additive migrations (mirrors scripts/db-push.mjs)
  for (const stmt of statements(fs.readFileSync("src/lib/schema.pg.sql", "utf8"))) await db.exec(stmt);
  const pushSrc = fs.readFileSync("scripts/db-push.mjs", "utf8");
  const alters = [...pushSrc.matchAll(/await sql\.unsafe\("(ALTER TABLE IF EXISTS [^"]+|UPDATE campaigns SET results_status[^"]+)"\)/g)].map((m) => m[1]);
  for (const a of alters) await db.exec(a);
  for (const a of alters) await db.exec(a); // re-runnable
  check(alters.length >= 10, `schema.pg.sql applied; ${alters.length} additive ALTER/UPDATE statements re-ran cleanly`);
  const tables = (await db.query("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
  check(tables === 21, `21 application tables present (${tables})`);

  // 2. migration 0001 with Supabase roles present
  await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; GRANT USAGE ON SCHEMA public TO anon, authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;");
  const before = (await db.query("SELECT has_table_privilege('anon','public.users','SELECT') AS v")).rows[0].v;
  check(before === true, "before migration: anon can read users (the exposure being fixed)");
  const migration = fs.readFileSync("migrations/0001_deny_by_default.sql", "utf8");
  await db.exec(migration.replace(/^BEGIN;|COMMIT;$/gm, ""));
  const after = (await db.query("SELECT has_table_privilege('anon','public.users','SELECT') AS a, has_table_privilege('authenticated','public.sessions','SELECT') AS b, has_table_privilege('anon','public.clicks','INSERT') AS c")).rows[0];
  check(after.a === false && after.b === false && after.c === false, "after migration: anon/authenticated lost every table privilege");
  // Schema USAGE is inherited from PUBLIC on every PostgreSQL; table-level denial is the control.
  const anonTables = (await db.query("SELECT COUNT(*)::int AS n FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated') AND table_schema='public'")).rows[0].n;
  check(anonTables === 0, `no explicit table grants remain for anon/authenticated (${anonTables})`);
  const rls = (await db.query("SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r' AND relrowsecurity")).rows[0].n;
  check(rls === 21, `RLS enabled on all 21 tables (${rls})`);
  const runtime = (await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='app_runtime'")).rows[0];
  check(!!runtime && !runtime.rolsuper && !runtime.rolbypassrls, "app_runtime exists without superuser/bypassrls");
  const policies = (await db.query("SELECT COUNT(*)::int AS n FROM pg_policies WHERE policyname='app_runtime_all'")).rows[0].n;
  check(policies === 21, `app_runtime_all policy on all tables (${policies})`);
  const grants = (await db.query("SELECT COUNT(DISTINCT table_name)::int AS n FROM information_schema.role_table_grants WHERE grantee='app_runtime' AND privilege_type='UPDATE'")).rows[0].n;
  check(grants === 21, `app_runtime has DML on all tables (${grants})`);
  // Running as app_runtime through RLS returns rows (policy works)
  await db.exec("INSERT INTO settings (key, value) VALUES ('probe','1')");
  await db.exec("SET ROLE app_runtime");
  const asRuntime = (await db.query("SELECT COUNT(*)::int AS n FROM settings")).rows[0].n;
  await db.exec("RESET ROLE");
  check(asRuntime === 1, "app_runtime sees rows through its RLS policy");

  // 3. dialect-specific statements used by the app
  const now = Date.now();
  const upsert = `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, $2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= $3 THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= $3 THEN $2 ELSE rate_limits.window_start END`;
  for (let i = 0; i < 3; i++) await db.query(upsert, ["k", now, now - 1000]);
  let rl = (await db.query("SELECT count FROM rate_limits WHERE key='k'")).rows[0].count;
  check(rl === 3, `rate-limit upsert increments atomically (${rl})`);
  await db.query(upsert, ["k", now + 5000, now + 5000 - 1000]);
  rl = (await db.query("SELECT count FROM rate_limits WHERE key='k'")).rows[0].count;
  check(rl === 1, `rate-limit window resets (${rl})`);

  await db.exec(`INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES ('u1','u1@t.test','x','creator','active',${now})`);
  const noteSql = `INSERT INTO notifications (id, user_id, type, title, body, campaign_id, read, dedupe_key, created_at)
     VALUES ($1, 'u1', 'campaign_won', 't', '', NULL, 0, 'dk', ${now}) ON CONFLICT(dedupe_key) DO NOTHING`;
  await db.query(noteSql, ["n1"]); await db.query(noteSql, ["n2"]);
  const notes = (await db.query("SELECT COUNT(*)::int AS n FROM notifications")).rows[0].n;
  check(notes === 1, "dedupe-keyed notification inserted once");

  await db.exec(`INSERT INTO challenges (id, code, ip_hash, visitor_id, issued_at) VALUES ('ch1','abc1234','ip','v',${now})`);
  const c1 = await db.query("UPDATE challenges SET consumed_at = $1 WHERE id = 'ch1' AND consumed_at IS NULL", [now]);
  const c2 = await db.query("UPDATE challenges SET consumed_at = $1 WHERE id = 'ch1' AND consumed_at IS NULL", [now]);
  check(c1.affectedRows === 1 && c2.affectedRows === 0, "one-time challenge: conditional UPDATE affects 1 then 0 rows");

  await db.exec(`INSERT INTO campaigns (id, title, store_name, store_url, status, start_at, end_at, created_by, created_at, results_status)
     VALUES ('c1','t','s','https://s.test','ended',${now},${now},'u1',${now},'final')`);
  await db.exec(`INSERT INTO payouts (id, campaign_id, user_id, prize_rank, amount, status, created_at) VALUES ('p1','c1','u1',1,100,'pending',${now})`);
  const p1 = await db.query("UPDATE payouts SET status = 'approved' WHERE id = 'p1' AND status = 'pending'");
  const p2 = await db.query("UPDATE payouts SET status = 'approved' WHERE id = 'p1' AND status = 'pending'");
  check(p1.affectedRows === 1 && p2.affectedRows === 0, "payout conditional transition wins once");

  await db.exec(`INSERT INTO campaign_participants (id, campaign_id, user_id, joined_at) VALUES ('pp1','c1','u1',${now})`);
  await db.exec(`INSERT INTO tracking_links (id, code, campaign_id, participant_id, user_id, created_at) VALUES ('l1','abc1234','c1','pp1','u1',${now})`);
  const riyadh10 = Date.UTC(2026, 8, 1, 7, 0, 0); // 07:00 UTC = 10:00 Riyadh
  await db.exec(`INSERT INTO clicks (id, tracking_link_id, campaign_id, user_id, status, ip_hash, session_id, created_at) VALUES ('k1','l1','c1','u1','qualified','i','s',${riyadh10})`);
  const hourExpr = "(EXTRACT(HOUR FROM (to_timestamp(created_at / 1000.0) AT TIME ZONE 'Asia/Riyadh')))::int";
  await db.exec("SET TIME ZONE 'America/New_York'"); // prove the expression ignores the session zone
  const hour = (await db.query(`SELECT ${hourExpr} AS hour, COUNT(*)::int AS n FROM clicks GROUP BY ${hourExpr}`)).rows[0];
  check(hour.hour === 10 && hour.n === 1, `Riyadh hour-of-day aggregation in SQL (hour=${hour.hour})`);

  const ordering = await db.query("SELECT user_id FROM campaign_participants WHERE campaign_id='c1' ORDER BY qualified_count DESC, COALESCE(last_qualified_at, 9e15) ASC, joined_at ASC");
  check(ordering.rows.length === 1, "standings ORDER BY with COALESCE(bigint, 9e15) is valid");

  await db.exec("BEGIN; SELECT pg_advisory_xact_lock(hashtext('campaign:c1')); SELECT pg_advisory_xact_lock_shared(hashtext('campaign:c1')); COMMIT;");
  check(true, "advisory lock calls (exclusive + shared) execute");

  const seq = (await db.query("SELECT relname FROM pg_class WHERE relkind='S'")).rows.length;
  check(seq === 0, "no sequences (uuid ids) — nothing for anon to enumerate");
} catch (e) {
  check(false, "run: " + String(e?.message ?? e));
} finally {
  await db.close();
}
console.log(failures === 0 ? "ALL POSTGRES DIALECT CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
