/**
 * Transactional email via Resend.
 *
 * Configuration:
 *   RESEND_API_KEY  — required. Get one from https://resend.com/api-keys.
 *   EMAIL_FROM      — optional, defaults to Resend's shared sender for testing.
 *                     Set to "Coding Automation <noreply@your-domain.com>"
 *                     once you've verified a sending domain in Resend.
 *
 * Until a custom domain is verified in Resend, sends only succeed when the
 * recipient is the same email used to sign up the Resend account.
 */
import { Resend } from "resend";

const FROM_DEFAULT = "Coding Automation <onboarding@resend.dev>";

let _client: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendEmailResult> {
  const c = client();
  if (!c) {
    return { ok: false, error: "Email service not configured (missing RESEND_API_KEY)." };
  }
  const from = process.env.EMAIL_FROM || FROM_DEFAULT;
  try {
    const r = await c.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (r.error) {
      console.error("[email] resend error:", r.error);
      return { ok: false, error: r.error.message ?? "Email send failed." };
    }
    return { ok: true, id: r.data?.id };
  } catch (err) {
    console.error("[email] send threw:", err);
    return { ok: false, error: "Email send failed." };
  }
}

/** Reset-link email body. Plain layout to maximize deliverability. */
export function passwordResetEmail(opts: { resetUrl: string; recipientName?: string | null }): {
  subject: string;
  html: string;
  text: string;
} {
  const greet = opts.recipientName ? `Hi ${opts.recipientName},` : "Hi,";
  const subject = "Reset your Coding Automation password";
  const text = `${greet}

We received a request to reset your password.

Click the link below to choose a new password. This link is valid for 1 hour and can only be used once.

${opts.resetUrl}

If you did not request this, you can safely ignore this email — your password won't change.

— Coding Automation`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">Reset your password</h2>
  <p style="margin:0 0 12px;">${greet}</p>
  <p style="margin:0 0 16px;">We received a request to reset your password. Click the button below to choose a new one. This link is valid for 1 hour and can only be used once.</p>
  <p style="margin:24px 0;">
    <a href="${opts.resetUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">Reset password</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy this link into your browser:</p>
  <p style="margin:0 0 24px;font-size:12px;color:#555;word-break:break-all;">${opts.resetUrl}</p>
  <p style="margin:0;font-size:13px;color:#555;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
</body></html>`;

  return { subject, html, text };
}
