import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, adminId, makeCampaign, makeCreator, visitor } from "./helpers";
import { joinCampaign } from "@/services/campaigns";
import { recordClick } from "@/services/tracking";
import {
  ensureReportToken,
  getCampaignByReportToken,
  buildStoreReport,
  rotateReportToken,
  revokeReportToken,
  REPORT_TOKEN_TTL_MS,
} from "@/services/store-report";
import { run } from "@/lib/db";

beforeEach(() => {
  freshDb();
});

describe("تقرير المتجر", () => {
  it("توليد التوكن مرة واحدة وثباته، مع صلاحية 90 يومًا وعدّاد مشاهدات", async () => {
    const c = await makeCampaign();
    const t1 = await ensureReportToken(c.id);
    const t2 = await ensureReportToken(c.id);
    expect(t1.token).toMatch(/^[a-f0-9]{32}$/);
    expect(t2.token).toBe(t1.token);
    expect(t1.expiresAt - Date.now()).toBeLessThanOrEqual(REPORT_TOKEN_TTL_MS);
    expect((await getCampaignByReportToken(t1.token))!.id).toBe(c.id);
    expect((await ensureReportToken(c.id)).views).toBe(1);
    expect(await getCampaignByReportToken("f".repeat(32))).toBeNull();
    expect(await getCampaignByReportToken("../../etc")).toBeNull();
  });

  it("التدوير يبطل الرابط القديم، والإلغاء يوقفه، والانتهاء يمنعه", async () => {
    const c = await makeCampaign();
    const first = await ensureReportToken(c.id);
    const rotated = await rotateReportToken(c.id, await adminId());
    expect(rotated.token).not.toBe(first.token);
    expect(await getCampaignByReportToken(first.token)).toBeNull();
    expect((await getCampaignByReportToken(rotated.token))!.id).toBe(c.id);
    await run("UPDATE campaigns SET report_token_expires_at = ? WHERE id = ?", Date.now() - 1, c.id);
    expect(await getCampaignByReportToken(rotated.token)).toBeNull();
    await revokeReportToken(c.id, await adminId());
    expect((await ensureReportToken(c.id)).token).not.toBe(rotated.token);
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
