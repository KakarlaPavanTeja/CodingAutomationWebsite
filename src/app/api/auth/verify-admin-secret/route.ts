import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { authLimiter, getClientIP } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed, resetAt } = await authLimiter.check(`admin-secret:${ip}`);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let body: { secret?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { secret } = body;
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  if (!adminSecret) {
    return NextResponse.json(
      { error: "Admin registration is not configured." },
      { status: 500 }
    );
  }

  if (!secret || typeof secret !== "string") {
    return NextResponse.json(
      { error: "Admin secret key is required." },
      { status: 400 }
    );
  }

  // Timing-safe comparison to prevent timing attacks
  const secretBuf = Buffer.from(secret);
  const adminBuf = Buffer.from(adminSecret);

  if (secretBuf.length !== adminBuf.length || !timingSafeEqual(secretBuf, adminBuf)) {
    return NextResponse.json(
      { error: "Invalid admin secret key." },
      { status: 403 }
    );
  }

  return NextResponse.json({ valid: true });
}
