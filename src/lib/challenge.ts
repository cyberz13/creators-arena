import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * JS-challenge token: issued inside the interstitial page, must come back
 * (within TTL, from the same IP, for the same code) before a click counts.
 * Anything that can't execute JavaScript never completes the round-trip.
 */

const TTL_MS = 120_000;

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-secret-change-in-production";
}

function sign(payload: string): string {
  return createHmac("sha256", `challenge:${secret()}`).update(payload).digest("base64url");
}

export function issueChallengeToken(code: string, ipHash: string, nowMs = Date.now()): string {
  const payload = `${code}.${ipHash}.${nowMs}`;
  return `${nowMs}.${sign(payload)}`;
}

export function verifyChallengeToken(
  token: string,
  code: string,
  ipHash: string,
  nowMs = Date.now()
): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const ts = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(ts)) return false;
  if (nowMs - ts > TTL_MS || ts - nowMs > 5_000) return false;
  const expected = sign(`${code}.${ipHash}.${ts}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
