import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth/service";
import { passwordResetLimiter, getClientIP } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { authAuditLog } from "@/lib/db/schema";

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

  const token = await createPasswordResetToken(email);

  if (token) {
    const origin = request.headers.get("origin") || new URL(request.url).origin;
    const url = `${origin}/reset-password?mode=update&token=${token}`;
    // No email service configured yet — log so an admin can deliver manually.
    console.log(`[password-reset] ${email} -> ${url}`);
    await db.insert(authAuditLog).values({
      eventType: "password_reset_request",
      userId: null,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") || "",
      metadata: { email },
    });
  }

  // Always return success — do not leak whether the email exists.
  return NextResponse.json({ ok: true });
}
