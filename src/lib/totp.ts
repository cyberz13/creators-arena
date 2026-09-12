import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mfaEncryptionKey } from "./env";

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s) — implemented on node:crypto only, so
 * no native binaries are needed. Secrets are stored AES-256-GCM encrypted.
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpCode(secretB32: string, nowMs = Date.now(), step = 30): string {
  return hotp(base32Decode(secretB32), Math.floor(nowMs / 1000 / step));
}

/** Accepts the current step and ±1 neighbour (clock drift). Constant-time compare. */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), step = 30): boolean {
  const digits = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(nowMs / 1000 / step);
  for (const delta of [0, -1, 1]) {
    const expected = hotp(secret, counter + delta);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return true;
  }
  return false;
}

export function otpauthUri(secretB32: string, account: string, issuer = "CREATORS ARENA"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** AES-256-GCM: iv(12) + tag(16) + ciphertext, base64. */
export function encryptSecret(plain: string): string {
  const key = mfaEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(blob: string): string {
  const key = mfaEncryptionKey();
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
