import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, adminId, makeCreator, makeCampaign, visitor } from "./helpers";
import {
  joinCampaign,
  getPrizes,
  getCampaign,
  finalizeCampaign,
  adminExtendCampaign,
  adminEndCampaign,
  DomainError,
  getParticipant,
  updateDraftCampaign,
} from "@/services/campaigns";
import { recordClick } from "@/services/tracking";
import { one, q } from "@/lib/db";

beforeEach(() => {
  freshDb();
});

describe("إنشاء الحملة", () => {
  it("ينشئ حملة نشطة مع snapshot للجوائز", async () => {
    const c = await makeCampaign({ prizes: [500, 250, 100] });
    expect(c.status).toBe("active");
    expect(c.prize_total).toBe(850);
    expect(c.winners_count).toBe(3);
    const prizes = await getPrizes(c.id);
    expect(prizes.map((p) => [p.rank, p.amount])).toEqual([
      [1, 500],
      [2, 250],
      [3, 100],
    ]);
  });

  it("حملة تبدأ مستقبلًا تصبح scheduled", async () => {
    const c = await makeCampaign({
      start_at: Date.now() + 86_400_000,
      end_at: Date.now() + 7 * 86_400_000,
    });
    expect(c.status).toBe("scheduled");
  });

  it("يرفض المدخلات غير الصالحة", async () => {
    await expect(makeCampaign({ store_url: "not-a-url" })).rejects.toThrow(DomainError);
    await expect(makeCampaign({ prizes: [] })).rejects.toThrow(DomainError);
    await expect(makeCampaign({ prizes: [-5] })).rejects.toThrow(DomainError);
    await expect(makeCampaign({ end_at: Date.now() - 1000 })).rejects.toThrow(DomainError);
  });

  it("لا يمكن تعديل الجوائز بعد الإطلاق", async () => {
    const c = await makeCampaign();
    await expect(
      updateDraftCampaign(
        c.id,
        {
          title: c.title,
          description: "",
          requirements: "",
          store_name: c.store_name,
          store_url: c.store_url,
          start_at: c.start_at,
          end_at: c.end_at,
          prizes: [9999],
        },
        await adminId()
      )
    ).rejects.toThrow(DomainError);
  });
});

describe("الانضمام للحملة", () => {
  it("ينضم Creator ويحصل على رابط فريد", async () => {
    const c = await makeCampaign();
    const u1 = await makeCreator();
    const u2 = await makeCreator();
    const l1 = await joinCampaign(c.id, u1);
    const l2 = await joinCampaign(c.id, u2);
    expect(l1.code).not.toBe(l2.code);
    expect(await getParticipant(c.id, u1)).toBeTruthy();
  });

  it("الانضمام المكرر يعيد نفس الرابط", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    const l1 = await joinCampaign(c.id, u);
    const l2 = await joinCampaign(c.id, u);
    expect(l1.code).toBe(l2.code);
    const count = (await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM campaign_participants WHERE campaign_id = ?",
      c.id
    ))!.c;
    expect(count).toBe(1);
  });

  it("لا يمكن الانضمام لمسودة أو حملة منتهية", async () => {
    const draft = await makeCampaign({}, false);
    const u = await makeCreator();
    await expect(joinCampaign(draft.id, u)).rejects.toThrow(DomainError);
    const active = await makeCampaign();
    await finalizeCampaign(active.id);
    await expect(joinCampaign(active.id, u)).rejects.toThrow(DomainError);
  });
});

describe("إدارة الحملة من Admin", () => {
  it("التمديد يغيّر النهاية ويسجل في admin_actions", async () => {
    const c = await makeCampaign();
    const newEnd = c.end_at + 86_400_000;
    await adminExtendCampaign(c.id, newEnd, await adminId(), "طلب المتجر");
    expect((await getCampaign(c.id))!.end_at).toBe(newEnd);
    const log = await q("SELECT * FROM admin_actions WHERE action = 'campaign_extend'");
    expect(log.length).toBe(1);
  });

  it("الإنهاء المبكر يجمّد النتائج", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    await joinCampaign(c.id, u);
    await adminEndCampaign(c.id, await adminId(), "انتهاء الاتفاق");
    const after = (await getCampaign(c.id))!;
    expect(after.status).toBe("ended");
    expect(after.finalized_at).toBeTruthy();
  });

  it("الزيارات بعد الانتهاء تُرفض مع بقاء الـredirect", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    const link = await joinCampaign(c.id, u);
    await adminEndCampaign(c.id, await adminId(), "");
    const v = visitor();
    const res = await recordClick({ code: link.code, ...v, referer: null, utmSource: null });
    expect(res.redirectUrl).toBe(c.store_url);
    expect(res.status).toBe("rejected");
  });
});
