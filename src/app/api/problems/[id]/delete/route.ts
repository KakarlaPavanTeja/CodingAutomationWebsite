import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Problem setter requests deletion
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { reason } = body;

  if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
    return NextResponse.json(
      { error: "Please provide a reason (at least 5 characters)." },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();
  const { data: problem } = await serviceClient
    .from("problems")
    .select("created_by, status")
    .eq("id", id)
    .single();

  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  // Check if admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role === "admin";

  // Problem setter: can only request deletion for their own non-completed problems
  if (!isAdmin) {
    if (problem.created_by !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (problem.status === "completed") {
      return NextResponse.json(
        { error: "Completed problems cannot be deleted." },
        { status: 400 }
      );
    }
    if (problem.status === "deletion_pending") {
      return NextResponse.json(
        { error: "Deletion already requested." },
        { status: 400 }
      );
    }

    // Request deletion (pending admin approval)
    const { error } = await serviceClient
      .from("problems")
      .update({
        status: "deletion_pending",
        deletion_reason: reason.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  // Admin: soft-delete immediately (any status)
  const { error } = await serviceClient
    .from("problems")
    .update({
      status: "deleted",
      deletion_reason: reason.trim(),
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deletedAt: new Date().toISOString() });
}

// Admin permanently removes (hard delete + storage cleanup)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const serviceClient = await createServiceClient();

  // Clean up storage files
  try {
    const storage = serviceClient.storage.from(process.env.STORAGE_BUCKET || "pipeline-files");
    for (const subfolder of ["inputs", "outputs", "logs"]) {
      const { data: files } = await storage.list(`${id}/${subfolder}`, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map((f) => `${id}/${subfolder}/${f.name}`);
        await storage.remove(paths);
      }
    }
  } catch {
    // Storage cleanup failed — continue with DB delete
  }

  // Hard delete from DB (cascades to pipeline_runs, pipeline_logs)
  const { error } = await serviceClient
    .from("problems")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
