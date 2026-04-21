import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authAuditLog } from "@/lib/db/schema";
import { authLimiter, getClientIP } from "@/lib/rate-limit";

const ALLOWED_EVENTS = [
  "login_success",
  "login_failure",
  "signup",
  "logout",
  "password_reset_request",
  "password_reset_complete",
  "profile_update",
  "email_verified",
] as const;

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed } = await authLimiter.check(`audit:${ip}`);

  if (!allowed) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  }

  let body: {
    event_type?: string;
    user_id?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { event_type, user_id, metadata } = body;

  if (
    !event_type ||
    !ALLOWED_EVENTS.includes(event_type as (typeof ALLOWED_EVENTS)[number])
  ) {
    return NextResponse.json({ error: "Invalid event type." }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent") || "";

  await db.insert(authAuditLog).values({
    eventType: event_type,
    userId: user_id || null,
    ipAddress: ip,
    userAgent,
    metadata: metadata || {},
  });

  return NextResponse.json({ logged: true });
}
