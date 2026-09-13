import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { challengeSecret } from "./env";

/**
 * JS-challenge token, second generation:
 *  - a random nonce is persisted server-side (see services/challenges.ts) and
 *    consumed atomically, so a token counts at most once;
 *  - the nonce is HMAC-signed (dedicated CHALLENGE_SECRET) and bound to the
 *    tracking code + IP hash, so garbage tokens are rejected before any DB work.
 * Neither the nonce nor the signature reveals anything about the visitor.
 */

export const CHALLENGE_TTL_MS = 120_000;

function sign(payload: string): string {
  return createHmac("sha256", challengeSecret()).update(payload).digest("base64url");
}

export function newChallengeNonce(): string {
  return randomBytes(16).toString("hex");
}

export function signChallenge(nonce: string, code: string, ipHash: string): string {
  return `${nonce}.${sign(`${nonce}.${code}.${ipHash}`)}`;
}

/** Returns the nonce when the signature is valid for this code+IP, else null. */
export function parseChallengeToken(token: string, code: string, ipHash: string): string | null {
  const dot = token.indexOf(".");
  if (dot !== 32) return null;
  const nonce = token.slice(0, dot);
  if (!/^[a-f0-9]{32}$/.test(nonce)) return null;
  const sig = token.slice(dot + 1);
  if (sig.length < 40 || sig.length > 64) return null;
  const expected = sign(`${nonce}.${code}.${ipHash}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return nonce;
}
