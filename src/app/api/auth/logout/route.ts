import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, clearSessionCookie, deleteSessionByToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { authAuditLog } from "@/lib/db/schema";
import { getClientIP } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth/server";

export async function POST(request: NextRequest) {
  const session = await getSession();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  await deleteSessionByToken(token);
  await clearSessionCookie();

  if (session) {
    await db.insert(authAuditLog).values({
      eventType: "logout",
      userId: session.userId,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get("user-agent") || "",
    });
  }

  return NextResponse.json({ ok: true });
}
