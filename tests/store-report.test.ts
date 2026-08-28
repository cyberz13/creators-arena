import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeCampaign, makeCreator, visitor } from "./helpers";
import { joinCampaign } from "@/services/campaigns";
import { recordClick } from "@/services/tracking";
import {
  ensureReportToken,
  getCampaignByReportToken,
  buildStoreReport,
} from "@/services/store-report";

beforeEach(() => {
  freshDb();
});

describe("تقرير المتجر", () => {
  it("توليد التوكن مرة واحدة وثباته", async () => {
    const c = await makeCampaign();
    const t1 = await ensureReportToken(c.id);
    const t2 = await ensureReportToken(c.id);
    expect(t1).toMatch(/^[a-f0-9]{32}$/);
    expect(t2).toBe(t1);
    expect((await getCampaignByReportToken(t1))!.id).toBe(c.id);
    expect(await getCampaignByReportToken("f".repeat(32))).toBeNull();
    expect(await getCampaignByReportToken("../../etc")).toBeNull();
  });

  it("يجمع الأرقام الصحيحة: موثقة، أجهزة، مصدودة، مدن، ساعات", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    const link = await joinCampaign(c.id, u);
    // 10:00 Riyadh = 07:00 UTC
    const base = Date.UTC(2026, 7, 29, 7, 0, 0);
    await recordClick({
      code: link.code, ...visitor(), geoCity: "Riyadh", geoCountry: "SA",
      referer: "https://www.tiktok.com/@x", utmSource: null, nowMs: base,
    });
    await recordClick({
      code: link.code, ...visitor(), geoCity: "Jeddah", geoCountry: "SA",
      referer: null, utmSource: null, nowMs: base + 60_000,
    });
    await recordClick({
      code: link.code, ipHash: "bot-ip", sessionId: "bot-s", deviceHash: "bot-d",
      userAgent: "python-requests/2.31", referer: null, utmSource: null, nowMs: base + 120_000,
    });
    const r = await buildStoreReport(c.id);
    expect(r.qualified).toBe(2);
    expect(r.uniqueDevices).toBe(2);
    expect(r.blocked).toBe(1);
    expect(r.creators).toBe(1);
    expect(r.cities.map((x) => x.city).sort()).toEqual(["Jeddah", "Riyadh"]);
    expect(r.hours[10]).toBe(2);
    expect(r.sources.find((s) => s.source === "tiktok")?.count).toBe(1);
    expect(r.topCreators[0].qualified_count).toBe(2);
  });
});
