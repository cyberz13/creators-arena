import { id, now, run } from "@/lib/db";
import { mailProviderConfig, type MailProviderName } from "@/lib/env";

/**
 * Outbound e-mail with a pluggable provider.
 *  - "log": development/test ONLY. The message is stored in `mail_outbox` and
 *    the console gets a one-line notice with the outbox id — never the body,
 *    so reset links / verification tokens are never written to any log.
 *    Refused in production.
 *  - "resend": Resend's HTTP API (no SDK, no native code). Requires
 *    RESEND_API_KEY and MAIL_FROM.
 *  - unset in production: mail is "not configured" — messages are recorded
 *    as failed, nothing is sent, and flows that depend on delivery report it.
 * Bodies are purged from the outbox after MAIL_BODY_RETENTION_MS.
 */

export type MailProvider = MailProviderName;
export const MAIL_BODY_RETENTION_MS = 7 * 86_400_000;

/** Resolves the provider and validates its configuration (throws ConfigError on invalid production config). */
export function mailProvider(): MailProvider {
  return mailProviderConfig();
}

/** True only when a real provider can deliver mail — flows that REQUIRE e-mail are gated on this. */
export function mailEnabled(): boolean {
  try {
    return mailProvider() === "resend";
  } catch {
    return false;
  }
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailResult = { ok: true; id: string } | { ok: false; id: string; reason: "not_configured" | "provider_error" };

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const rowId = id();
  let provider: MailProvider;
  try {
    provider = mailProvider();
  } catch {
    provider = "none";
  }
  await run(
    `INSERT INTO mail_outbox (id, to_email, subject, body, provider, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    rowId,
    msg.to,
    msg.subject,
    msg.text,
    provider,
    now()
  );
  if (provider === "none") {
    await run("UPDATE mail_outbox SET status = 'failed', error = 'mail_not_configured' WHERE id = ?", rowId);
    return { ok: false, id: rowId, reason: "not_configured" };
  }
  if (provider === "log") {
    // Dev convenience only: point at the outbox row; the body (and any token) stays out of the log.
    if (process.env.NODE_ENV !== "test") console.log(`[mail:log] queued to=${msg.to} subject="${msg.subject}" outbox=${rowId}`);
    await run("UPDATE mail_outbox SET status = 'sent', sent_at = ? WHERE id = ?", now(), rowId);
    return { ok: true, id: rowId };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`resend_http_${res.status}`);
    await run("UPDATE mail_outbox SET status = 'sent', sent_at = ? WHERE id = ?", now(), rowId);
    return { ok: true, id: rowId };
  } catch (e) {
    await run(
      "UPDATE mail_outbox SET status = 'failed', error = ? WHERE id = ?",
      String((e as Error).message ?? e).slice(0, 200),
      rowId
    );
    return { ok: false, id: rowId, reason: "provider_error" };
  }
}

/** Retention: message bodies (which may contain one-time links) are blanked after the window. */
export async function purgeMailBodies(nowMs = now()): Promise<void> {
  await run("UPDATE mail_outbox SET body = '' WHERE created_at < ? AND body <> ''", nowMs - MAIL_BODY_RETENTION_MS);
}
