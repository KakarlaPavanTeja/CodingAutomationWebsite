import { NextRequest, NextResponse } from "next/server";
import { confirmPasswordReset } from "@/lib/auth/service";
import { validatePassword } from "@/lib/auth-validation";
import { authLimiter, getClientIP } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { authAuditLog } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed } = await authLimiter.check(`reset-confirm:${ip}`);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  }

  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const token = body.token;
  const password = body.password ?? "";
  if (!token) {
    return NextResponse.json({ error: "Reset token is required." }, { status: 400 });
  }

  const pwRes = validatePassword(password);
  if (pwRes.score < 2) {
    return NextResponse.json({ error: "Password is too weak." }, { status: 400 });
  }

  const result = await confirmPasswordReset(token, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await db.insert(authAuditLog).values({
    eventType: "password_reset_complete",
    userId: result.userId,
    ipAddress: ip,
    userAgent: request.headers.get("user-agent") || "",
  });
  return NextResponse.json({ ok: true });
}
