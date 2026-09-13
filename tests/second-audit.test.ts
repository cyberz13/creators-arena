// Second-review regression suite (B01–B08). These started life as the
// reviewer's reproduction probes (PASS = defect present); each is now flipped
// to assert the SAFE behaviour, so a regression makes it fail.
// Synthetic in-memory data only; no real email or network-intelligence requests.
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { freshDb, adminId, makeCampaign, makeCreator, visitor } from "./helpers";
import { one, q, run, tx } from "@/lib/db";
import { joinCampaign, finalizeCampaign, getParticipant } from "@/services/campaigns";
import { autoResolveHeldClick, recordClick, reevaluateIpUnverified } from "@/services/tracking";
import { setSetting } from "@/services/settings";
import { setParticipationStatus, setUserStatus } from "@/services/creators";
import { confirmResults } from "@/services/results";
import { getLeaderboard } from "@/services/leaderboard";
import { beneficiaryEligible, listPayouts, updatePayoutStatus } from "@/services/payouts";
import { sendMail, mailProvider } from "@/lib/mailer";
import { emailVerificationRequired, requestPasswordReset } from "@/services/auth";
import { issueChallenge, consumeChallenge } from "@/services/challenges";
import { assertProductionEnv, mfaEncryptionKey } from "@/lib/env";
import { issueSession, resolveSession } from "@/services/sessions";
import { beginMfaEnrollment, completeMfaEnrollment } from "@/services/mfa";
import { adminSessionAllowed } from "@/lib/auth";
import { totpCode } from "@/lib/totp";
import type { User } from "@/lib/types";

beforeEach(() => {
  freshDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const hit = (code: string, extra = {}) => recordClick({ code, ...visitor(), referer: null, utmSource: null, ...extra });
async function setup() {
  const c = await makeCampaign();
  const u = await makeCreator();
  const l = await joinCampaign(c.id, u);
  return { c, u, l };
}
async function cleanIp(ip: string) {
  await run("INSERT INTO ip_intel (ip_hash,risky,checked_at) VALUES (?,0,?)", ip, Date.now());
}

it("B01 automatic network approval re-applies dedup: two duplicates from one visitor yield ONE qualified click", async () => {
  const { c, u, l } = await setup();
  await setSetting("ip_intel_enabled", 1);
  const identity = visitor();
  expect((await hit(l.code, identity)).status).toBe("pending_review");
  expect((await hit(l.code, identity)).status).toBe("pending_review");
  await cleanIp(identity.ipHash);
  expect(await reevaluateIpUnverified(identity.ipHash)).toBe(1);
  const p = (await getParticipant(c.id, u))!;
  expect(p.qualified_count).toBe(1);
  expect(p.rejected_count).toBe(1);
  expect(p.pending_count).toBe(0);
  const rows = await q<{ status: string; reject_reason: string | null }>("SELECT status, reject_reason FROM clicks ORDER BY created_at, id");
  expect(rows[0]).toEqual({ status: "qualified", reject_reason: null });
  expect(rows[1]).toEqual({ status: "rejected", reject_reason: "duplicate_session" });
  // the approval is a system pipeline decision, not an admin override
  expect((await q("SELECT * FROM admin_actions WHERE action = 'click_auto_qualified'")).length).toBe(1);
  expect((await q("SELECT * FROM admin_actions WHERE action LIKE 'click_review_%'")).length).toBe(0);
  // idempotent: a second pass changes nothing
  expect(await reevaluateIpUnverified(identity.ipHash)).toBe(0);
  expect((await getParticipant(c.id, u))!.qualified_count).toBe(1);
});

it("B01b concurrent auto-resolution of the same held duplicates approves exactly one", async () => {
  const { c, u, l } = await setup();
  await setSetting("ip_intel_enabled", 1);
  const identity = visitor();
  await hit(l.code, identity);
  await hit(l.code, identity);
  await hit(l.code, identity);
  await cleanIp(identity.ipHash);
  const ids = (await q<{ id: string }>("SELECT id FROM clicks ORDER BY created_at, id")).map((r) => r.id);
  const outcomes = await Promise.all([...ids, ...ids].map((id) => autoResolveHeldClick(id)));
  expect(outcomes.filter((o) => o === "qualified")).toHaveLength(1);
  expect((await getParticipant(c.id, u))!.qualified_count).toBe(1);
  expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM clicks WHERE status = 'qualified'"))!.n).toBe(1);
});

it("B02 automatic network approval keeps the missing sec-fetch rule (click stays pending with the real reason)", async () => {
  const { c, u, l } = await setup();
  await setSetting("ip_intel_enabled", 1);
  const identity = visitor();
  await hit(l.code, { ...identity, hasSecFetch: false });
  expect((await one<{ reject_reason: string; signals: string }>("SELECT reject_reason, signals FROM clicks"))!.reject_reason).toBe("ip_unverified");
  expect(JSON.parse((await one<{ signals: string }>("SELECT signals FROM clicks"))!.signals).sf).toBe(false);
  await cleanIp(identity.ipHash);
  expect(await reevaluateIpUnverified(identity.ipHash)).toBe(0);
  const p = (await getParticipant(c.id, u))!;
  expect(p.qualified_count).toBe(0);
  expect(p.pending_count).toBe(1);
  expect((await one<{ reject_reason: string }>("SELECT reject_reason FROM clicks"))!.reject_reason).toBe("missing_sec_fetch");
});

it("B02b a legacy held click without stored request facts is never assumed clean", async () => {
  const { c, u, l } = await setup();
  await setSetting("ip_intel_enabled", 1);
  const identity = visitor();
  await hit(l.code, identity);
  await run("UPDATE clicks SET signals = NULL"); // row written before signals were persisted
  await cleanIp(identity.ipHash);
  await reevaluateIpUnverified(identity.ipHash);
  expect((await getParticipant(c.id, u))!.qualified_count).toBe(0);
  expect((await one<{ reject_reason: string }>("SELECT reject_reason FROM clicks"))!.reject_reason).toBe("missing_sec_fetch");
});

it("B02c a webdriver click held for the network verdict is rejected on re-evaluation, not approved", async () => {
  const { c, u, l } = await setup();
  await setSetting("ip_intel_enabled", 1);
  const identity = visitor();
  await hit(l.code, identity);
  await run("UPDATE clicks SET signals = ?", JSON.stringify({ sf: true, wd: true }));
  await cleanIp(identity.ipHash);
  await reevaluateIpUnverified(identity.ipHash);
  expect((await getParticipant(c.id, u))!.qualified_count).toBe(0);
  expect((await one<{ status: string; reject_reason: string }>("SELECT status, reject_reason FROM clicks"))).toEqual({
    status: "rejected",
    reject_reason: "automation",
  });
});

it("B03 a disabled confirmed winner cannot be approved or paid; the payout follows the recomputed results", async () => {
  const { c, u, l } = await setup();
  await hit(l.code);
  await finalizeCampaign(c.id);
  const a = await adminId();
  await confirmResults(c.id, a);
  const payout = (await listPayouts())[0];
  expect(payout.user_id).toBe(u);
  await setUserStatus(u, "disabled", a, "audit");
  expect(await getLeaderboard(c.id)).toHaveLength(0);
  // results were recomputed inside the status change: no eligible winner → unpaid payout removed
  expect(await listPayouts()).toHaveLength(0);
  expect((await q("SELECT * FROM admin_actions WHERE action = 'results_recomputed'")).length).toBe(1);
  await expect(updatePayoutStatus(payout.id, "approved", a)).rejects.toThrow(/غير موجود/);
  // even with a stale payout row present, money never moves to an ineligible beneficiary
  await run(
    "INSERT INTO payouts (id, campaign_id, user_id, prize_rank, amount, status, created_at) VALUES (?,?,?,?,?,?,?)",
    "stale-payout",
    c.id,
    u,
    1,
    500,
    "approved",
    Date.now()
  );
  expect(await beneficiaryEligible({ user_id: u, campaign_id: c.id, prize_rank: 1 })).toBe(false);
  await expect(updatePayoutStatus("stale-payout", "paid", a, "audit", { reauthenticated: true })).rejects.toThrow(/غير مؤهل/);
  expect((await one<{ status: string }>("SELECT status FROM payouts WHERE id = 'stale-payout'"))!.status).toBe("approved");
});

it("B03b a suspended winner loses the payout to the next eligible creator; a PAID payout is never deleted", async () => {
  const c = await makeCampaign();
  const a = await adminId();
  const u1 = await makeCreator("first");
  const u2 = await makeCreator("second");
  const l1 = await joinCampaign(c.id, u1);
  const l2 = await joinCampaign(c.id, u2);
  await hit(l1.code);
  await hit(l1.code);
  await hit(l2.code);
  await finalizeCampaign(c.id);
  await confirmResults(c.id, a);
  const first = (await listPayouts()).find((p) => p.prize_rank === 1)!;
  expect(first.user_id).toBe(u1);
  await setParticipationStatus(u1, "suspended", a, "fraud review");
  const after = (await listPayouts()).find((p) => p.prize_rank === 1)!;
  expect(after.user_id).toBe(u2); // reassigned, not deleted
  expect(after.status).toBe("pending");
  // pay it, then try to reinstate u1: the paid entitlement stays and the conflict is logged
  await updatePayoutStatus(after.id, "approved", a);
  await updatePayoutStatus(after.id, "paid", a, "", { reauthenticated: true });
  await setParticipationStatus(u1, "active", a, "cleared");
  const paid = (await listPayouts()).find((p) => p.prize_rank === 1)!;
  expect(paid.status).toBe("paid");
  expect(paid.user_id).toBe(u2);
  expect((await q("SELECT * FROM admin_actions WHERE action = 'results_conflict'")).length).toBe(1);
});

it("B04 missing mail provider in production never logs the message and never marks it sent", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MAIL_PROVIDER", undefined);
  const logs: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  const marker = "SYNTHETIC_RESET_TOKEN_NOT_A_SECRET";
  const result = await sendMail({ to: "audit@example.test", subject: "audit", text: "https://example.test/reset-password?token=" + marker });
  expect(result.ok).toBe(false);
  expect(logs.join("\n")).not.toContain(marker);
  const row = (await one<{ status: string; error: string }>("SELECT status, error FROM mail_outbox WHERE id=?", result.id))!;
  expect(row.status).toBe("failed");
  expect(row.error).toBe("mail_not_configured");
});

it("B04b the log provider is refused in production and, elsewhere, never prints the body", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MAIL_PROVIDER", "log");
  expect(() => mailProvider()).toThrow(/MAIL_PROVIDER/);
  vi.stubEnv("NODE_ENV", "development");
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  const marker = "SYNTHETIC_VERIFY_TOKEN_NOT_A_SECRET";
  const r = await sendMail({ to: "dev@example.test", subject: "verify", text: "https://example.test/verify?token=" + marker });
  expect(r.ok).toBe(true);
  expect(logs.length).toBeGreaterThan(0);
  expect(logs.join("\n")).not.toContain(marker);
  expect(logs.join("\n")).toContain(r.id);
});

it("B04c a password reset in unconfigured production issues no token and leaks nothing", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MAIL_PROVIDER", undefined);
  const u = await makeCreator();
  const email = (await one<User>("SELECT * FROM users WHERE id = ?", u))!.email;
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  await requestPasswordReset(email, "ip-hash", "https://example.test");
  expect((await q("SELECT * FROM auth_tokens WHERE kind = 'reset_password'")).length).toBe(0);
  expect(logs.join("\n")).not.toMatch(/reset-password\?token=/);
});

it("B05 configured email verification gates joining a campaign server-side", async () => {
  const c = await makeCampaign();
  const u = await makeCreator();
  await run("UPDATE users SET email_verified=0 WHERE id=?", u);
  vi.stubEnv("MAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "synthetic-no-call");
  vi.stubEnv("MAIL_FROM", "audit@example.test");
  expect(emailVerificationRequired()).toBe(true);
  await expect(joinCampaign(c.id, u)).rejects.toThrow(/بريدك/);
  expect(await getParticipant(c.id, u)).toBeUndefined();
  await run("UPDATE users SET email_verified=1 WHERE id=?", u);
  expect(await joinCampaign(c.id, u)).toBeTruthy();
});

it("B06 a challenge is only consumable with the visitor id it was issued to (missing, changed, replay)", async () => {
  const token = await issueChallenge("abc1234", "synthetic-ip", "visitor-a");
  expect(await consumeChallenge(token, "abc1234", "synthetic-ip", null)).toBe("no_visitor");
  expect(await consumeChallenge(token, "abc1234", "synthetic-ip", "visitor-b")).toBe("visitor_mismatch");
  // rejected attempts do not consume the nonce; the real visitor still succeeds exactly once
  expect(await consumeChallenge(token, "abc1234", "synthetic-ip", "visitor-a")).toBe("ok");
  expect(await consumeChallenge(token, "abc1234", "synthetic-ip", "visitor-a")).toBe("replayed");
  expect(await consumeChallenge(token, "abc1234", "synthetic-ip", null)).toBe("replayed");
});

it("B07 production boot validation requires a well-formed MFA encryption key and a real mail provider", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "audit-session-".padEnd(48, "a"));
  vi.stubEnv("CHALLENGE_SECRET", "audit-challenge-".padEnd(48, "b"));
  vi.stubEnv("IP_HASH_SALT", "audit-ip-salt-".padEnd(24, "c"));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  vi.stubEnv("REGISTRATION_MODE", "open");
  vi.stubEnv("DATABASE_PATH", ":memory:");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("MAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "synthetic-no-call");
  vi.stubEnv("MAIL_FROM", "audit@example.test");
  vi.stubEnv("MFA_ENCRYPTION_KEY", undefined);
  expect(() => assertProductionEnv()).toThrow(/MFA_ENCRYPTION_KEY/);
  vi.stubEnv("MFA_ENCRYPTION_KEY", "short");
  expect(() => assertProductionEnv()).toThrow(/MFA_ENCRYPTION_KEY/);
  vi.stubEnv("MFA_ENCRYPTION_KEY", "a".repeat(40)); // long enough as text, decodes to < 32 bytes
  expect(() => assertProductionEnv()).toThrow(/32 bytes/);
  vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  expect(() => assertProductionEnv()).not.toThrow();
  expect(mfaEncryptionKey().length).toBe(32);
  vi.stubEnv("MAIL_PROVIDER", "log");
  expect(() => assertProductionEnv()).toThrow(/MAIL_PROVIDER/);
  vi.stubEnv("MAIL_PROVIDER", "resend");
  vi.stubEnv("MAIL_FROM", undefined);
  expect(() => assertProductionEnv()).toThrow(/MAIL_FROM/);
});

it("B08 enabling MFA revokes every password-only session and binds admin access to the verifying session", async () => {
  const a = await adminId();
  const user = (await one<User>("SELECT * FROM users WHERE id=?", a))!;
  const old = await issueSession(user, "full");
  const current = await issueSession(user, "full");
  const enrollment = await beginMfaEnrollment(user);
  const result = await completeMfaEnrollment(a, totpCode(enrollment.secret), current.sessionId);
  expect(await resolveSession(old.token)).toBeNull(); // revoked
  expect(await resolveSession(current.token)).toBeNull(); // rotated (old token dead)
  const fresh = (await resolveSession(result.session.token))!;
  expect(fresh.session.stage).toBe("full");
  expect(fresh.session.mfa_verified_at).not.toBeNull();
  expect(Number(fresh.user.mfa_enabled)).toBe(1);
  // the guard's decision: an MFA-enabled admin is only admitted on an MFA-verified session
  expect(adminSessionAllowed({ role: "admin", mfaEnabled: true, mfaVerified: false })).toBe(false);
  expect(adminSessionAllowed({ role: "admin", mfaEnabled: true, mfaVerified: true })).toBe(true);
  // a plain password login after enrolment cannot be a full session without TOTP
  const later = await issueSession(user, "full");
  expect((await resolveSession(later.token))!.session.mfa_verified_at).toBeNull();
});

it("TX idempotency ledger: a replay with the same key returns the stored result without re-executing", async () => {
  let executions = 0;
  const body = async () => {
    executions += 1;
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = settings.value || 'x'", "ledger-probe", "v");
    return { done: executions };
  };
  const first = await tx(body, { idempotencyKey: "op:1" });
  const replay = await tx(body, { idempotencyKey: "op:1" });
  expect(first).toEqual({ done: 1 });
  expect(replay).toEqual({ done: 1 }); // stored result, not a second run
  expect(executions).toBe(1);
  expect((await one<{ value: string }>("SELECT value FROM settings WHERE key = 'ledger-probe'"))!.value).toBe("v");
  // a different key executes; a failed attempt leaves no claim behind
  await tx(body, { idempotencyKey: "op:2" });
  expect(executions).toBe(2);
  await expect(
    tx(async () => {
      executions += 1;
      throw new Error("boom");
    }, { idempotencyKey: "op:3" })
  ).rejects.toThrow("boom");
  expect(await one("SELECT 1 FROM tx_ledger WHERE key = 'op:3'")).toBeUndefined();
  const again = await tx(body, { idempotencyKey: "op:3" });
  expect(again).toEqual({ done: 4 });
});

it("TX idempotency: recording the same click twice with one challenge nonce counts it once", async () => {
  const { c, u, l } = await setup();
  const v = visitor();
  const first = await hit(l.code, { ...v, idempotencyKey: "nonce-1" });
  const second = await hit(l.code, { ...v, idempotencyKey: "nonce-1" });
  expect(first.status).toBe("qualified");
  expect(second.status).toBe("qualified"); // replayed answer
  expect((await getParticipant(c.id, u))!.total_clicks).toBe(1);
  expect((await q("SELECT * FROM clicks")).length).toBe(1);
});
