/** Quick functional probe of the resilient Postgres driver against DATABASE_URL. */
import { q, one, tx, run } from "../src/lib/db";
// Live-database guard (see scripts/lib/prod-guard.mjs): explicit acknowledgement required.
if (!process.env.DATABASE_URL) { console.error("refusing to run: set DATABASE_URL in the shell for the target database"); process.exit(2); }
if (process.env.CONFIRM_PROD_ACCESS !== "I_UNDERSTAND") { console.error("refusing to run: this script talks to a live database. Set CONFIRM_PROD_ACCESS=I_UNDERSTAND to proceed."); process.exit(2); }


async function main() {
  const t0 = Date.now();
  const cats = await q<{ c: number }>("SELECT COUNT(*) AS c FROM categories");
  const users = await one<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  await tx(async () => {
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", "healthcheck", String(Date.now()));
  });
  const hc = await one<{ value: string }>("SELECT value FROM settings WHERE key = ?", "healthcheck");
  console.log(`categories=${cats[0].c} users=${users?.c} tx-write=${hc ? "ok" : "fail"} total=${Date.now() - t0}ms`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
