/**
 * Client IP extraction with an explicit trust model.
 *
 * On Vercel the platform proxy overwrites `x-real-ip` and `x-forwarded-for`
 * with the connecting client's address, so they cannot be spoofed by the
 * client. Anywhere else (local dev, tests, other hosts) `x-forwarded-for` is
 * only meaningful when a trusted reverse proxy sets it — we take the first
 * entry, which is the conventional client position, and document that a
 * self-hosted deploy must terminate TLS behind a proxy it controls.
 */
export function clientIp(headers: Headers): string {
  if (process.env.VERCEL) {
    const real = headers.get("x-real-ip");
    if (real) return real.trim();
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "0.0.0.0";
}
