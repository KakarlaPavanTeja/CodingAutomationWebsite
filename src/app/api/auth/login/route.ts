import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/auth/service";
import { setSessionCookie } from "@/lib/auth/session";
import { authLimiter, getClientIP } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { authAuditLog } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed, resetAt } = await authLimiter.check(`login:${ip}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) },
      },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const result = await login(email, password);
  const ua = request.headers.get("user-agent") || "";

  if (!result.ok) {
    await db.insert(authAuditLog).values({
      eventType: "login_failure",
      userId: null,
      ipAddress: ip,
      userAgent: ua,
      metadata: { email },
    });
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  await setSessionCookie(result.sessionToken, result.expiresAt);
  await db.insert(authAuditLog).values({
    eventType: "login_success",
    userId: result.userId,
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, status: result.status });
}
