/**
 * Diagnostic dev server wired to the PRODUCTION database (.env.production).
 * For reproducing prod-only issues locally — never leave running.
 *   node scripts/dev-proddb.mjs   (port 3100)
 */
import fs from "node:fs";
import { spawn } from "node:child_process";

const envFile = fs.readFileSync(".env.production", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "").trim();
}
if (!process.env.DATABASE_URL) {
  console.error("no DATABASE_URL in .env.production");
  process.exit(1);
}
console.log("⚠️  dev server on PRODUCTION DB (port 3100)");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3100"], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
