/**
 * Runs the PRODUCTION build locally on port 3200 against the local SQLite DB
 * (never the production database). For reproducing prod-only rendering bugs.
 *   node scripts/start-prod-local.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
delete process.env.DATABASE_URL; // hard guarantee: SQLite only
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3200"], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
