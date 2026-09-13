import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfigError,
  assertProductionEnv,
  challengeSecret,
  ipHashSalt,
  isProduction,
  registrationMode,
  sessionSecret,
} from "@/lib/env";

const STRONG = "s".repeat(40);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("إعدادات البيئة", () => {
  it("التطوير يعمل بقيم افتراضية بدون إعداد", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SESSION_SECRET", "");
    expect(isProduction()).toBe(false);
    expect(sessionSecret().length).toBeGreaterThanOrEqual(32);
    expect(challengeSecret()).not.toBe(sessionSecret());
    expect(registrationMode()).toBe("open");
  });

  it("الإنتاج يفشل فورًا عند غياب السر", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => sessionSecret()).toThrow(ConfigError);
    expect(() => sessionSecret()).toThrow(/SESSION_SECRET is required/);
  });

  it("الإنتاج يرفض السر القصير أو القيمة الافتراضية للتطوير", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "short");
    expect(() => sessionSecret()).toThrow(/at least 32/);
    vi.stubEnv("SESSION_SECRET", "dev-only-session-secret-do-not-use-in-production-0000000000");
    expect(() => sessionSecret()).toThrow(/development placeholder/);
    vi.stubEnv("IP_HASH_SALT", "");
    expect(() => ipHashSalt()).toThrow(ConfigError);
  });

  it("مفتاح التحدي يجب أن يختلف عن مفتاح الجلسة", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", STRONG);
    vi.stubEnv("CHALLENGE_SECRET", STRONG);
    expect(() => challengeSecret()).toThrow(/must differ/);
    vi.stubEnv("CHALLENGE_SECRET", "c".repeat(40));
    expect(challengeSecret()).toBe("c".repeat(40));
  });

  it("رسائل الخطأ لا تتضمن قيمة السر", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "leaky-value");
    let message = "";
    try {
      sessionSecret();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("leaky-value");
  });

  it("التحقق الشامل للإنتاج يشترط كل المتغيرات الحرجة", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", STRONG);
    vi.stubEnv("CHALLENGE_SECRET", "c".repeat(40));
    vi.stubEnv("IP_HASH_SALT", "i".repeat(20));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("MAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("MAIL_FROM", "noreply@example.com");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_PATH", "");
    expect(() => assertProductionEnv()).toThrow(/DATABASE_URL/);
    vi.stubEnv("DATABASE_PATH", "./data/smoke.db"); // explicit SQLite opt-in (local smoke tests only)
    expect(() => assertProductionEnv()).not.toThrow();
    vi.stubEnv("VERCEL", "1");
    expect(() => assertProductionEnv()).toThrow(/DATABASE_URL/); // never on Vercel
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DATABASE_PATH", "");
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    expect(() => assertProductionEnv()).not.toThrow();
    expect(registrationMode()).toBe("pending_approval");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://example.com");
    expect(() => assertProductionEnv()).toThrow(/https/);
  });
});
