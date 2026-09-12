import { id, now, run } from "@/lib/db";

/**
 * Outbound e-mail with a pluggable provider.
 *  - "log" (default outside production): nothing leaves the machine; the
 *    message is stored in `mail_outbox` and printed to the server log so the
 *    flows can be exercised locally.
 *  - "resend": Resend's HTTP API (no SDK, no native code). Requires
 *    RESEND_API_KEY and MAIL_FROM.
 * Every message is recorded in `mail_outbox` with its delivery status. This
 * module never throws to callers: an undeliverable e-mail must not break a
 * registration or a reset request (and must not reveal anything to the user).
 */

export type MailProvider = "log" | "resend";

export function mailProvider(): MailProvider {
  const v = process.env.MAIL_PROVIDER;
  return v === "resend" ? "resend" : "log";
}

/** True only when a real provider is configured — flows that REQUIRE e-mail are gated on this. */
export function mailEnabled(): boolean {
  return mailProvider() === "resend" && !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(msg: MailMessage): Promise<{ ok: boolean; id: string }> {
  const rowId = id();
  const provider = mailProvider();
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
  if (provider === "log") {
    if (process.env.NODE_ENV !== "test") {
      console.log(`[mail:log] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    }
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
    return { ok: false, id: rowId };
  }
}
