import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createPasswordResetToken } from "@/lib/auth/service";
import { passwordResetLimiter, getClientIP } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { authAuditLog, profiles, users } from "@/lib/db/schema";
import { sendEmail, passwordResetEmail } from "@/lib/email";
import { buildResetUrl } from "@/lib/app-url";

async function safeAudit(values: Parameters<typeof db.insert>[0] extends never ? never : Record<string, unknown>) {
  try {
    await db.insert(authAuditLog).values(values as never);
  } catch (err) {
    console.error("[password-reset] audit insert failed:", err);
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed, resetAt } = await passwordResetLimiter.check(`reset-req:${ip}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) },
      },
    );
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const ua = request.headers.get("user-agent") || "";
  const token = await createPasswordResetToken(email);
  let emailSent: boolean | undefined;
  let emailError: string | undefined;

  if (token) {
    // Build link from a trusted server-side base URL — never from request headers.
    const url = buildResetUrl(token);

    // Look up the recipient's display name for a friendlier greeting.
    let recipientName: string | null = null;
    try {
      const rows = await db
        .select({ name: profiles.displayName })
        .from(profiles)
        .innerJoin(users, eq(users.id, profiles.id))
        .where(eq(users.email, email))
        .limit(1);
      recipientName = rows[0]?.name ?? null;
    } catch {
      // non-fatal
    }

    const { subject, html, text } = passwordResetEmail({ resetUrl: url, recipientName });
    const send = await sendEmail({ to: email, subject, html, text });
    emailSent = send.ok;
    emailError = send.ok ? undefined : send.error;

    if (!send.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[password-reset] email send failed for ${email}; fallback link -> ${url}`);
      } else {
        console.error(`[password-reset] email send failed for ${email}: ${send.error}`);
      }
    }
  }

  // Always audit, regardless of whether the email exists, so abuse is visible.
  // Never wedge the response on audit failure.
  await safeAudit({
    eventType: "password_reset_request",
    userId: null,
    ipAddress: ip,
    userAgent: ua,
    metadata: { email, accountExists: token !== null, emailSent, emailError },
  });

  // Always return success — do not leak whether the email exists.
  return NextResponse.json({ ok: true });
}
