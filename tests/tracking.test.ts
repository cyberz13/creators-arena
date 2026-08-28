import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, adminId, makeCreator, makeCampaign, visitor } from "./helpers";
import { joinCampaign, getParticipant } from "@/services/campaigns";
import { recordClick, reviewClick } from "@/services/tracking";
import { setSetting } from "@/services/settings";
import { one, q, run } from "@/lib/db";
import type { Click } from "@/lib/types";

beforeEach(() => {
  freshDb();
});

async function setup() {
  const c = await makeCampaign();
  const u = await makeCreator();
  const link = await joinCampaign(c.id, u);
  return { c, u, link };
}

const UA = visitor().userAgent;

describe("Tracking pipeline", () => {
  it("زيارة حقيقية تُحتسب qualified وتحدّث العدادات والإحصائيات اليومية", async () => {
    const { c, u, link } = await setup();
    const res = await recordClick({
      code: link.code,
      ...visitor(),
      referer: "https://www.tiktok.com/@x",
      utmSource: null,
    });
    expect(res.status).toBe("qualified");
    expect(res.redirectUrl).toBe(c.store_url);
    const p = (await getParticipant(c.id, u))!;
    expect(p.qualified_count).toBe(1);
    expect(p.total_clicks).toBe(1);
    const click = (await one<Click>("SELECT * FROM clicks WHERE campaign_id = ?", c.id))!;
    expect(click.source).toBe("tiktok");
  });

  it("كود غير معروف يعيد null", async () => {
    const res = await recordClick({ code: "nope123", ...visitor(), referer: null, utmSource: null });
    expect(res.redirectUrl).toBeNull();
  });

  it("Bot user-agent يُرفض", async () => {
    const { c, link } = await setup();
    const v = visitor();
    const res = await recordClick({
      code: link.code,
      ipHash: v.ipHash,
      sessionId: v.sessionId,
      deviceHash: v.deviceHash,
      userAgent: "python-requests/2.31",
      referer: null,
      utmSource: null,
    });
    expect(res.status).toBe("rejected");
    const click = (await one<Click>("SELECT * FROM clicks WHERE campaign_id = ?", c.id))!;
    expect(click.reject_reason).toBe("bot");
  });

  it("نفس الجلسة لا تُحتسب مرتين خلال نافذة منع التكرار", async () => {
    const { c, u, link } = await setup();
    const v = visitor();
    const t = Date.now();
    const r1 = await recordClick({ code: link.code, ...v, referer: null, utmSource: null, nowMs: t });
    const r2 = await recordClick({ code: link.code, ...v, referer: null, utmSource: null, nowMs: t + 5_000 });
    expect(r1.status).toBe("qualified");
    expect(r2.status).toBe("rejected");
    const p = (await getParticipant(c.id, u))!;
    expect(p.qualified_count).toBe(1);
    expect(p.rejected_count).toBe(1);
  });

  it("نفس الجهاز بجلسة جديدة (وضع التخفي) يُرفض duplicate_device", async () => {
    const { c, link } = await setup();
    const t = Date.now();
    const r1 = await recordClick({
      code: link.code, ipHash: "ip-a", sessionId: "s1", deviceHash: "dev-same",
      userAgent: UA, referer: null, utmSource: null, nowMs: t,
    });
    // incognito: new session, even a new network — same device fingerprint
    const r2 = await recordClick({
      code: link.code, ipHash: "ip-b", sessionId: "s2", deviceHash: "dev-same",
      userAgent: UA, referer: null, utmSource: null, nowMs: t + 10_000,
    });
    expect(r1.status).toBe("qualified");
    expect(r2.status).toBe("rejected");
    const rows = await q<Click>("SELECT * FROM clicks WHERE campaign_id = ? ORDER BY created_at", c.id);
    expect(rows.at(-1)!.reject_reason).toBe("duplicate_device");
  });

  it("عدالة CGNAT: أجهزة مختلفة خلف نفس الـIP تُحتسب كلها حتى السقف ثم مراجعة", async () => {
    const { c, u, link } = await setup();
    await setSetting("max_devices_per_ip_24h", 3);
    const t = Date.now();
    const results: (string | null)[] = [];
    for (let i = 1; i <= 4; i++) {
      const r = await recordClick({
        code: link.code, ipHash: "carrier-nat", sessionId: `cg-s${i}`, deviceHash: `cg-d${i}`,
        userAgent: UA, referer: null, utmSource: null, nowMs: t + i * 15_000,
      });
      results.push(r.status);
    }
    expect(results).toEqual(["qualified", "qualified", "qualified", "pending_review"]);
    const last = (await q<Click>("SELECT * FROM clicks WHERE campaign_id = ? ORDER BY created_at", c.id)).at(-1)!;
    expect(last.reject_reason).toBe("ip_device_cap");
    const p = (await getParticipant(c.id, u))!;
    expect(p.qualified_count).toBe(3);
    expect(p.pending_count).toBe(1);
  });

  it("الضغط المتكرر السريع من نفس الـIP يُرفض rate_limited", async () => {
    const { c, link } = await setup();
    await setSetting("max_devices_per_ip_24h", 100);
    const t = Date.now();
    for (let i = 0; i < 5; i++) {
      await recordClick({
        code: link.code, ipHash: "flood-ip", sessionId: `fs${i}`, deviceHash: `fd${i}`,
        userAgent: UA, referer: null, utmSource: null, nowMs: t + i * 1000,
      });
    }
    const r6 = await recordClick({
      code: link.code, ipHash: "flood-ip", sessionId: "fs6", deviceHash: "fd6",
      userAgent: UA, referer: null, utmSource: null, nowMs: t + 6000,
    });
    expect(r6.status).toBe("rejected");
    const rows = await q<Click>("SELECT * FROM clicks WHERE campaign_id = ? ORDER BY created_at", c.id);
    expect(rows.at(-1)!.reject_reason).toBe("rate_limited");
  });

  it("متصفح مؤتمت (navigator.webdriver) يُرفض automation", async () => {
    const { c, link } = await setup();
    const r = await recordClick({
      code: link.code, ...visitor(), webdriver: true, referer: null, utmSource: null,
    });
    expect(r.status).toBe("rejected");
    const click = (await one<Click>("SELECT * FROM clicks WHERE campaign_id = ?", c.id))!;
    expect(click.reject_reason).toBe("automation");
  });

  it("شبكة مشبوهة (VPN/مركز بيانات) → قيد المراجعة، والنظيفة تمر", async () => {
    const { c, link } = await setup();
    const vpn = visitor();
    const clean = visitor();
    await run(
      "INSERT INTO ip_intel (ip_hash, risky, flags, asn_org, checked_at) VALUES (?, 1, 'vpn,datacenter', 'EvilVPN Ltd', ?)",
      vpn.ipHash, Date.now()
    );
    await run(
      "INSERT INTO ip_intel (ip_hash, risky, flags, asn_org, checked_at) VALUES (?, 0, 'datacenter', 'Cloudflare Inc', ?)",
      clean.ipHash, Date.now()
    );
    const r1 = await recordClick({ code: link.code, ...vpn, referer: null, utmSource: null });
    const r2 = await recordClick({ code: link.code, ...clean, referer: null, utmSource: null });
    expect(r1.status).toBe("pending_review");
    expect(r2.status).toBe("qualified");
    const flagged = (await one<Click>(
      "SELECT * FROM clicks WHERE campaign_id = ? AND ip_hash = ?", c.id, vpn.ipHash
    ))!;
    expect(flagged.reject_reason).toBe("risky_ip");
  });

  it("إيقاف ip_intel_enabled يعطل فحص الشبكة المشبوهة", async () => {
    const { link } = await setup();
    await setSetting("ip_intel_enabled", 0);
    const vpn = visitor();
    await run(
      "INSERT INTO ip_intel (ip_hash, risky, flags, checked_at) VALUES (?, 1, 'vpn', ?)",
      vpn.ipHash, Date.now()
    );
    const r = await recordClick({ code: link.code, ...vpn, referer: null, utmSource: null });
    expect(r.status).toBe("qualified");
  });

  it("جغرافيا الزيارة (مدينة/دولة) تُخزَّن مع النقرة", async () => {
    const { c, link } = await setup();
    const r = await recordClick({
      code: link.code, ...visitor(), geoCountry: "SA", geoCity: "Riyadh",
      signals: '{"el":320,"ix":4,"wd":0}', referer: null, utmSource: null,
    });
    expect(r.status).toBe("qualified");
    const click = (await one<Click>("SELECT * FROM clicks WHERE campaign_id = ?", c.id))!;
    expect(click.geo_country).toBe("SA");
    expect(click.geo_city).toBe("Riyadh");
    expect(JSON.parse(click.signals!).ix).toBe(4);
  });

  it("غياب رؤوس sec-fetch لمتصفح حديث → قيد المراجعة", async () => {
    const { c, link } = await setup();
    const v = visitor();
    const r = await recordClick({
      code: link.code, ...v, hasSecFetch: false, referer: null, utmSource: null,
    });
    expect(r.status).toBe("pending_review");
    const click = (await one<Click>("SELECT * FROM clicks WHERE campaign_id = ?", c.id))!;
    expect(click.reject_reason).toBe("missing_sec_fetch");
  });
});

describe("مراجعة Admin للزيارات", () => {
  it("اعتماد زيارة معلقة يحدث العدادات ويسجل الإجراء", async () => {
    const { c, u, link } = await setup();
    const v = visitor();
    await recordClick({ code: link.code, ...v, hasSecFetch: false, referer: null, utmSource: null });
    const pending = (await one<Click>("SELECT * FROM clicks WHERE status = 'pending_review'"))!;
    await reviewClick(pending.id, "qualified", await adminId(), "زيارة حقيقية");
    const p = (await getParticipant(c.id, u))!;
    expect(p.qualified_count).toBe(1);
    expect(p.pending_count).toBe(0);
    const log = await q("SELECT * FROM admin_actions WHERE action = 'click_review_qualified'");
    expect(log.length).toBe(1);
  });
});
