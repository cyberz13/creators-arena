import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, adminId, makeCreator, makeCampaign, visitor } from "./helpers";
import { joinCampaign, finalizeCampaign, getCampaign, DomainError } from "@/services/campaigns";
import { recordClick } from "@/services/tracking";
import { getLeaderboard, getMyPosition } from "@/services/leaderboard";
import { listPayouts, updatePayoutStatus } from "@/services/payouts";
import { q } from "@/lib/db";

beforeEach(() => {
  freshDb();
});

function hit(code: string, nowMs: number) {
  return recordClick({ code, ...visitor(), referer: null, utmSource: null, nowMs });
}

describe("Leaderboard", () => {
  it("يرتب حسب الزيارات المؤهلة", async () => {
    const c = await makeCampaign();
    const a = await makeCreator("sara");
    const b = await makeCreator("noura");
    const la = await joinCampaign(c.id, a);
    const lb = await joinCampaign(c.id, b);
    const t = Date.now();
    await hit(la.code, t);
    await hit(lb.code, t + 1000);
    await hit(lb.code, t + 2000);
    const board = await getLeaderboard(c.id);
    expect(board[0].username).toBe("noura");
    expect(board[0].qualified_count).toBe(2);
    expect(board[1].username).toBe("sara");
    const pos = (await getMyPosition(c.id, a))!;
    expect(pos.rank).toBe(2);
    expect(pos.gapToNext).toBe(2); // needs 2 visits to overtake noura
    expect(pos.nextUsername).toBe("noura");
  });

  it("كسر التعادل: من وصل للعدد أولًا يتقدم", async () => {
    const c = await makeCampaign();
    const early = await makeCreator("early");
    const late = await makeCreator("late");
    const le = await joinCampaign(c.id, early);
    const ll = await joinCampaign(c.id, late);
    const t = Date.now();
    await hit(le.code, t);
    await hit(le.code, t + 1000);
    await hit(ll.code, t + 60_000);
    await hit(ll.code, t + 61_000);
    const board = await getLeaderboard(c.id);
    expect(board[0].username).toBe("early");
    expect(board[1].username).toBe("late");
    expect(board[0].qualified_count).toBe(board[1].qualified_count);
  });
});

describe("إنهاء الحملة وتحديد الفائزين", () => {
  it("يحدد الفائزين حسب snapshot الجوائز وينشئ payouts", async () => {
    const c = await makeCampaign({ prizes: [500, 250] });
    const first = await makeCreator("first");
    const second = await makeCreator("second");
    const third = await makeCreator("third");
    const l1 = await joinCampaign(c.id, first);
    const l2 = await joinCampaign(c.id, second);
    await joinCampaign(c.id, third); // zero visits
    const t = Date.now();
    await hit(l1.code, t);
    await hit(l1.code, t + 1000);
    await hit(l2.code, t + 2000);
    await finalizeCampaign(c.id);

    expect((await getCampaign(c.id))!.status).toBe("ended");
    const payouts = await listPayouts();
    expect(payouts.length).toBe(2);
    const byRank = Object.fromEntries(payouts.map((p) => [p.prize_rank, p]));
    expect(byRank[1].username).toBe("first");
    expect(byRank[1].amount).toBe(500);
    expect(byRank[2].username).toBe("second");
    expect(byRank[2].amount).toBe(250);

    const board = await getLeaderboard(c.id);
    expect(board.find((e) => e.username === "third")!.is_winner).toBe(false);
    const ranks = (
      await q<{ final_rank: number }>(
        "SELECT final_rank FROM campaign_participants WHERE campaign_id = ? ORDER BY final_rank",
        c.id
      )
    ).map((r) => r.final_rank);
    expect(ranks).toEqual([1, 2, 3]);
  });

  it("الإنهاء idempotent — لا يكرر الجوائز", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    const l = await joinCampaign(c.id, u);
    await hit(l.code, Date.now());
    await finalizeCampaign(c.id);
    await finalizeCampaign(c.id);
    expect((await listPayouts()).length).toBe(1);
  });

  it("لا فائز بدون زيارات مؤهلة", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    await joinCampaign(c.id, u);
    await finalizeCampaign(c.id);
    expect((await listPayouts()).length).toBe(0);
  });
});

describe("حالات دفع الجائزة", () => {
  it("يسمح بالتحولات الصحيحة فقط", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    const l = await joinCampaign(c.id, u);
    await hit(l.code, Date.now());
    await finalizeCampaign(c.id);
    const payout = (await listPayouts())[0];
    await expect(updatePayoutStatus(payout.id, "paid", await adminId())).rejects.toThrow(DomainError);
    await updatePayoutStatus(payout.id, "approved", await adminId());
    await updatePayoutStatus(payout.id, "paid", await adminId());
    expect((await listPayouts("paid")).length).toBe(1);
    await expect(updatePayoutStatus(payout.id, "pending", await adminId())).rejects.toThrow(DomainError);
  });
});
