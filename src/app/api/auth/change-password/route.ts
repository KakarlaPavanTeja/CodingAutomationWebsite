import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users, authAuditLog } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import {
  deleteAllSessionsForUser,
  createSession,
  setSessionCookie,
} from "@/lib/auth/session";

function passwordMeetsRequirements(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) return "Password must contain upper and lowercase letters.";
  if (!/\d/.test(pw)) return "Password must contain a number.";
  if (!/[^a-zA-Z0-9]/.test(pw)) return "Password must contain a special character.";
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;
  const userId = auth.session.userId;

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  if (!newPassword) {
    return NextResponse.json({ error: "New password is required." }, { status: 400 });
  }

  const pwErr = passwordMeetsRequirements(newPassword);
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 });
  }

  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // If the user already has a password, require the current one to confirm.
  // If they don't (migrated user who somehow reached this endpoint), allow set.
  if (user.passwordHash) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required." }, { status: 400 });
    }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from current password." },
        { status: 400 },
      );
    }
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash, passwordResetRequired: false, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Invalidate every existing session for this user, then issue a fresh one
  // so the caller stays logged in on the current device.
  await deleteAllSessionsForUser(userId);
  const fresh = await createSession(userId);
  await setSessionCookie(fresh.token, fresh.expiresAt);

  await db.insert(authAuditLog).values({
    eventType: "password_change",
    userId,
    ipAddress: request.headers.get("x-forwarded-for") || null,
    userAgent: request.headers.get("user-agent") || "",
  });

  return NextResponse.json({ ok: true });
}
