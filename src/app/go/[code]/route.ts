import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { recordClick } from "@/services/tracking";
import { computeDeviceHash, hashIp, isBotUserAgent } from "@/services/fraud";
import { ensureIpIntel, getIpIntel } from "@/services/ip-intel";
import { issueChallengeToken, verifyChallengeToken } from "@/lib/challenge";

export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "tahaddi_vid";

/**
 * Two-step tracking flow (Phase-1 hardening):
 *  1. First hit renders a ~300ms interstitial that must EXECUTE JavaScript to
 *     obtain a signed, IP-bound, short-lived token (plus a client device probe).
 *  2. The return trip with a valid token runs the fraud pipeline and redirects.
 * HTTP-only bots never complete step 2, so they never enter the stats at all —
 * except obvious bot UAs, which we still record as rejected for admin visibility.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;

  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "0.0.0.0";
  const ipHash = hashIp(ip);
  const userAgent = req.headers.get("user-agent") ?? "";

  let sessionId = req.cookies.get(VISITOR_COOKIE)?.value;
  const isNewVisitor = !sessionId;
  if (!sessionId || !/^[a-f0-9-]{36}$/.test(sessionId)) sessionId = crypto.randomUUID();

  const url = new URL(req.url);
  const token = url.searchParams.get("t");

  const deviceHash = computeDeviceHash({
    userAgent,
    acceptLanguage: req.headers.get("accept-language"),
    chUa: req.headers.get("sec-ch-ua"),
    chPlatform: req.headers.get("sec-ch-ua-platform"),
    clientProbe: url.searchParams.get("fp"),
  });
  const hasSecFetch = req.headers.has("sec-fetch-mode") || req.headers.has("sec-fetch-site");

  // Coarse geo: Vercel edge headers in production, cached IP intel elsewhere.
  const vercelCity = req.headers.get("x-vercel-ip-city");
  let geoCountry = req.headers.get("x-vercel-ip-country");
  let geoCity = vercelCity ? decodeURIComponent(vercelCity) : null;

  // Obvious bots: record (visible to the admin) and bounce straight away.
  if (isBotUserAgent(userAgent)) {
    const result = await recordClick({
      code,
      ipHash,
      sessionId,
      deviceHash,
      userAgent,
      referer: req.headers.get("referer"),
      utmSource: url.searchParams.get("utm_source"),
      hasSecFetch,
      geoCountry,
      geoCity,
    });
    return NextResponse.redirect(result.redirectUrl ?? new URL("/?e=link", req.url), 302);
  }

  // Step 2: valid signed token → count the click and redirect to the store.
  if (token && verifyChallengeToken(token, code, ipHash)) {
    if (!geoCity || !geoCountry) {
      const intel = await getIpIntel(ipHash);
      geoCountry = geoCountry ?? intel?.country ?? null;
      geoCity = geoCity ?? intel?.city ?? null;
    }
    const webdriver = url.searchParams.get("wd") === "1";
    const elapsed = Number(url.searchParams.get("el"));
    const interactions = Number(url.searchParams.get("ix"));
    const signals = JSON.stringify({
      el: Number.isFinite(elapsed) ? elapsed : null,
      ix: Number.isFinite(interactions) ? interactions : null,
      wd: webdriver ? 1 : 0,
    });
    const result = await recordClick({
      code,
      ipHash,
      sessionId,
      deviceHash,
      userAgent,
      referer: url.searchParams.get("r") || req.headers.get("referer"),
      utmSource: url.searchParams.get("utm_source"),
      hasSecFetch,
      webdriver,
      geoCountry,
      geoCity,
      signals,
    });
    if (!result.redirectUrl) {
      return NextResponse.redirect(new URL("/?e=link", req.url), 302);
    }
    const res = NextResponse.redirect(result.redirectUrl, 302);
    if (isNewVisitor) {
      res.cookies.set(VISITOR_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60,
        path: "/",
      });
    }
    return res;
  }

  // Step 1: interstitial JS challenge. Nothing is recorded here.
  // Warm the network-intel cache while the client does its round-trip, so the
  // counted request never pays the external-lookup latency.
  after(() => ensureIpIntel(ip, ipHash).catch(() => {}));
  const fresh = issueChallengeToken(code, ipHash);
  const utm = url.searchParams.get("utm_source");
  const passThrough = utm ? `&utm_source=${encodeURIComponent(utm)}` : "";
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>CREATORS ARENA</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161826;color:#e9e9ed;font-family:Tajawal,system-ui,sans-serif}
  .box{display:flex;flex-direction:column;align-items:center;gap:18px}
  .mark{font-weight:700;letter-spacing:.08em;font-size:18px}
  .mark b{color:#9184d9;font-weight:700}
  .bar{width:150px;height:4px;border-radius:99px;background:#3f424d;overflow:hidden}
  .bar i{display:block;height:100%;width:35%;border-radius:99px;background:#9184d9;animation:s 1s ease-in-out infinite}
  @keyframes s{0%{transform:translateX(200%)}100%{transform:translateX(-320%)}}
  p{margin:0;font-size:13px;color:#9397ab}
</style>
</head>
<body>
<div class="box">
  <div class="mark">CREATORS <b>ARENA</b></div>
  <div class="bar"><i></i></div>
  <p>جارٍ التحقق من الزيارة…</p>
  <noscript><p style="color:#f87171">فعّل JavaScript في متصفحك لإكمال الزيارة</p></noscript>
</div>
<script>
(function(){
  var t0 = performance.now();
  var ix = 0;
  ["pointermove","touchstart","scroll","keydown"].forEach(function(ev){
    addEventListener(ev, function(){ ix++; }, {passive:true});
  });
  var fp = [screen.width, screen.height, screen.colorDepth,
            Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            navigator.hardwareConcurrency || 0,
            window.devicePixelRatio || 1].join("x");
  var wd = navigator.webdriver ? "&wd=1" : "";
  var r = document.referrer ? "&r=" + encodeURIComponent(document.referrer) : "";
  // A ~300ms window: lets the loader breathe and captures touch/pointer
  // liveness that scripted clients never produce.
  setTimeout(function(){
    var extra = "&el=" + Math.round(performance.now() - t0) + "&ix=" + ix;
    location.replace("/go/${code}?t=${encodeURIComponent(fresh)}&fp=" + encodeURIComponent(fp) + wd + extra + r + "${passThrough}");
  }, 300);
})();
</script>
</body>
</html>`;
  const res = new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
  if (isNewVisitor) {
    res.cookies.set(VISITOR_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
    });
  }
  return res;
}
