import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, adminId, makeCreator, makeCampaign, visitor } from "./helpers";
import { joinCampaign, getParticipant } from "@/services/campaigns";
import { recordClick, reviewClick } from "@/services/tracking";
import { setSetting } from "@/services/settings";
import { one, q } from "@/lib/db";
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
    expect(p.last_qualified_at).toBeTruthy();
    const stats = (await one<{ clicks: number; qualified: number }>(
      "SELECT clicks, qualified FROM campaign_daily_stats WHERE campaign_id = ?",
      c.id
    ))!;
    expect(stats.clicks).toBe(1);
    expect(stats.qualified).toBe(1);
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
    expect(p.total_clicks).toBe(2);
    expect(p.rejected_count).toBe(1);
  });

  it("نفس الـIP بجلسة مختلفة يُرفض كتكرار", async () => {
    const { link } = await setup();
    const t = Date.now();
    const r1 = await recordClick({
      code: link.code, ipHash: "same-ip", sessionId: "s1",
      userAgent: visitor().userAgent, referer: null, utmSource: null, nowMs: t,
    });
    const r2 = await recordClick({
      code: link.code, ipHash: "same-ip", sessionId: "s2",
      userAgent: visitor().userAgent, referer: null, utmSource: null, nowMs: t + 10_000,
    });
    expect(r1.status).toBe("qualified");
    expect(r2.status).toBe("rejected");
  });

  it("الضغط المتكرر السريع من نفس الـIP يُرفض rate_limited", async () => {
    const { c, link } = await setup();
    const t = Date.now();
    const ua = visitor().userAgent;
    for (let i = 0; i < 5; i++) {
      await recordClick({ code: link.code, ipHash: "flood-ip", sessionId: `fs${i}`, userAgent: ua, referer: null, utmSource: null, nowMs: t + i * 1000 });
    }
    const r6 = await recordClick({ code: link.code, ipHash: "flood-ip", sessionId: "fs6", userAgent: ua, referer: null, utmSource: null, nowMs: t + 6000 });
    expect(r6.status).toBe("rejected");
    const rows = await q<Click>("SELECT * FROM clicks WHERE campaign_id = ? ORDER BY created_at", c.id);
    expect(rows.at(-1)!.reject_reason).toBe("rate_limited");
  });

  it("الحجم المرتفع من نفس الـIP يذهب إلى pending_review (قابل للضبط)", async () => {
    const { c, u, link } = await setup();
    await setSetting("dedup_window_hours", 0);
    await setSetting("review_threshold_24h", 3);
    const ua = visitor().userAgent;
    const t = Date.now();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        (await recordClick({ code: link.code, ipHash: "big-ip", sessionId: `bs${i}`, userAgent: ua, referer: null, utmSource: null, nowMs: t + i * 120_000 })).status
      );
    }
    expect(results).toEqual(["qualified", "qualified", "qualified", "pending_review"]);
    const p = (await getParticipant(c.id, u))!;
    expect(p.pending_count).toBe(1);
  });
});

describe("مراجعة Admin للزيارات", () => {
  it("اعتماد زيارة معلقة يحدث العدادات ويسجل الإجراء", async () => {
    const { c, u, link } = await setup();
    await setSetting("dedup_window_hours", 0);
    await setSetting("review_threshold_24h", 1);
    const ua = visitor().userAgent;
    const t = Date.now();
    await recordClick({ code: link.code, ipHash: "rv-ip", sessionId: "rv1", userAgent: ua, referer: null, utmSource: null, nowMs: t });
    await recordClick({ code: link.code, ipHash: "rv-ip", sessionId: "rv2", userAgent: ua, referer: null, utmSource: null, nowMs: t + 120_000 });
    const pending = (await one<Click>("SELECT * FROM clicks WHERE status = 'pending_review'"))!;
    await reviewClick(pending.id, "qualified", await adminId(), "زيارة حقيقية");
    const p = (await getParticipant(c.id, u))!;
    expect(p.qualified_count).toBe(2);
    expect(p.pending_count).toBe(0);
    const log = await q("SELECT * FROM admin_actions WHERE action = 'click_review_qualified'");
    expect(log.length).toBe(1);
  });
});
