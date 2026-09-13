import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, adminId, makeCreator, makeCampaign, visitor } from "./helpers";
import { joinCampaign, finalizeCampaign, getCampaign, getParticipant, DomainError } from "@/services/campaigns";
import { recordClick, reviewClick } from "@/services/tracking";
import { getLeaderboard, getStandings, toPublicBoard } from "@/services/leaderboard";
import { listPayouts, updatePayoutStatus } from "@/services/payouts";
import { confirmResults, correctResults, excludeParticipant } from "@/services/results";
import { setParticipationStatus, setUserStatus } from "@/services/creators";
import { one, q, run } from "@/lib/db";

beforeEach(() => {
  freshDb();
});

const hit = (code: string, t = Date.now(), extra = {}) =>
  recordClick({ code, ...visitor(), referer: null, utmSource: null, nowMs: t, ...extra });

describe("قاعدة كسر التعادل — الوقت الذي بلغ فيه المشارك عدده الحالي", () => {
  it("اعتماد زيارة قديمة لا يسبق من بلغ العدد أولًا (A05)", async () => {
    const c = await makeCampaign();
    const a = await makeCreator("a_creator");
    const b = await makeCreator("b_creator");
    const la = await joinCampaign(c.id, a);
    const lb = await joinCampaign(c.id, b);
    const t = Date.now();
    await hit(la.code, t, { hasSecFetch: false }); // pending
    await hit(lb.code, t + 10);
    await hit(lb.code, t + 20); // b reaches 2 at t+20
    await hit(la.code, t + 30); // a has 1 qualified (t+30)
    const pending = (await one<{ id: string }>("SELECT id FROM clicks WHERE status='pending_review'"))!;
    await reviewClick(pending.id, "qualified", await adminId(), "audit");
    expect((await getParticipant(c.id, a))!.last_qualified_at).toBe(t + 30); // a reached 2 at t+30
    expect((await getLeaderboard(c.id))[0].user_id).toBe(b);
  });

  it("رفض أحدث زيارة يعيد وقت آخر زيارة مؤهلة متبقية (A06)", async () => {
    const c = await makeCampaign();
    const a = await makeCreator();
    const l = await joinCampaign(c.id, a);
    const t = Date.now();
    await hit(l.code, t);
    await hit(l.code, t + 100);
    const k = (await one<{ id: string }>("SELECT id FROM clicks ORDER BY created_at DESC LIMIT 1"))!;
    await reviewClick(k.id, "rejected", await adminId(), "audit");
    const p = (await getParticipant(c.id, a))!;
    expect(p.qualified_count).toBe(1);
    expect(p.last_qualified_at).toBe(t);
  });

  it("مراجعة متكررة لنفس الزيارة لا تكرر العدادات، والحالة المتغيرة تُرفض", async () => {
    const c = await makeCampaign();
    const a = await makeCreator();
    const l = await joinCampaign(c.id, a);
    await hit(l.code, Date.now(), { hasSecFetch: false });
    const k = (await one<{ id: string }>("SELECT id FROM clicks"))!;
    await reviewClick(k.id, "qualified", await adminId(), "x");
    await reviewClick(k.id, "qualified", await adminId(), "x"); // no-op
    const p = (await getParticipant(c.id, a))!;
    expect(p.qualified_count).toBe(1);
    expect(p.pending_count).toBe(0);
    expect(p.total_clicks).toBe(1);
  });
});

describe("دورة النتائج: أولية → مثبتة → تصحيح", () => {
  it("الإنهاء يشمل كل المشاركين لا أول 100 فقط (A07)", async () => {
    const c = await makeCampaign();
    for (let i = 0; i < 101; i++) await joinCampaign(c.id, await makeCreator());
    await finalizeCampaign(c.id);
    const missing = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM campaign_participants WHERE campaign_id = ? AND final_rank IS NULL", c.id))!.n;
    expect(missing).toBe(0);
    const ranks = (await q<{ final_rank: number }>("SELECT final_rank FROM campaign_participants WHERE campaign_id = ? ORDER BY final_rank", c.id)).map((r) => r.final_rank);
    expect(ranks[100]).toBe(101);
  });

  it("المراجعة بعد الانتهاء (نتائج أولية) تعيد اشتقاق الفائز والجائزة معًا (A04)", async () => {
    const c = await makeCampaign();
    const a = await makeCreator("a_creator");
    const b = await makeCreator("b_creator");
    const la = await joinCampaign(c.id, a);
    const lb = await joinCampaign(c.id, b);
    await hit(la.code);
    await hit(lb.code, Date.now(), { hasSecFetch: false });
    await hit(lb.code, Date.now(), { hasSecFetch: false });
    await finalizeCampaign(c.id);
    expect((await getCampaign(c.id))!.results_status).toBe("provisional");
    expect((await one<{ user_id: string }>("SELECT user_id FROM payouts WHERE campaign_id=?", c.id))!.user_id).toBe(a);
    for (const k of await q<{ id: string }>("SELECT id FROM clicks WHERE status='pending_review'"))
      await reviewClick(k.id, "qualified", await adminId(), "audit");
    expect((await getLeaderboard(c.id))[0].user_id).toBe(b);
    expect((await one<{ user_id: string; status: string }>("SELECT user_id, status FROM payouts WHERE campaign_id=?", c.id))!).toMatchObject({ user_id: b, status: "pending" });
    expect((await getParticipant(c.id, b))!.is_winner).toBe(1);
    expect((await getParticipant(c.id, a))!.is_winner).toBe(0);
  });

  it("التثبيت مرفوض مع زيارات معلقة، ثم ينجح ويُعلن الفائز مرة واحدة", async () => {
    const c = await makeCampaign();
    const a = await makeCreator();
    const l = await joinCampaign(c.id, a);
    await hit(l.code);
    await hit(l.code, Date.now(), { hasSecFetch: false });
    await finalizeCampaign(c.id);
    await expect(confirmResults(c.id, await adminId())).rejects.toThrow(/قيد المراجعة/);
    const k = (await one<{ id: string }>("SELECT id FROM clicks WHERE status='pending_review'"))!;
    await reviewClick(k.id, "rejected", await adminId(), "x");
    await confirmResults(c.id, await adminId());
    await confirmResults(c.id, await adminId()); // idempotent
    expect((await getCampaign(c.id))!.results_status).toBe("final");
    const won = await q("SELECT * FROM notifications WHERE type = 'campaign_won'");
    expect(won.length).toBe(1);
    expect((await q("SELECT * FROM admin_actions WHERE action = 'results_confirm'")).length).toBe(1);
  });

  it("بعد التثبيت: المراجعة العادية مرفوضة، والتصحيح الصريح موثق ويعيد الاشتقاق", async () => {
    const c = await makeCampaign();
    const a = await makeCreator("a_creator");
    const b = await makeCreator("b_creator");
    const la = await joinCampaign(c.id, a);
    const lb = await joinCampaign(c.id, b);
    await hit(la.code);
    await hit(lb.code);
    await hit(lb.code, Date.now() + 1, { hasSecFetch: false });
    await finalizeCampaign(c.id);
    const pending = (await one<{ id: string }>("SELECT id FROM clicks WHERE status='pending_review'"))!;
    await reviewClick(pending.id, "rejected", await adminId(), "x");
    await confirmResults(c.id, await adminId());
    await expect(reviewClick(pending.id, "qualified", await adminId(), "late")).rejects.toThrow(/مثبتة/);
    await expect(reviewClick(pending.id, "qualified", await adminId(), "", { correction: true })).rejects.toThrow(/سبب/);
    await reviewClick(pending.id, "qualified", await adminId(), "دليل جديد", { correction: true });
    expect((await one<{ user_id: string }>("SELECT user_id FROM payouts WHERE campaign_id=?", c.id))!.user_id).toBe(b);
    expect((await q("SELECT * FROM admin_actions WHERE action = 'click_correction_qualified'")).length).toBe(1);
    await expect(correctResults(c.id, await adminId(), "")).rejects.toThrow(DomainError);
    await correctResults(c.id, await adminId(), "إعادة فحص");
    expect((await q("SELECT * FROM admin_actions WHERE action = 'results_correct'")).length).toBe(1);
  });

  it("الاستحقاق المدفوع لا يتغير بصمت: التصحيح يفشل ويُلغى كليًا", async () => {
    const c = await makeCampaign();
    const a = await makeCreator("a_creator");
    const b = await makeCreator("b_creator");
    const la = await joinCampaign(c.id, a);
    const lb = await joinCampaign(c.id, b);
    await hit(la.code);
    await hit(lb.code, Date.now() + 1, { hasSecFetch: false });
    await hit(lb.code, Date.now() + 2, { hasSecFetch: false });
    await finalizeCampaign(c.id);
    for (const k of await q<{ id: string }>("SELECT id FROM clicks WHERE status='pending_review'"))
      await reviewClick(k.id, "rejected", await adminId(), "x");
    await confirmResults(c.id, await adminId());
    const payout = (await listPayouts())[0];
    expect(payout.user_id).toBe(a);
    await updatePayoutStatus(payout.id, "approved", await adminId());
    await updatePayoutStatus(payout.id, "paid", await adminId(), "", { reauthenticated: true });
    const rejected = await q<{ id: string }>("SELECT id FROM clicks WHERE status='rejected' ORDER BY created_at");
    // 1st correction: b reaches 1 (later than a) → a still first, prize unchanged → allowed
    await reviewClick(rejected[0].id, "qualified", await adminId(), "late evidence", { correction: true });
    expect((await listPayouts())[0]).toMatchObject({ user_id: a, status: "paid" });
    // 2nd correction would make b the winner → the PAID prize would move → refused, fully rolled back
    await expect(reviewClick(rejected[1].id, "qualified", await adminId(), "more evidence", { correction: true })).rejects.toThrow(/مدفوعة/);
    expect((await one<{ status: string }>("SELECT status FROM clicks WHERE id = ?", rejected[1].id))!.status).toBe("rejected");
    expect((await getParticipant(c.id, b))!.qualified_count).toBe(1);
    expect((await listPayouts())[0]).toMatchObject({ user_id: a, status: "paid" });
  });
});

describe("الأهلية", () => {
  it("الحساب المعطّل لا يجمع زيارات ولا يفوز (A08)", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    const l = await joinCampaign(c.id, u);
    await setUserStatus(u, "disabled", await adminId(), "غش");
    expect((await hit(l.code)).status).toBe("rejected");
    const click = (await one<{ reject_reason: string }>("SELECT reject_reason FROM clicks"))!;
    expect(click.reject_reason).toBe("ineligible");
    await finalizeCampaign(c.id);
    expect((await listPayouts()).length).toBe(0);
    expect((await getStandings(c.id)).length).toBe(0);
  });

  it("تعليق المشاركة يوقف الاحتساب دون منع الدخول، والاستبعاد من حملة يحذف من الترتيب", async () => {
    const c = await makeCampaign();
    const a = await makeCreator("a_creator");
    const b = await makeCreator("b_creator");
    const la = await joinCampaign(c.id, a);
    const lb = await joinCampaign(c.id, b);
    await hit(la.code);
    await hit(lb.code);
    await setParticipationStatus(a, "suspended", await adminId(), "تحقيق");
    expect((await one<{ status: string }>("SELECT status FROM users WHERE id = ?", a))!.status).toBe("active"); // still can log in
    expect((await hit(la.code, Date.now() + 5)).status).toBe("rejected");
    expect((await getStandings(c.id)).map((e) => e.user_id)).toEqual([b]);
    await setParticipationStatus(a, "active", await adminId(), "انتهى التحقيق");
    await expect(excludeParticipant(c.id, b, await adminId(), "")).rejects.toThrow(/سبب/);
    await excludeParticipant(c.id, b, await adminId(), "حساب مزيف");
    expect((await getStandings(c.id)).map((e) => e.user_id)).toEqual([a]);
    expect((await q("SELECT * FROM admin_actions WHERE action = 'participant_exclude'")).length).toBe(1);
  });

  it("الحساب غير المعتمد أو الموقوف لا ينضم للحملات", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    await run("UPDATE users SET approved = 0 WHERE id = ?", u);
    await expect(joinCampaign(c.id, u)).rejects.toThrow(/اعتماد/);
    await run("UPDATE users SET approved = 1, participation_status = 'suspended' WHERE id = ?", u);
    await expect(joinCampaign(c.id, u)).rejects.toThrow(/موقوفة/);
  });
});

describe("الجوائز", () => {
  it("الاعتماد يتطلب نتائج مثبتة، والدفع يتطلب إعادة مصادقة، والمدفوع نهائي", async () => {
    const c = await makeCampaign();
    const u = await makeCreator();
    const l = await joinCampaign(c.id, u);
    await hit(l.code);
    await finalizeCampaign(c.id);
    const payout = (await listPayouts())[0];
    await expect(updatePayoutStatus(payout.id, "approved", await adminId())).rejects.toThrow(/ثبّت/);
    await confirmResults(c.id, await adminId());
    await updatePayoutStatus(payout.id, "approved", await adminId());
    await expect(updatePayoutStatus(payout.id, "paid", await adminId())).rejects.toThrow(/كلمة مرور/);
    await updatePayoutStatus(payout.id, "paid", await adminId(), "", { reauthenticated: true });
    await expect(updatePayoutStatus(payout.id, "pending", await adminId())).rejects.toThrow(DomainError);
    await expect(updatePayoutStatus(payout.id, "rejected", await adminId())).rejects.toThrow(DomainError);
    expect((await q("SELECT * FROM notifications WHERE type = 'prize_paid'")).length).toBe(1);
    expect((await q("SELECT * FROM admin_actions WHERE action = 'payout_paid'")).length).toBe(1);
  });

  it("الإنهاء المتزامن (طلبان) ينتج مجموعة واحدة من الجوائز والإشعارات", async () => {
    const c = await makeCampaign({ prizes: [500, 250] });
    const a = await makeCreator();
    const b = await makeCreator();
    const la = await joinCampaign(c.id, a);
    const lb = await joinCampaign(c.id, b);
    await hit(la.code);
    await hit(lb.code);
    const results = await Promise.all([finalizeCampaign(c.id), finalizeCampaign(c.id), finalizeCampaign(c.id)]);
    expect(results.filter(Boolean).length).toBe(1);
    expect((await listPayouts()).length).toBe(2);
    expect((await q("SELECT * FROM notifications WHERE type = 'campaign_ended'")).length).toBe(2);
  });
});

describe("DTO اللوحة العامة", () => {
  it("لا يسرّب معرّفات داخلية أو طوابع زمنية", async () => {
    const c = await makeCampaign();
    const u = await makeCreator("pub_user");
    const l = await joinCampaign(c.id, u);
    await hit(l.code);
    const [entry] = toPublicBoard(await getLeaderboard(c.id));
    expect(Object.keys(entry).sort()).toEqual(["avatar_url", "is_winner", "name", "qualified_count", "rank", "username"]);
    expect(JSON.stringify(entry)).not.toContain(u);
  });
});
