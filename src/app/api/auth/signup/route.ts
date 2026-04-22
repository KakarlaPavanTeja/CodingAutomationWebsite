import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { signup } from "@/lib/auth/service";
import { setSessionCookie } from "@/lib/auth/session";
import { authLimiter, getClientIP } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { authAuditLog } from "@/lib/db/schema";
import {
  validateEmail,
  validatePassword,
  validateDisplayName,
} from "@/lib/auth-validation";

function checkAdminSecret(provided: string | undefined): boolean {
  const adminSecret = process.env.ADMIN_SECRET_KEY;
  if (!adminSecret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(adminSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed, resetAt } = await authLimiter.check(`signup:${ip}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) },
      },
    );
  }

  let body: {
    email?: string;
    password?: string;
    displayName?: string;
    role?: "admin" | "problem_setter";
    adminSecret?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const role = body.role === "admin" ? "admin" : "problem_setter";

  const emailRes = validateEmail(body.email ?? "");
  if (!emailRes.valid) {
    return NextResponse.json({ error: emailRes.error, field: "email" }, { status: 400 });
  }
  const nameRes = validateDisplayName(body.displayName ?? "");
  if (!nameRes.valid) {
    return NextResponse.json({ error: nameRes.error, field: "displayName" }, { status: 400 });
  }
  const pwRes = validatePassword(body.password ?? "");
  if (pwRes.score < 2) {
    return NextResponse.json(
      { error: "Password is too weak.", field: "password" },
      { status: 400 },
    );
  }

  if (role === "admin" && !checkAdminSecret(body.adminSecret)) {
    return NextResponse.json(
      { error: "Invalid admin secret key.", field: "adminSecret" },
      { status: 403 },
    );
  }

  const result = await signup({
    email: emailRes.normalized,
    password: body.password!,
    displayName: nameRes.sanitized,
    role,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, field: result.field }, { status: 400 });
  }

  await setSessionCookie(result.sessionToken, result.expiresAt);
  await db.insert(authAuditLog).values({
    eventType: "signup",
    userId: result.userId,
    ipAddress: ip,
    userAgent: request.headers.get("user-agent") || "",
    metadata: { role },
  });

  return NextResponse.json({ ok: true, status: result.status });
}
