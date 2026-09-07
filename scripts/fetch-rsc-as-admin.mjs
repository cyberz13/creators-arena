/**
 * Diagnostic: request a page the way Next's client router does (RSC payload)
 * as the admin, to see whether client-side navigation can succeed.
 *   PGURL=... node scripts/fetch-rsc-as-admin.mjs /admin/campaigns/<id>
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
const sql = postgres(process.env.PGURL, { ssl: "require", max: 1, prepare: false });
const [admin] = await sql.unsafe("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
await sql.end();
const token = await new SignJWT({ sub: admin.id })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(env.SESSION_SECRET));

for (const variant of ["rsc", "rsc-prefetch"]) {
  const headers = {
    cookie: `tahaddi_session=${token}`,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128 Safari/537.36",
    RSC: "1",
    accept: "text/x-component",
  };
  if (variant === "rsc-prefetch") headers["Next-Router-Prefetch"] = "1";
  const t0 = Date.now();
  try {
    const res = await fetch(`https://www.creatorarena.agency${path}?_rsc=abc123`, { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    console.log(`${variant}: status=${res.status} ms=${Date.now() - t0} bytes=${body.length} ctype=${res.headers.get("content-type")} loc=${res.headers.get("location") ?? "-"}`);
    const err = body.match(/"digest":"(\d+)"/)?.[1];
    if (err) console.log("  error-digest=" + err);
    console.log("  head=" + body.slice(0, 160).replace(/\n/g, "\\n"));
  } catch (e) {
    console.log(`${variant}: FAILED after ${Date.now() - t0}ms: ${e.message}`);
  }
}
