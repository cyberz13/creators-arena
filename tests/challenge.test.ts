import { describe, expect, it } from "vitest";
import { issueChallengeToken, verifyChallengeToken } from "@/lib/challenge";

describe("JS-challenge token", () => {
  const code = "abc1234";
  const ip = "ip-hash-x";

  it("توكن صادر يتحقق بنجاح", () => {
    const t = issueChallengeToken(code, ip);
    expect(verifyChallengeToken(t, code, ip)).toBe(true);
  });

  it("يرفض توكن كود آخر أو IP آخر", () => {
    const t = issueChallengeToken(code, ip);
    expect(verifyChallengeToken(t, "other12", ip)).toBe(false);
    expect(verifyChallengeToken(t, code, "ip-hash-y")).toBe(false);
  });

  it("يرفض التوكن المنتهي (أقدم من دقيقتين)", () => {
    const issuedAt = Date.now() - 3 * 60_000;
    const t = issueChallengeToken(code, ip, issuedAt);
    expect(verifyChallengeToken(t, code, ip)).toBe(false);
  });

  it("يرفض التوكن المعدّل", () => {
    const t = issueChallengeToken(code, ip);
    const tampered = t.slice(0, -2) + "zz";
    expect(verifyChallengeToken(tampered, code, ip)).toBe(false);
    expect(verifyChallengeToken("garbage", code, ip)).toBe(false);
    expect(verifyChallengeToken("", code, ip)).toBe(false);
  });

  it("يرفض توكن مستقبلي مزوّر التوقيت", () => {
    const t = issueChallengeToken(code, ip, Date.now() + 60_000);
    expect(verifyChallengeToken(t, code, ip)).toBe(false);
  });
});
