/**
 * Central, server-only configuration.
 *
 * Rules:
 *  - Production fails closed: a missing/short/duplicated secret throws at the
 *    first use (and at boot via instrumentation.ts) — never silently falls
 *    back to a known value.
 *  - Development/test may use fixed placeholder values so the app runs with
 *    no setup, but those values are refused the moment NODE_ENV=production.
 *  - Error messages name the variable only; values are never included.
 */

/** Evaluated per call so tests can stub NODE_ENV. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

const DEV_FALLBACKS: Record<string, string> = {
  SESSION_SECRET: "dev-only-session-secret-do-not-use-in-production-0000000000",
  CHALLENGE_SECRET: "dev-only-challenge-secret-do-not-use-in-production-000000000",
  IP_HASH_SALT: "dev-only-ip-salt-000000000000",
  MFA_ENCRYPTION_KEY: "ZGV2LW9ubHktbWZhLWtleS1ub3QtZm9yLXByb2R1Y3Rpb24tMDA=", // base64, 32+ bytes
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

export class ConfigError extends Error {
  constructor(variable: string, problem: string) {
    super(`Configuration error: ${variable} ${problem}`);
    this.name = "ConfigError";
  }
}

function raw(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

function secret(name: string, minLength: number): string {
  const v = raw(name);
  if (v !== undefined) {
    if (v.length < minLength) throw new ConfigError(name, `must be at least ${minLength} characters`);
    if (Object.values(DEV_FALLBACKS).includes(v) && isProduction())
      throw new ConfigError(name, "is set to a development placeholder");
    return v;
  }
  if (isProduction()) throw new ConfigError(name, "is required in production");
  return DEV_FALLBACKS[name];
}

export function sessionSecret(): string {
  return secret("SESSION_SECRET", 32);
}

export function challengeSecret(): string {
  const v = secret("CHALLENGE_SECRET", 32);
  if (v === sessionSecret()) throw new ConfigError("CHALLENGE_SECRET", "must differ from SESSION_SECRET");
  return v;
}

export function ipHashSalt(): string {
  return secret("IP_HASH_SALT", 16);
}

/** 32-byte key (base64) for AES-256-GCM encryption of TOTP secrets. */
export function mfaEncryptionKey(): Buffer {
  const v = secret("MFA_ENCRYPTION_KEY", 32);
  const buf = Buffer.from(v, "base64");
  if (buf.length < 32) throw new ConfigError("MFA_ENCRYPTION_KEY", "must decode to at least 32 bytes (base64)");
  return buf.subarray(0, 32);
}

/** Canonical public origin — the only host trusted for absolute links. */
export function appUrl(): URL {
  const v = raw("NEXT_PUBLIC_APP_URL") ?? (isProduction() ? undefined : DEV_FALLBACKS.NEXT_PUBLIC_APP_URL);
  if (!v) throw new ConfigError("NEXT_PUBLIC_APP_URL", "is required in production");
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new ConfigError("NEXT_PUBLIC_APP_URL", "must be an absolute URL");
  }
  if (isProduction() && url.protocol !== "https:")
    throw new ConfigError("NEXT_PUBLIC_APP_URL", "must use https in production");
  return url;
}

export type RegistrationMode = "open" | "pending_approval";

/** Production defaults to pending_approval: new creators log in but cannot compete until approved. */
export function registrationMode(): RegistrationMode {
  const v = raw("REGISTRATION_MODE");
  if (v === "open" || v === "pending_approval") return v;
  if (v !== undefined) throw new ConfigError("REGISTRATION_MODE", "must be open or pending_approval");
  return isProduction() ? "pending_approval" : "open";
}

export type MailProviderName = "log" | "resend" | "none";

/**
 * Mail transport selection, validated:
 *  - "resend" needs RESEND_API_KEY and MAIL_FROM;
 *  - "log" (console + outbox, no delivery) is refused in production;
 *  - unset → "log" in development/test, "none" (not configured) in production.
 * Throws ConfigError on an invalid combination so a bad deploy fails at boot.
 */
export function mailProviderConfig(): MailProviderName {
  const v = raw("MAIL_PROVIDER");
  if (v === "resend") {
    if (!raw("RESEND_API_KEY")) throw new ConfigError("RESEND_API_KEY", "is required when MAIL_PROVIDER=resend");
    if (!raw("MAIL_FROM")) throw new ConfigError("MAIL_FROM", "is required when MAIL_PROVIDER=resend");
    return "resend";
  }
  if (v === "log") {
    if (isProduction()) throw new ConfigError("MAIL_PROVIDER", "log is not allowed in production (no delivery)");
    return "log";
  }
  if (v !== undefined) throw new ConfigError("MAIL_PROVIDER", "must be resend or log");
  return isProduction() ? "none" : "log";
}

/**
 * Validates every production-critical variable at once. Called from
 * instrumentation.ts so a misconfigured deploy fails at boot, not on the
 * first unlucky request.
 */
export function assertProductionEnv(): void {
  if (!isProduction()) return;
  sessionSecret();
  challengeSecret();
  ipHashSalt();
  appUrl();
  registrationMode();
  mfaEncryptionKey();
  mailProviderConfig();
  // Postgres is mandatory in production unless SQLite is opted into explicitly
  // (local smoke tests of the production build). Vercel has no durable disk.
  if (!raw("DATABASE_URL") && (!raw("DATABASE_PATH") || raw("VERCEL")))
    throw new ConfigError("DATABASE_URL", "is required in production");
}
