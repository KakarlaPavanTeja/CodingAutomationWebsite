import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
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

  const supabase = await createServiceClient();
  const userAgent = request.headers.get("user-agent") || "";

  await supabase.from("auth_audit_log").insert({
    event_type,
    user_id: user_id || null,
    ip_address: ip,
    user_agent: userAgent,
    metadata: metadata || {},
  });

  return NextResponse.json({ logged: true });
}
