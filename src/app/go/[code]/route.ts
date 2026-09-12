import { NextRequest, NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { one } from "@/lib/db";
import { isProduction } from "@/lib/env";
import { clientIp } from "@/lib/client-ip";
import { allowRequest } from "@/lib/request-limit";
import { recordClick } from "@/services/tracking";
import { computeDeviceHash, hashIp, isBotUserAgent } from "@/services/fraud";
import { ensureIpIntel, hasFreshIpIntel } from "@/services/ip-intel";
import { consumeChallenge, issueChallenge } from "@/services/challenges";
import { reevaluateIpUnverified } from "@/services/tracking";
import { getSetting } from "@/services/settings";

export const dynamic = "force-dynamic";

/**
 * Tracking redirect, hardened:
 *  1. cheap per-IP request limiter before any DB/external work;
 *  2. strict code syntax check, then the link must exist (no challenge, no
 *     IP-intelligence lookup, no writes for unknown codes);
 *  3. the challenge page never interpolates request data into JavaScript —
 *     a static script (/go-challenge.js) reads an escaped JSON block;
 *  4. one-time, signed, IP+code bound challenge tokens consumed atomically;
 *  5. failed step-2 verification still redirects to the store (visitor is
 *     never trapped) but nothing is counted.
 */

const VISITOR_COOKIE = "tahaddi_vid";
const CODE_RE = /^[A-Za-z0-9]{6,16}$/;
const LIMITS = { userAgent: 512, referer: 1024, utm: 64, probe: 200 } as const;

const CHALLENGE_STYLE = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161826;color:#e9e9ed;font-family:Tajawal,system-ui,sans-serif}.box{display:flex;flex-direction:column;align-items:center;gap:18px}.mark{font-weight:700;letter-spacing:.08em;font-size:18px}.mark b{color:#9184d9;font-weight:700}.bar{width:150px;height:4px;border-radius:99px;background:#3f424d;overflow:hidden}.bar i{display:block;height:100%;width:35%;border-radius:99px;background:#9184d9;animation:s 1s ease-in-out infinite}@keyframes s{0%{transform:translateX(200%)}100%{transform:translateX(-320%)}}p{margin:0;font-size:13px;color:#9397ab}`;
const STYLE_HASH = createHash("sha256").update(CHALLENGE_STYLE).digest("base64");
const CHALLENGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'sha256-${STYLE_HASH}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function clamp(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** JSON safe for embedding in <script type="application/json"> (no </script>, no HTML, no line separators). */
function jsonForHtml(value: unknown): string {
  // Built without escape sequences on purpose (editor/tooling-safe).
  const BS = String.fromCharCode(92);
  const esc = (hex: string) => BS + "u" + hex;
  return JSON.stringify(value)
    .split("<").join(esc("003c"))
    .split(">").join(esc("003e"))
    .split("&").join(esc("0026"))
    .split(String.fromCharCode(0x2028)).join(esc("2028"))
    .split(String.fromCharCode(0x2029)).join(esc("2029"));
}

function plain(status: number, text: string): NextResponse {
  return new NextResponse(text, { status, headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" } });
}

function redirectTo(url: string): NextResponse {
  const res = NextResponse.redirect(url, 302);
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.headers.set(k, v);
  return res;
}

function setVisitorCookie(res: NextResponse, id: string) {
  res.cookies.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    maxAge: 365 * 24 * 60 * 60,
    path: "/go",
  });
}

interface LinkRow {
  campaign_id: string;
  status: string;
  store_url: string;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const ip = clientIp(req.headers);
  if (!allowRequest(`go:${ip}`, 120, 60_000)) return plain(429, "Too many requests");

  const { code } = await ctx.params;
  if (!CODE_RE.test(code)) return plain(404, "Not found");

  const link = await one<LinkRow>(
    `SELECT t.campaign_id, c.status, c.store_url
     FROM tracking_links t JOIN campaigns c ON c.id = t.campaign_id
     WHERE t.code = ?`,
    code
  );
  if (!link) return plain(404, "Not found");

  const ipHash = hashIp(ip);
  const userAgent = clamp(req.headers.get("user-agent"), LIMITS.userAgent) ?? "";
  const url = req.nextUrl;
  const utmSource = clamp(url.searchParams.get("utm_source"), LIMITS.utm);

  let visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? null;
  if (visitorId && !/^[a-f0-9-]{36}$/.test(visitorId)) visitorId = null;
  const isNewVisitor = visitorId === null;
  const sessionId = visitorId ?? crypto.randomUUID();

  const deviceHash = computeDeviceHash({
    userAgent,
    acceptLanguage: clamp(req.headers.get("accept-language"), 128),
    chUa: clamp(req.headers.get("sec-ch-ua"), 256),
    chPlatform: clamp(req.headers.get("sec-ch-ua-platform"), 64),
    clientProbe: clamp(url.searchParams.get("fp"), LIMITS.probe),
  });
  const hasSecFetch = req.headers.has("sec-fetch-mode") || req.headers.has("sec-fetch-site");
  const vercelCity = req.headers.get("x-vercel-ip-city");
  const geoCountry = clamp(req.headers.get("x-vercel-ip-country"), 8);
  const geoCity = vercelCity ? clamp(decodeURIComponent(vercelCity), 80) : null;

  // Obvious bots and inactive campaigns: record for the admin, bounce straight away.
  if (isBotUserAgent(userAgent) || link.status !== "active") {
    const result = await recordClick({
      code,
      ipHash,
      sessionId,
      deviceHash,
      userAgent,
      referer: clamp(req.headers.get("referer"), LIMITS.referer),
      utmSource,
      hasSecFetch,
      geoCountry,
      geoCity,
    });
    return redirectTo(result.redirectUrl ?? link.store_url);
  }

  const token = url.searchParams.get("t");
  if (token !== null) {
    const verdict = await consumeChallenge(token, code, ipHash, visitorId);
    if (verdict !== "ok") {
      // invalid / expired / replayed / no_visitor / visitor_mismatch:
      // never trap the visitor; simply don't count.
      return redirectTo(link.store_url);
    }
    // Make sure the network verdict is in place before classifying (bounded wait).
    if ((await getSetting("ip_intel_enabled")) && !(await hasFreshIpIntel(ipHash))) {
      await Promise.race([ensureIpIntel(ip, ipHash).catch(() => {}), new Promise((r) => setTimeout(r, 1_200))]);
    }
    const elapsed = Number(url.searchParams.get("el"));
    const interactions = Number(url.searchParams.get("ix"));
    const webdriver = url.searchParams.get("wd") === "1";
    const result = await recordClick({
      code,
      ipHash,
      sessionId,
      deviceHash,
      userAgent,
      referer: clamp(url.searchParams.get("r"), LIMITS.referer) || clamp(req.headers.get("referer"), LIMITS.referer),
      utmSource,
      hasSecFetch,
      webdriver,
      geoCountry,
      geoCity,
      // The consumed nonce is unique per interstitial → exact replay key for the data layer.
      idempotencyKey: token,
      signals: JSON.stringify({
        el: Number.isFinite(elapsed) ? Math.min(elapsed, 600_000) : null,
        ix: Number.isFinite(interactions) ? Math.min(interactions, 10_000) : null,
        wd: webdriver ? 1 : 0,
        cookie: visitorId ? 1 : 0,
      }),
    });
    const res = redirectTo(result.redirectUrl ?? link.store_url);
    if (isNewVisitor) setVisitorCookie(res, sessionId);
    return res;
  }

  // Step 1: challenge page. Nothing is counted here.
  if (await getSetting("ip_intel_enabled")) {
    after(async () => {
      try {
        await ensureIpIntel(ip, ipHash);
        await reevaluateIpUnverified(ipHash);
      } catch {
        /* best effort */
      }
    });
  }
  const challenge = await issueChallenge(code, ipHash, sessionId);
  const config = jsonForHtml({ code, t: challenge, utm: utmSource ?? "" });
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>CREATORS ARENA</title>
<style>${CHALLENGE_STYLE}</style>
</head>
<body>
<div class="box">
  <div class="mark">CREATORS <b>ARENA</b></div>
  <div class="bar"><i></i></div>
  <p>جارٍ التحقق من الزيارة…</p>
  <noscript><p style="color:#f87171">فعّل JavaScript في متصفحك لإكمال الزيارة</p></noscript>
</div>
<script type="application/json" id="ca-config">${config}</script>
<script src="/go-challenge.js"></script>
</body>
</html>`;
  const res = new NextResponse(html, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CHALLENGE_CSP,
    },
  });
  if (isNewVisitor) setVisitorCookie(res, sessionId);
  return res;
}
