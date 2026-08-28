import { now, one, run } from "@/lib/db";

/**
 * Network intelligence per (hashed) IP — VPN / datacenter / proxy / Tor
 * detection via api.ipapi.is, cached in the ip_intel table so the free
 * quota covers far more traffic than the raw request count.
 *
 * Privacy contract: the raw IP is used only for the one outbound lookup and
 * is never stored — the cache row is keyed by the same salted hash the click
 * pipeline uses, plus a coarse verdict (flags/ASN org/city).
 */

export interface IpIntelRow {
  ip_hash: string;
  risky: number;
  flags: string | null;
  asn_org: string | null;
  country: string | null;
  city: string | null;
  checked_at: number;
}

const CACHE_TTL_MS = 7 * 86_400_000;

/** iCloud Private Relay / consumer CDN egress — datacenter-flagged but human. */
const RELAY_ASN_PATTERN = /cloudflare|akamai|fastly|apple/i;

const PRIVATE_IP_PATTERN =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|::1|fe80:|fc00:|fd)/i;

export async function getIpIntel(ipHash: string): Promise<IpIntelRow | null> {
  return (await one<IpIntelRow>("SELECT * FROM ip_intel WHERE ip_hash = ?", ipHash)) ?? null;
}

/**
 * Refresh the cache for one IP if stale/missing. Designed to run during the
 * interstitial (step 1) via after(), so the verdict is already cached by the
 * time the counted request (step 2) arrives — zero latency on the click path.
 * Failures are silent: no row is written, the next visit retries.
 */
export async function ensureIpIntel(rawIp: string, ipHash: string): Promise<void> {
  if (!rawIp || PRIVATE_IP_PATTERN.test(rawIp)) return;
  const cached = await getIpIntel(ipHash);
  if (cached && now() - cached.checked_at < CACHE_TTL_MS) return;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(`https://api.ipapi.is/?q=${encodeURIComponent(rawIp)}`, {
      signal: AbortSignal.timeout(2_500),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return;
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return;
  }

  const asn = data.asn as { org?: string } | undefined;
  const company = data.company as { name?: string } | undefined;
  const location = data.location as { country_code?: string; city?: string } | undefined;
  const asnOrg = asn?.org ?? company?.name ?? null;

  const flags: string[] = [];
  if (data.is_vpn) flags.push("vpn");
  if (data.is_proxy) flags.push("proxy");
  if (data.is_tor) flags.push("tor");
  if (data.is_abuser) flags.push("abuser");
  if (data.is_datacenter) flags.push("datacenter");

  // datacenter ALONE is not risky when it looks like Private Relay egress —
  // rejecting Saudi iPhone users on iCloud+ would poison the whole model.
  const relayLike = asnOrg !== null && RELAY_ASN_PATTERN.test(asnOrg);
  const risky =
    data.is_vpn || data.is_proxy || data.is_tor || data.is_abuser || (data.is_datacenter && !relayLike)
      ? 1
      : 0;

  await run(
    `INSERT INTO ip_intel (ip_hash, risky, flags, asn_org, country, city, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip_hash) DO UPDATE SET
       risky = excluded.risky, flags = excluded.flags, asn_org = excluded.asn_org,
       country = excluded.country, city = excluded.city, checked_at = excluded.checked_at`,
    ipHash,
    risky,
    flags.length ? flags.join(",") : null,
    asnOrg,
    location?.country_code ?? null,
    location?.city ?? null,
    now()
  );
}
