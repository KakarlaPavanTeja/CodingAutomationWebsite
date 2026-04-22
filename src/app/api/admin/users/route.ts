import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { profiles, users, sessions } from "@/lib/db/schema";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const rows = await db.select().from(profiles).orderBy(desc(profiles.createdAt));
  // Snake-case keys for frontend compat
  const users = rows.map((r) => ({
    id: r.id,
    email: r.email,
    display_name: r.displayName,
    role: r.role,
    status: r.status,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
  return NextResponse.json({ users });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  const body = await request.json();
  const { userId, status, role } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const updates: Partial<typeof profiles.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (status) updates.status = status;
  if (role) updates.role = role;

  await db.update(profiles).set(updates).where(eq(profiles.id, userId));

  return NextResponse.json({ success: true });
}

// DELETE — deactivate user: wipe personal data but keep problems
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  const body = await request.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  await db
    .update(profiles)
    .set({
      displayName: "[deactivated]",
      email: `deactivated_${userId.slice(0, 8)}@removed`,
      status: "deactivated",
      role: "problem_setter",
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, userId));

  // Wipe credentials and revoke sessions so the user can't sign in again.
  await db
    .update(users)
    .set({
      email: `deactivated_${userId.slice(0, 8)}@removed`,
      passwordHash: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));

  return NextResponse.json({ success: true });
}
