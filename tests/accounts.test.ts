import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, adminId, makeCampaign, makeCreator } from "./helpers";
import { one, q, run } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  authenticate,
  changePassword,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
  issueEmailVerification,
} from "@/services/auth";
import {
  issueSession,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  upgradeSession,
  purgeSessions,
  SESSION_TTL_MS,
} from "@/services/sessions";
import { consumeRateLimit } from "@/services/rate-limit";
import { beginMfaEnrollment, completeMfaEnrollment, verifyMfa } from "@/services/mfa";
import { base32Decode, base32Encode, totpCode, verifyTotp, encryptSecret, decryptSecret } from "@/lib/totp";
import { joinCampaign } from "@/services/campaigns";
import type { User } from "@/lib/types";

beforeEach(() => {
  freshDb();
  vi.unstubAllEnvs();
});

async function creatorWithPassword(password = "Password123x") {
  const id = await makeCreator();
  await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(password), id);
  return id;
}

describe("الجلسات المخزنة في القاعدة", () => {
  it("تُصدر وتُحل، وتنتهي وتُلغى، ولا تعمل لحساب معطّل", async () => {
    const id = await makeCreator();
    const s = await issueSession({ id, role: "creator" }, "full");
    expect(s.token.length).toBeGreaterThan(30);
    expect((await one<{ token_hash: string }>("SELECT token_hash FROM sessions"))!.token_hash).not.toContain(s.token);
    expect((await resolveSession(s.token))?.user.id).toBe(id);
    expect(await resolveSession(s.token, Date.now() + SESSION_TTL_MS.creator + 1)).toBeNull(); // expired
    await run("UPDATE users SET status = 'disabled' WHERE id = ?", id);
    expect(await resolveSession(s.token)).toBeNull(); // disabled → immediate loss of access
    await run("UPDATE users SET status = 'active' WHERE id = ?", id);
    await revokeSession(s.sessionId);
    expect(await resolveSession(s.token)).toBeNull();
    expect(await resolveSession("garbage")).toBeNull();
  });

  it("الأدمن جلسة أقصر، والإلغاء الشامل يستثني الجلسة الحالية", async () => {
    const admin = await adminId();
    const a = await issueSession({ id: admin, role: "admin" }, "full");
    expect(a.expiresAt - Date.now()).toBeLessThanOrEqual(SESSION_TTL_MS.admin);
    const b = await issueSession({ id: admin, role: "admin" }, "full");
    const c = await issueSession({ id: admin, role: "admin" }, "full");
    const revoked = await revokeAllSessions(admin, a.sessionId);
    expect(revoked).toBe(2);
    expect(await resolveSession(a.token)).not.toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    expect(await resolveSession(c.token)).toBeNull();
  });

  it("جلسة MFA المعلقة تُرقّى بتدوير التوكن مرة واحدة", async () => {
    const admin = await adminId();
    const pending = await issueSession({ id: admin, role: "admin" }, "mfa_pending");
    expect((await resolveSession(pending.token))?.session.stage).toBe("mfa_pending");
    const full = await upgradeSession(pending.sessionId, { id: admin, role: "admin" });
    expect(await resolveSession(pending.token)).toBeNull();
    expect((await resolveSession(full.token))?.session.stage).toBe("full");
    await expect(upgradeSession(pending.sessionId, { id: admin, role: "admin" })).rejects.toThrow();
  });

  it("التنظيف يحذف المنتهي القديم", async () => {
    const id = await makeCreator();
    const old = await issueSession({ id, role: "creator" }, "full", {}, Date.now() - 60 * 86_400_000);
    void old;
    await purgeSessions();
    expect((await q("SELECT * FROM sessions")).length).toBe(0);
  });
});

describe("حد المحاولات المخزن في القاعدة", () => {
  it("نافذة ثابتة ذرّية تعيد الضبط بعد انتهائها", async () => {
    const t = Date.now();
    for (let i = 1; i <= 3; i++) expect((await consumeRateLimit("k", 3, 1000, t)).allowed).toBe(true);
    const blocked = await consumeRateLimit("k", 3, 1000, t + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect((await consumeRateLimit("k", 3, 1000, t + 1001)).allowed).toBe(true);
    expect((await consumeRateLimit("other", 3, 1000, t + 10)).allowed).toBe(true);
  });
});

describe("تسجيل الدخول", () => {
  it("رسالة فشل واحدة عامة: بريد مجهول، كلمة خاطئة، حساب معطّل", async () => {
    const id = await creatorWithPassword();
    const email = (await one<User>("SELECT * FROM users WHERE id = ?", id))!.email;
    expect(await authenticate("nobody@example.test", "Password123x", "ip-a")).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate(email, "wrong-password1", "ip-a")).toEqual({ ok: false, reason: "invalid" });
    await run("UPDATE users SET status = 'disabled' WHERE id = ?", id);
    expect(await authenticate(email, "Password123x", "ip-a")).toEqual({ ok: false, reason: "invalid" });
    await run("UPDATE users SET status = 'active' WHERE id = ?", id);
    const ok = await authenticate(email, "Password123x", "ip-a");
    expect(ok.ok && ok.user.id).toBe(id);
  });

  it("يُقيَّد بحسب الـIP بعد 10 محاولات، دون قفل الحساب من IP آخر", async () => {
    const id = await creatorWithPassword();
    const email = (await one<User>("SELECT * FROM users WHERE id = ?", id))!.email;
    for (let i = 0; i < 10; i++) await authenticate(email, "bad-password-1", "attacker");
    expect(await authenticate(email, "Password123x", "attacker")).toEqual({ ok: false, reason: "rate_limited" });
    const victim = await authenticate(email, "Password123x", "victim-ip");
    expect(victim.ok).toBe(true); // the real owner on their own network still gets in
  });

  it("الأدمن مع MFA يتطلب خطوة ثانية", async () => {
    const admin = await adminId();
    await run("UPDATE users SET password_hash = ?, mfa_enabled = 1, mfa_secret_enc = ? WHERE id = ?", await hashPassword("AdminPass123"), encryptSecret("JBSWY3DPEHPK3PXP"), admin);
    const email = (await one<User>("SELECT * FROM users WHERE id = ?", admin))!.email;
    const r = await authenticate(email, "AdminPass123", "ip-x");
    expect(r.ok && r.requiresMfa).toBe(true);
  });
});

describe("التسجيل والاعتماد والبريد", () => {
  const input = {
    name: "سارة", username: "sara_new", email: "sara@example.test", password: "Strong123pass",
    followers_count: 10, category_id: "general",
  };

  it("وضع pending_approval يمنع الانضمام حتى الاعتماد ويصدر رسالة تأكيد بريد", async () => {
    vi.stubEnv("REGISTRATION_MODE", "pending_approval");
    const r = await registerAccount(input, "ip-r", "https://app.test");
    expect(r.needsApproval).toBe(true);
    const user = (await one<User>("SELECT * FROM users WHERE id = ?", r.userId))!;
    expect(Number(user.approved)).toBe(0);
    expect(Number(user.email_verified)).toBe(0);
    const c = await makeCampaign();
    await expect(joinCampaign(c.id, r.userId)).rejects.toThrow(/اعتماد/);
    const mail = (await one<{ to_email: string; body: string; status: string }>("SELECT * FROM mail_outbox"))!;
    expect(mail.to_email).toBe("sara@example.test");
    expect(mail.status).toBe("sent"); // "log" provider: stored, never delivered
    const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(mail.body)![1];
    expect(await verifyEmailToken(token)).toBe(true);
    expect(await verifyEmailToken(token)).toBe(false); // single use
    expect(Number((await one<User>("SELECT * FROM users WHERE id = ?", r.userId))!.email_verified)).toBe(1);
    expect(await issueEmailVerification(r.userId, "https://app.test")).toBe(false); // already verified
  });

  it("وضع open يعتمد فورًا، والتسجيل مقيد بالـIP، وكلمة المرور الضعيفة مرفوضة", async () => {
    vi.stubEnv("REGISTRATION_MODE", "open");
    await expect(registerAccount({ ...input, password: "short1" }, "ip-o", "https://app.test")).rejects.toThrow(/10/);
    await expect(registerAccount({ ...input, password: "onlyletterslong" }, "ip-o", "https://app.test")).rejects.toThrow(/أرقام/);
    const r = await registerAccount(input, "ip-o", "https://app.test");
    expect(r.needsApproval).toBe(false);
    // 2 weak attempts + 1 success already consumed 3 of the 5 hourly attempts per IP
    for (let i = 0; i < 2; i++) {
      await expect(registerAccount({ ...input, email: `x${i}@example.test`, username: `x_${i}` }, "ip-o", "https://app.test")).resolves.toBeTruthy();
    }
    await expect(registerAccount({ ...input, email: "y@example.test", username: "y_y" }, "ip-o", "https://app.test")).rejects.toThrow(/محاولات/);
  });

  it("إعادة تعيين كلمة المرور: رابط أحادي ينتهي، ويلغي كل الجلسات، ولا يكشف وجود البريد", async () => {
    const id = await creatorWithPassword();
    const user = (await one<User>("SELECT * FROM users WHERE id = ?", id))!;
    const s = await issueSession({ id, role: "creator" }, "full");
    await requestPasswordReset("unknown@example.test", "ip-p", "https://app.test");
    expect((await q("SELECT * FROM mail_outbox")).length).toBe(0); // nothing sent, nothing revealed
    await requestPasswordReset(user.email, "ip-p", "https://app.test");
    const mail = (await one<{ body: string }>("SELECT body FROM mail_outbox"))!;
    const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.body)![1];
    await expect(resetPassword(token, "weak")).rejects.toThrow();
    expect(await resetPassword(token, "NewPassword123")).toBe(true);
    expect(await resetPassword(token, "NewPassword123")).toBe(false);
    expect(await resolveSession(s.token)).toBeNull(); // every session revoked
    expect((await authenticate(user.email, "NewPassword123", "ip-q")).ok).toBe(true);
  });

  it("تغيير كلمة المرور يتطلب الحالية ويُبقي الجلسة الحالية فقط", async () => {
    const id = await creatorWithPassword();
    const keep = await issueSession({ id, role: "creator" }, "full");
    const other = await issueSession({ id, role: "creator" }, "full");
    await expect(changePassword(id, "wrong", "NewPassword123", keep.sessionId)).rejects.toThrow(/الحالية/);
    await changePassword(id, "Password123x", "NewPassword123", keep.sessionId);
    expect(await resolveSession(keep.token)).not.toBeNull();
    expect(await resolveSession(other.token)).toBeNull();
  });
});

describe("TOTP / MFA", () => {
  it("base32 وTOTP متوافقان مع متجه RFC", () => {
    expect(base32Encode(Buffer.from("Hello!"))).toBe("JBSWY3DPEE");
    expect(base32Decode("JBSWY3DPEE").toString()).toBe("Hello!");
    // RFC 6238 SHA-1 test vector: secret "12345678901234567890", T=59s → 287082
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
    expect(verifyTotp(secret, "287082", 59_000 + 30_000)).toBe(true); // ±1 step drift
    expect(verifyTotp(secret, "287082", 59_000 + 120_000)).toBe(false);
  });

  it("التشفير عند التخزين يعمل ويرفض التلاعب", () => {
    const blob = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(blob).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(blob)).toBe("JBSWY3DPEHPK3PXP");
    const tampered = Buffer.from(blob, "base64");
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptSecret(tampered.toString("base64"))).toThrow();
  });

  it("التفعيل يتطلب رمزًا حيًا، ورموز الاستعادة أحادية الاستخدام ومخزنة كتجزئة", async () => {
    const admin = await adminId();
    const row = (await one<User>("SELECT * FROM users WHERE id = ?", admin))!;
    const { secret, uri } = await beginMfaEnrollment(row);
    expect(uri).toContain("otpauth://totp/");
    expect((await one<User>("SELECT * FROM users WHERE id = ?", admin))!.mfa_secret_enc).not.toContain(secret);
    await expect(completeMfaEnrollment(admin, "000000")).rejects.toThrow(/غير صحيح/);
    const codes = await completeMfaEnrollment(admin, totpCode(secret));
    expect(codes.length).toBe(8);
    expect(Number((await one<User>("SELECT * FROM users WHERE id = ?", admin))!.mfa_enabled)).toBe(1);
    for (const c of codes) expect(JSON.stringify(await q("SELECT code_hash FROM mfa_recovery_codes"))).not.toContain(c.replace("-", ""));
    expect(await verifyMfa(admin, totpCode(secret))).toBe(true);
    expect(await verifyMfa(admin, "123456")).toBe(false);
    expect(await verifyMfa(admin, codes[0])).toBe(true);
    expect(await verifyMfa(admin, codes[0])).toBe(false); // consumed
    expect((await q("SELECT * FROM admin_actions WHERE action = 'mfa_recovery_code_used'")).length).toBe(1);
  });
});
