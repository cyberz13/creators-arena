/**
 * Runs the PRODUCTION build locally on port 3200 against a local SQLite file
 * (never the production database) with ephemeral, never-printed secrets.
 *   npm run build && node scripts/start-prod-local.mjs
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
delete process.env.DATABASE_URL; // hard guarantee: SQLite only
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/prod-local.db",
  SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString("base64url"),
  CHALLENGE_SECRET: process.env.CHALLENGE_SECRET ?? randomBytes(32).toString("base64url"),
  IP_HASH_SALT: process.env.IP_HASH_SALT ?? randomBytes(16).toString("base64url"),
  MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "https://localhost:3200",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "admin@local.test",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url"),
  REGISTRATION_MODE: process.env.REGISTRATION_MODE ?? "open",
};
console.log("production build on local SQLite (port 3200); admin password is random unless ADMIN_PASSWORD is set");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3200"], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
