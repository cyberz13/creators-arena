import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { freshDb, makeCampaign, makeCreator, visitor } from "./helpers";
import { joinCampaign, getParticipant } from "@/services/campaigns";
import { resetRequestLimits } from "@/lib/request-limit";
import { q, run } from "@/lib/db";
import { GET } from "@/app/go/[code]/route";

vi.mock("next/server", async (load) => ({ ...(await load<object>()), after: (fn: () => unknown) => void fn() }));

const UA = visitor().userAgent;
const PUBLIC_IP = "203.0.113.10"; // documentation range: not private, triggers the intel lookup path

let fetchCalls: string[] = [];

beforeEach(() => {
  freshDb();
  resetRequestLimits();
  fetchCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify({ is_datacenter: false }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function req(path: string, extra: Record<string, string> = {}, cookie?: string) {
  const headers: Record<string, string> = {
    "user-agent": UA,
    "x-forwarded-for": PUBLIC_IP,
    "sec-fetch-mode": "navigate",
    ...extra,
  };
  if (cookie) headers.cookie = `tahaddi_vid=${cookie}`;
  return new NextRequest("http://localhost" + path, { headers });
}

const call = (code: string, query = "", extra?: Record<string, string>, cookie?: string) =>
  GET(req(`/go/${encodeURIComponent(code)}${query}`, extra, cookie), { params: Promise.resolve({ code }) });

async function activeLink() {
  const c = await makeCampaign();
  const u = await makeCreator();
  const link = await joinCampaign(c.id, u);
  return { c, u, link };
}

function cookieFrom(res: Response): string {
  const m = /tahaddi_vid=([a-f0-9-]{36})/.exec(res.headers.get("set-cookie") ?? "");
  return m ? m[1] : "";
}

async function tokenFrom(res: Response): Promise<string> {
  const html = await res.text();
  const json = /<script type="application\/json" id="ca-config">([\s\S]*?)<\/script>/.exec(html)![1];
  return (JSON.parse(json) as { t: string }).t;
}

describe("/go/:code — XSS وتحقق مبكر", () => {
  it("كود خبيث → 404 بدون أي انعكاس أو كتابة أو استعلام خارجي", async () => {
    await activeLink();
    for (const code of [
      'x");globalThis.__auditXss=1;//',
      "</script><script>alert(1)</script>",
      "abc1234\u2028x",
      "abc%3Cimg",
      "abc1234/../../",
      "a".repeat(17),
      "short",
    ]) {
      const res = await call(code);
      const html = await res.text();
      expect(res.status).toBe(404);
      expect(html).not.toContain("__auditXss");
      expect(html).not.toContain("<script");
    }
    expect((await q("SELECT * FROM challenges")).length).toBe(0);
    expect((await q("SELECT * FROM clicks")).length).toBe(0);
    expect(fetchCalls).toEqual([]);
  });

  it("كود غير موجود لا يستدعي فحص الشبكة حتى مع تفعيله", async () => {
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('ip_intel_enabled', '1')");
    const res = await call("zzzzzzz");
    expect(res.status).toBe(404);
    expect(fetchCalls).toEqual([]);
  });

  it("كود سليم الصيغة لكنه غير موجود → 404 بلا استعلام IP ولا تحدٍّ", async () => {
    const res = await call("zzzzzzz");
    expect(res.status).toBe(404);
    expect(fetchCalls).toEqual([]);
    expect((await q("SELECT * FROM challenges")).length).toBe(0);
  });

  it("صفحة التحدي: سكربت خارجي ثابت، إعدادات JSON مُرمّزة، وCSP صارمة", async () => {
    const { link } = await activeLink();
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('ip_intel_enabled', '1')");
    const evil = "</script><script>globalThis.__auditXss=1</script>";
    const res = await call(link.code, `?utm_source=${encodeURIComponent(evil)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("</script><script>globalThis");
    expect(html).toContain("\\u003c/script\\u003e");
    // the only executable script is the static file
    const scripts = html.match(/<script[^>]*>/g)!;
    expect(scripts).toEqual(['<script type="application/json" id="ca-config">', '<script src="/go-challenge.js">']);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/Path=\/go/);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
    expect(fetchCalls.length).toBe(1); // intel lookup only for an existing link
  });
});

describe("/go/:code — توكن أحادي الاستخدام", () => {
  it("نفس التوكن يُحتسب مرة واحدة فقط ولو بهويات مختلفة (يقلب A03)", async () => {
    const { c, u, link } = await activeLink();
    const first = await call(link.code);
    const cookie = cookieFrom(first);
    const token = await tokenFrom(first);
    const counted = await call(link.code, `?t=${encodeURIComponent(token)}&fp=device-a&wd=0`, {}, cookie);
    expect(counted.status).toBe(302);
    const replay = await call(link.code, `?t=${encodeURIComponent(token)}&fp=device-b&wd=0`, {}, cookie);
    expect(replay.status).toBe(302); // visitor is still sent to the store …
    expect((await getParticipant(c.id, u))!.qualified_count).toBe(1); // … but nothing more is counted
    expect((await q("SELECT * FROM clicks")).length).toBe(1);
  });

  it("توكن صادر لزائر آخر أو مزوّر أو فارغ لا يُحتسب لكنه يحوّل للمتجر", async () => {
    const { c, u, link } = await activeLink();
    const first = await call(link.code);
    const token = await tokenFrom(first);
    const other = await call(link.code, `?t=${encodeURIComponent(token)}`, {}, crypto.randomUUID());
    expect(other.status).toBe(302);
    const forged = await call(link.code, "?t=1234567.fakesignature");
    expect(forged.status).toBe(302);
    expect((await getParticipant(c.id, u))!.qualified_count).toBe(0);
    expect((await q("SELECT * FROM clicks")).length).toBe(0);
  });

  it("الزيارة الكاملة الصحيحة تُحتسب وتُخزّن إشاراتها", async () => {
    const { c, u, link } = await activeLink();
    const first = await call(link.code);
    const cookie = cookieFrom(first);
    const token = await tokenFrom(first);
    const counted = await call(link.code, `?t=${encodeURIComponent(token)}&fp=1x2x3&el=320&ix=4`, {}, cookie);
    expect(counted.status).toBe(302);
    expect(counted.headers.get("location")).toBe(new URL(c.store_url).href);
    expect((await getParticipant(c.id, u))!.qualified_count).toBe(1);
    const [click] = await q<{ signals: string }>("SELECT signals FROM clicks");
    expect(JSON.parse(click.signals)).toMatchObject({ el: 320, ix: 4, wd: 0, cookie: 1 });
  });
});

describe("/go/:code — حد الطلبات المبكر", () => {
  it("يرد 429 قبل أي عمل بعد تجاوز الحد لكل IP", async () => {
    const { link } = await activeLink();
    let last: Response | null = null;
    for (let i = 0; i < 121; i++) last = await call(link.code);
    expect(last!.status).toBe(429);
    expect((await q("SELECT * FROM challenges")).length).toBe(120);
  });
});
