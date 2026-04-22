import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";
import { getProfileRoleById } from "@/lib/db/queries";
import { deletePrefix } from "@/lib/object-storage";

// Problem setter requests deletion (or admin soft-deletes)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;

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

  const problemRows = await db
    .select({ createdBy: problems.createdBy, status: problems.status })
    .from(problems)
    .where(eq(problems.id, id))
    .limit(1);
  const problem = problemRows[0];

  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  const profile = await getProfileRoleById(user.id);
  const isAdmin = profile?.role === "admin";

  if (!isAdmin) {
    if (problem.createdBy !== user.id) {
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

    await db
      .update(problems)
      .set({
        status: "deletion_pending",
        deletionReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(problems.id, id));

    return NextResponse.json({ success: true });
  }

  // Admin: soft-delete immediately
  await db
    .update(problems)
    .set({
      status: "deleted",
      deletionReason: reason.trim(),
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(problems.id, id));

  return NextResponse.json({ success: true, deletedAt: new Date().toISOString() });
}

// Admin permanently removes (hard delete + storage cleanup)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getProfileRoleById(user.id);
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // Storage cleanup (Replit App Storage)
  try {
    for (const subfolder of ["inputs", "outputs", "logs"]) {
      await deletePrefix(`${id}/${subfolder}/`);
    }
  } catch {
    // Continue even if storage cleanup fails
  }

  // Hard delete (cascades to pipeline_runs, pipeline_logs)
  await db.delete(problems).where(eq(problems.id, id));

  return NextResponse.json({ success: true });
}
