/**
 * End-to-end HTTP verification of the tracking route against the REAL server
 * (production build, `next start`), on a throwaway SQLite database with
 * ephemeral secrets that are never printed. No network access is required:
 * the IP-intelligence lookup is skipped for loopback/private addresses.
 *
 *   npm run build && node scripts/http-security-check.mjs
 *
 * Exit code 0 only when every check passes.
 */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const PORT = Number(process.env.HTTP_CHECK_PORT ?? 3417);
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true }); // git-ignored; absent in a fresh CI checkout
const dbDir = fs.mkdtempSync(path.join(process.cwd(), "data", "http-check-"));
const dbPath = path.join(dbDir, "check.db");

const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "",
  DATABASE_PATH: dbPath,
  SESSION_SECRET: randomBytes(32).toString("base64url"),
  CHALLENGE_SECRET: randomBytes(32).toString("base64url"),
  IP_HASH_SALT: randomBytes(16).toString("base64url"),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  NEXT_PUBLIC_APP_URL: "https://localhost",
  ADMIN_EMAIL: "check@example.test",
  ADMIN_PASSWORD: randomBytes(12).toString("base64url"),
  REGISTRATION_MODE: "open",
};
delete env.VERCEL;

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  // GitHub Actions: a failing check becomes an annotation (visible without opening the log).
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=http-security-check::${name}${detail ? " — " + detail : ""}`);
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + "/campaigns", { signal: AbortSignal.timeout(5000) }); // DB-touching page: creates schema + bootstrap
      if (r.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not become ready\n" + serverLog.slice(-2000));
}

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1";
const headers = { "user-agent": UA, "sec-fetch-mode": "navigate", "x-forwarded-for": "127.0.0.1" };
const get = (p, extra = {}) => fetch(BASE + p, { headers: { ...headers, ...extra }, redirect: "manual", signal: AbortSignal.timeout(15000) });

function seedActiveLink() {
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  const uid = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES (?, ?, 'x', 'creator', 'active', ?)").run(uid, `c-${uid}@example.test`, now);
  db.prepare("INSERT INTO creator_profiles (user_id, name, username, followers_count, category_id, created_at) VALUES (?, 'c', ?, 1, 'general', ?)").run(uid, "u" + uid.slice(0, 8), now);
  const cid = randomUUID();
  db.prepare(`INSERT INTO campaigns (id, title, description, requirements, store_name, store_url, status, start_at, end_at, prize_total, winners_count, created_by, created_at, launched_at)
    VALUES (?, 't', '', '', 's', 'https://store.example.test/', 'active', ?, ?, 100, 1, ?, ?, ?)`).run(cid, now - 1000, now + 86_400_000, admin.id, now, now);
  const pid = randomUUID();
  db.prepare("INSERT INTO campaign_participants (id, campaign_id, user_id, joined_at) VALUES (?, ?, ?, ?)").run(pid, cid, uid, now);
  const code = "Chk" + randomBytes(2).toString("hex"); // 7 alnum chars
  db.prepare("INSERT INTO tracking_links (id, code, campaign_id, participant_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), code, cid, pid, uid, now);
  db.close();
  return { code, pid };
}

function qualifiedCount(pid) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const r = db.prepare("SELECT qualified_count FROM campaign_participants WHERE id = ?").get(pid);
  const clicks = db.prepare("SELECT COUNT(*) AS n FROM clicks").get().n;
  db.close();
  return { qualified: r.qualified_count, clicks };
}

try {
  await waitReady();
  const { code, pid } = seedActiveLink();

  // 1. Reflected XSS payload (the audit's A01) over real HTTP
  const payload = 'x");globalThis.__auditXss=1;//';
  const xss = await get("/go/" + encodeURIComponent(payload));
  const xssBody = await xss.text();
  check("XSS payload → 404", xss.status === 404, `status=${xss.status}`);
  check("XSS payload not reflected", !xssBody.includes(payload) && !xssBody.includes("<script"));

  // 2. Unknown but well-formed code
  const unknown = await get("/go/zzzzzzz");
  check("unknown code → 404", unknown.status === 404, `status=${unknown.status}`);

  // 3. Challenge page: static script only, escaped JSON, strict CSP
  const page = await get(`/go/${code}?utm_source=${encodeURIComponent("</script><script>globalThis.__auditXss=1</script>")}`);
  const html = await page.text();
  const csp = page.headers.get("content-security-policy") ?? "";
  check("challenge page 200", page.status === 200, `status=${page.status}`);
  check("no inline executable script", !/<script>[\s\S]*?<\/script>/.test(html) && !html.includes("</script><script>globalThis"));
  check("CSP strict", csp.includes("script-src 'self'") && csp.includes("default-src 'none'") && !csp.includes("unsafe-inline"), csp);
  check("no-store + nosniff", page.headers.get("cache-control") === "no-store" && page.headers.get("x-content-type-options") === "nosniff");
  const cookie = /tahaddi_vid=([a-f0-9-]{36})/.exec(page.headers.get("set-cookie") ?? "")?.[1] ?? "";
  check("visitor cookie HttpOnly+Path=/go+Secure", /HttpOnly/i.test(page.headers.get("set-cookie") ?? "") && /Path=\/go/.test(page.headers.get("set-cookie") ?? "") && /Secure/i.test(page.headers.get("set-cookie") ?? ""));
  // The JSON block must be data: evaluating it as an expression must not touch globals.
  const cfgJson = /id="ca-config">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "null";
  const ctx = {};
  runInNewContext("(" + cfgJson + ")", ctx, { timeout: 1000 });
  check("config block is inert data", ctx.__auditXss === undefined);
  const staticJs = await fetch(BASE + "/go-challenge.js");
  check("static challenge script served", staticJs.status === 200 && (await staticJs.text()).includes("ca-config"));

  // 4. One-time token over HTTP: first use counts, replay does not
  const token = JSON.parse(cfgJson).t;
  const first = await get(`/go/${code}?t=${encodeURIComponent(token)}&fp=a&el=300&ix=1`, { cookie: `tahaddi_vid=${cookie}` });
  const second = await get(`/go/${code}?t=${encodeURIComponent(token)}&fp=b&el=300&ix=1`, { cookie: `tahaddi_vid=${cookie}` });
  const after = qualifiedCount(pid);
  check("first token use → 302 to store", first.status === 302 && (first.headers.get("location") ?? "").startsWith("https://store.example.test"), `status=${first.status}`);
  check("replay → 302 but NOT counted", second.status === 302 && after.qualified === 1 && after.clicks === 1, `qualified=${after.qualified} clicks=${after.clicks}`);

  // 5. Site-wide security headers (proxy CSP with nonce + next.config headers)
  const login = await get("/login");
  const siteCsp = login.headers.get("content-security-policy") ?? "";
  check("site CSP with nonce + strict-dynamic, no unsafe-eval", /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/.test(siteCsp) && !siteCsp.includes("unsafe-eval") && siteCsp.includes("frame-ancestors 'none'"), siteCsp.slice(0, 120));
  check("HSTS + nosniff + frame + referrer + permissions", login.headers.get("strict-transport-security")?.includes("max-age=63072000") === true && login.headers.get("x-content-type-options") === "nosniff" && login.headers.get("x-frame-options") === "DENY" && !!login.headers.get("referrer-policy") && !!login.headers.get("permissions-policy"));
  check("no x-powered-by", login.headers.get("x-powered-by") === null);
  const report = await get("/r/" + "0".repeat(32));
  check("report route: Referrer-Policy no-referrer + 404 for unknown token", report.headers.get("referrer-policy") === "no-referrer" && report.status === 404, `status=${report.status}`);
  const admin = await get("/admin");
  check("admin without session → redirect to login, private no-store", (admin.status === 307 || admin.status === 302) && (admin.headers.get("location") ?? "").includes("/login") && (admin.headers.get("cache-control") ?? "").includes("no-store"), `status=${admin.status}`);

  // 6. Early request limiter
  let last = 0;
  for (let i = 0; i < 125; i++) last = (await get(`/go/${code}`)).status;
  check("flood → 429 before DB work", last === 429, `status=${last}`);
} catch (e) {
  check("run", false, String(e?.message ?? e));
  if (process.env.HTTP_CHECK_DEBUG) console.error(serverLog.slice(-4000));
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {}
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }, null, 0));
process.exit(failed.length ? 1 : 0);
