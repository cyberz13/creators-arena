import { headers } from "next/headers";
import { appUrl, isProduction } from "./env";

/**
 * Trusted public origin for absolute links (tracking links, e-mails, report
 * URLs). In production this is ALWAYS the configured NEXT_PUBLIC_APP_URL:
 * request `Host`/`X-Forwarded-Host` headers are attacker-influenced and must
 * never decide where a password-reset link points. In development the
 * request host is honoured only for localhost/127.0.0.1.
 */
export async function requestOrigin(): Promise<string> {
  const canonical = appUrl().origin;
  if (isProduction()) return canonical;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  } catch {
    /* not in a request scope */
  }
  return canonical;
}
