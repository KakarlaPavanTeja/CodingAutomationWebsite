import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireProblemManageAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { problemAccess, problems, profiles } from "@/lib/db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET — list the members a problem is currently shared with.
 * Owner or admin only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireProblemManageAccess(id);
  if (auth.error) return auth.error;

  const rows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      display_name: profiles.displayName,
      granted_by: problemAccess.grantedBy,
      created_at: problemAccess.createdAt,
    })
    .from(problemAccess)
    .innerJoin(profiles, eq(profiles.id, problemAccess.memberId))
    .where(eq(problemAccess.problemId, id))
    .orderBy(asc(profiles.displayName), asc(profiles.email));

  return NextResponse.json({ members: rows });
}

/**
 * POST — grant one or more members access to a problem.
 * Body: { memberIds: string[] }
 * Owner or admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireProblemManageAccess(id);
  if (auth.error) return auth.error;

  let body: { memberIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.memberIds;
  const memberIds = Array.isArray(raw)
    ? Array.from(new Set(raw.filter((m): m is string => typeof m === "string" && UUID_RE.test(m))))
    : [];

  if (memberIds.length === 0) {
    return NextResponse.json({ error: "memberIds required" }, { status: 400 });
  }
  if (memberIds.length > 200) {
    return NextResponse.json({ error: "Too many members (max 200)." }, { status: 400 });
  }

  // The owner can't be added to their own access list.
  const ownerRows = await db
    .select({ createdBy: problems.createdBy })
    .from(problems)
    .where(eq(problems.id, id))
    .limit(1);
  const owner = ownerRows[0]?.createdBy;

  // Only allow granting to existing, active members.
  const validMembers = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(inArray(profiles.id, memberIds), eq(profiles.status, "active")));
  const validIds = new Set(validMembers.map((m) => m.id));

  const toInsert = memberIds.filter((m) => validIds.has(m) && m !== owner);

  if (toInsert.length === 0) {
    return NextResponse.json({ error: "No valid members to add." }, { status: 400 });
  }

  await db
    .insert(problemAccess)
    .values(
      toInsert.map((memberId) => ({
        problemId: id,
        memberId,
        grantedBy: auth.session.userId,
      })),
    )
    .onConflictDoNothing();

  return NextResponse.json({ success: true, added: toInsert.length });
}

/**
 * DELETE — revoke a member's access to a problem.
 * Body: { memberId: string }
 * Owner or admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireProblemManageAccess(id);
  if (auth.error) return auth.error;

  let body: { memberId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const memberId = body.memberId;
  if (typeof memberId !== "string" || !UUID_RE.test(memberId)) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  await db
    .delete(problemAccess)
    .where(and(eq(problemAccess.problemId, id), eq(problemAccess.memberId, memberId)));

  return NextResponse.json({ success: true });
}
