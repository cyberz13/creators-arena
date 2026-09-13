/**
 * Diagnostic dev server wired to a LIVE database. This is the most dangerous
 * script in the repository: it runs the full application (writes included)
 * against whatever PGURL points to.
 *
 * It refuses to start unless ALL of the following hold:
 *   PGURL=postgresql://...              (from the shell — never from a file)
 *   CONFIRM_PROD_ACCESS=I_UNDERSTAND
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND
 *   DEV_PRODDB_ACK=<the database host>   (retype the host to prove intent)
 *
 * Prefer scripts/start-prod-local.mjs (SQLite) or a staging database.
 */
import { spawn } from "node:child_process";
import { requireProdAccess } from "./lib/prod-guard.mjs";

const url = requireProdAccess({ write: true });
const host = new URL(url).host;
if (process.env.DEV_PRODDB_ACK !== host) {
  console.error("refusing to run: set DEV_PRODDB_ACK to the exact database host to confirm");
  process.exit(2);
}
console.error("⚠️  dev server on a LIVE database (port 3100). Stop it as soon as you are done.");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3100"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
child.on("exit", (code) => process.exit(code ?? 0));
