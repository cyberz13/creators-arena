/**
 * READ-ONLY verification of the PostgreSQL hardening (migrations/0001):
 *   - RLS enabled on every application table;
 *   - no privileges for `anon` / `authenticated` on application tables;
 *   - `app_runtime` has exactly SELECT/INSERT/UPDATE/DELETE and nothing more;
 *   - sensitive tables are not reachable through the Data API roles.
 *
 * Never run automatically. Manual invocation (owner or read-only connection):
 *   PGURL="postgresql://..." CONFIRM_PROD_ACCESS=I_UNDERSTAND node scripts/db-security-check.mjs
 * Exit code 0 = all checks pass. Prints no secrets.
 */
import postgres from "postgres";
import { requireProdAccess } from "./lib/prod-guard.mjs";

const url = requireProdAccess({ write: false });
const sql = postgres(url, { ssl: "require", max: 1, prepare: false });

const TABLES = [
  "users", "categories", "creator_profiles", "campaigns", "prizes", "campaign_participants",
  "tracking_links", "clicks", "ip_intel", "campaign_daily_stats", "payouts", "notifications",
  "admin_actions", "settings", "challenges", "sessions", "rate_limits", "auth_tokens",
  "mail_outbox", "mfa_recovery_codes",
];
const SENSITIVE = ["users", "sessions", "auth_tokens", "mfa_recovery_codes", "clicks", "mail_outbox"];

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures += 1; };

try {
  const rls = await sql.unsafe(
    `SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND relkind = 'r' AND relname = ANY($1)`, [TABLES]);
  for (const t of TABLES) {
    const row = rls.find((r) => r.relname === t);
    report(!!row && row.relrowsecurity === true, `RLS enabled on ${t}`);
  }

  const grants = await sql.unsafe(
    `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee IN ('anon','authenticated') AND table_name = ANY($1)`, [TABLES]);
  report(grants.length === 0, `no table grants for anon/authenticated (found ${grants.length})`);
  for (const g of grants) console.log(`      leak: ${g.grantee} ${g.privilege_type} on ${g.table_name}`);

  const schemaUsage = await sql.unsafe(
    `SELECT has_schema_privilege('anon','public','USAGE') AS anon_usage,
            has_schema_privilege('authenticated','public','USAGE') AS auth_usage`);
  // Informational: schema USAGE is normally inherited from PUBLIC; the table-level checks below are the control.
  console.log(`      info: schema USAGE anon=${schemaUsage[0].anon_usage} authenticated=${schemaUsage[0].auth_usage} (table privileges decide access)`);

  const runtime = await sql.unsafe(`SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'app_runtime'`);
  report(runtime.length === 1, "role app_runtime exists");
  if (runtime.length === 1) {
    const r = runtime[0];
    report(!r.rolsuper && !r.rolbypassrls && !r.rolcreaterole && !r.rolcreatedb, "app_runtime is not superuser / bypassrls / createrole / createdb");
    const rg = await sql.unsafe(
      `SELECT table_name, array_agg(privilege_type ORDER BY privilege_type) AS privs
       FROM information_schema.role_table_grants WHERE grantee = 'app_runtime' AND table_schema = 'public'
       GROUP BY table_name`);
    for (const t of TABLES) {
      const row = rg.find((x) => x.table_name === t);
      const privs = row ? row.privs.join(",") : "";
      report(privs === "DELETE,INSERT,SELECT,UPDATE", `app_runtime grants on ${t} = [${privs || "none"}]`);
    }
    const policies = await sql.unsafe(`SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='app_runtime_all'`);
    report(policies.length === TABLES.length, `app_runtime_all policy on every table (${policies.length}/${TABLES.length})`);
  }

  for (const t of SENSITIVE) {
    const p = await sql.unsafe(
      `SELECT has_table_privilege('anon', 'public.' || $1, 'SELECT') AS a, has_table_privilege('authenticated', 'public.' || $1, 'SELECT') AS b`, [t]);
    report(p[0].a === false && p[0].b === false, `Data API roles cannot SELECT ${t}`);
  }
} catch (e) {
  report(false, "run: " + String(e?.message ?? e));
} finally {
  await sql.end();
}
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
