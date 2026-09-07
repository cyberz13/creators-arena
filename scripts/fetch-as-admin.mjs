/**
 * Diagnostic: fetch a production page as the admin (signs a session JWT with
 * SESSION_SECRET from .env.production; nothing is written anywhere).
 *   node scripts/fetch-as-admin.mjs /admin/campaigns/<id>
 */
import fs from "node:fs";
import postgres from "postgres";
import { SignJWT } from "jose";

const env = {};
for (const line of fs.readFileSync(".env.production", "utf8").replace(/^﻿/, "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "").trim();
}
const path = process.argv[2] ?? "/admin";
const sql = postgres(process.env.PGURL ?? env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
if (!env.SESSION_SECRET) {
  console.error("SESSION_SECRET missing in .env.production; keys: " + Object.keys(env).join(","));
  process.exit(1);
}
const [admin] = await sql.unsafe("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
await sql.end();

const token = await new SignJWT({ sub: admin.id })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(env.SESSION_SECRET));

const t0 = Date.now();
const res = await fetch(`https://www.creatorarena.agency${path}`, {
  headers: { cookie: `tahaddi_session=${token}`, "user-agent": "diag/1.0" },
  redirect: "manual",
});
const body = await res.text();
console.log(`status=${res.status} ms=${Date.now() - t0} bytes=${body.length} location=${res.headers.get("location") ?? "-"}`);
const title = body.match(/<title>([^<]*)<\/title>/)?.[1];
console.log("title=" + title);
const digest = body.match(/digest[^0-9]{0,20}(\d{6,})/)?.[1];
if (digest) console.log("error-digest=" + digest);
const marker = ["إنشاء حملة", "تقرير المتجر", "Application error", "Something went wrong", "حدث خطأ"].filter((m) => body.includes(m));
console.log("markers=" + JSON.stringify(marker));
fs.writeFileSync(process.env.OUT ?? "scratch-page.html", body);
