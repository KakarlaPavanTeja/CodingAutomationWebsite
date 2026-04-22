/**
 * Admin-only endpoint that mints a password-reset link for the target user
 * and returns the URL in the response. Until an email service is wired up,
 * this is the production-safe path for delivering reset links to migrated
 * users (whose accounts have password_hash=NULL and password_reset_required=true).
 *
 * Audit-logged. Rate-limited by the admin-auth check.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth/server";
import { createPasswordResetToken } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { users, authAuditLog } from "@/lib/db/schema";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  const found = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const target = found[0];
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const token = await createPasswordResetToken(target.email);
  if (!token) {
    return NextResponse.json({ error: "Failed to create reset token." }, { status: 500 });
  }

  const origin = request.headers.get("origin") || new URL(request.url).origin;
  const url = `${origin}/reset-password?mode=update&token=${token}`;

  await db.insert(authAuditLog).values({
    eventType: "admin_reset_link_minted",
    userId: auth.profile.id,
    ipAddress: request.headers.get("x-forwarded-for") || null,
    userAgent: request.headers.get("user-agent") || "",
    metadata: { targetUserId: target.id, targetEmail: target.email },
  });

  return NextResponse.json({ url, email: target.email });
}
