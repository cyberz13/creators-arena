import { headers } from "next/headers";

/**
 * The origin tracking links should use, derived from the live request —
 * so a newly attached custom domain (e.g. creatorarena.agency) works with
 * zero reconfiguration. NEXT_PUBLIC_APP_URL remains the fallback.
 */
export async function requestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    /* not in a request scope */
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
