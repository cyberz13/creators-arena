/**
 * Packs the deployable source into deploy/bundle.b64 (base64 of tar.gz).
 * Vercel's installCommand unpacks it before `npm install` — this lets the
 * MCP file-deploy carry ONE compact file instead of the whole tree.
 *
 *   node scripts/make-deploy-bundle.mjs <SESSION_SECRET> <IP_HASH_SALT> <APP_URL> [DATABASE_URL]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const [sessionSecret, ipSalt, appUrl, dbUrl] = process.argv.slice(2);
if (!sessionSecret || !ipSalt || !appUrl) {
  console.error("usage: make-deploy-bundle.mjs <SESSION_SECRET> <IP_HASH_SALT> <APP_URL> [DATABASE_URL]");
  process.exit(1);
}

const envProd = [
  `SESSION_SECRET=${sessionSecret}`,
  `IP_HASH_SALT=${ipSalt}`,
  `NEXT_PUBLIC_APP_URL=${appUrl}`,
  dbUrl ? `DATABASE_URL=${dbUrl}` : "# DATABASE_URL=  (Supabase — مطلوب للتشغيل)",
  "",
].join("\n");
fs.writeFileSync(".env.production", envProd);

fs.mkdirSync("deploy", { recursive: true });
execSync(
  'tar -czf deploy/bundle.tgz next.config.ts tsconfig.json postcss.config.mjs .env.production src public/logo.png',
  { stdio: "inherit" }
);

const raw = fs.readFileSync("deploy/bundle.tgz");
const b64 = raw.toString("base64").replace(/(.{100})/g, "$1\n");
fs.writeFileSync("deploy/bundle.b64", b64);
console.log(`bundle.tgz: ${raw.length} bytes → bundle.b64: ${b64.length} chars, ${b64.split("\n").length} lines`);
