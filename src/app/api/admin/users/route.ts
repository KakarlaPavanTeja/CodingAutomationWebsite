import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/supabase/server";
import { createClient as createAdminAuth } from "@supabase/supabase-js";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  const supabase = auth.supabase;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  const supabase = auth.supabase;
  const body = await request.json();
  const { userId, status, role } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const updates: Record<string, string> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (role) updates.role = role;

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — deactivate user: wipe personal data but keep problems
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  const supabase = auth.supabase;
  const body = await request.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Wipe personal data from profile but keep record for FK references
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      display_name: "[deactivated]",
      email: `deactivated_${userId.slice(0, 8)}@removed`,
      status: "deactivated",
      role: "problem_setter",
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // Delete the auth user (removes email, password, sessions)
  try {
    const adminAuth = createAdminAuth(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await adminAuth.auth.admin.deleteUser(userId);
  } catch {
    // Auth user deletion is best-effort — profile is already wiped
  }

  return NextResponse.json({ success: true });
}
