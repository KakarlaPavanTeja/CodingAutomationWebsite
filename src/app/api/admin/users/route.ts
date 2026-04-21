import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAdminApi } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient as createAdminAuth } from "@supabase/supabase-js";

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

  // Delete the auth user via Supabase admin API (Phase 5 will replace this)
  try {
    const adminAuth = createAdminAuth(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await adminAuth.auth.admin.deleteUser(userId);
  } catch {
    // Best-effort
  }

  return NextResponse.json({ success: true });
}
