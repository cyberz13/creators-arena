import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { parseChallengeToken, signChallenge, newChallengeNonce } from "@/lib/challenge";
import { consumeChallenge, issueChallenge } from "@/services/challenges";
import { q } from "@/lib/db";

beforeEach(() => {
  freshDb();
});

describe("توقيع توكن التحدي", () => {
  const code = "abc1234";
  const ip = "ip-hash-x";

  it("توكن موقّع يُفكّ إلى نفس الـnonce", () => {
    const nonce = newChallengeNonce();
    expect(parseChallengeToken(signChallenge(nonce, code, ip), code, ip)).toBe(nonce);
  });

  it("يرفض توكن كود آخر أو IP آخر أو معدّل أو مهمل", () => {
    const t = signChallenge(newChallengeNonce(), code, ip);
    expect(parseChallengeToken(t, "other12", ip)).toBeNull();
    expect(parseChallengeToken(t, code, "ip-hash-y")).toBeNull();
    expect(parseChallengeToken(t.slice(0, -2) + "zz", code, ip)).toBeNull();
    expect(parseChallengeToken("garbage", code, ip)).toBeNull();
    expect(parseChallengeToken("", code, ip)).toBeNull();
    expect(parseChallengeToken("x".repeat(32) + ".sig", code, ip)).toBeNull();
  });
});

describe("سجل التحدي أحادي الاستخدام", () => {
  it("يُستهلك مرة واحدة فقط، ثم يُعد مكررًا", async () => {
    const t = await issueChallenge("abc1234", "ip-1", "visitor-1");
    expect(await consumeChallenge(t, "abc1234", "ip-1", "visitor-1")).toBe("ok");
    expect(await consumeChallenge(t, "abc1234", "ip-1", "visitor-1")).toBe("replayed");
    expect(await consumeChallenge(t, "abc1234", "ip-1", "visitor-1")).toBe("replayed");
  });

  it("ينتهي بعد دقيقتين ويرفض التوقيت المستقبلي", async () => {
    const t = await issueChallenge("abc1234", "ip-1", "v");
    expect(await consumeChallenge(t, "abc1234", "ip-1", "v", Date.now() + 3 * 60_000)).toBe("expired");
    const t2 = await issueChallenge("abc1234", "ip-1", "v");
    expect(await consumeChallenge(t2, "abc1234", "ip-1", "v", Date.now() - 60_000)).toBe("expired");
  });

  it("مرتبط بالزائر الذي صدر له عند وجود كوكي", async () => {
    const t = await issueChallenge("abc1234", "ip-1", "visitor-A");
    expect(await consumeChallenge(t, "abc1234", "ip-1", "visitor-B")).toBe("visitor_mismatch");
    // still unconsumed for the right visitor
    expect(await consumeChallenge(t, "abc1234", "ip-1", "visitor-A")).toBe("ok");
  });

  it("توقيع صحيح لكن بلا سجل في القاعدة → غير صالح", async () => {
    const forged = signChallenge(newChallengeNonce(), "abc1234", "ip-1");
    expect(await consumeChallenge(forged, "abc1234", "ip-1", null)).toBe("invalid");
    expect((await q("SELECT * FROM challenges")).length).toBe(0);
  });
});
