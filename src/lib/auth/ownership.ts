/**
 * Authorization helper: verify the current user can access a problem.
 *
 * Owners (problems.created_by == user.id) and admins always pass.
 * Anyone else gets a 403.
 *
 * Usage in API routes:
 *
 *     const auth = await requireProblemAccess(problemId);
 *     if (auth.error) return auth.error;
 *     // proceed with auth.session
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuthApi } from "./server";
import { db } from "@/lib/db";
import { problems, problemAccess } from "@/lib/db/schema";
import type { SessionUser } from "./session";

type Ok = {
  session: SessionUser;
  isOwner: boolean;
  isAdmin: boolean;
  isShared: boolean;
  error?: never;
};
type Err = {
  error: NextResponse;
  session?: never;
  isOwner?: never;
  isAdmin?: never;
  isShared?: never;
};

/**
 * Authorize access to a problem.
 *
 * Access is granted to the problem's owner (`problems.created_by`), any admin,
 * OR any member present in the problem's access list (`problem_access`).
 * Everyone else (including "not found") gets a generic 404 to avoid leaking
 * problem existence.
 */
export async function requireProblemAccess(problemId: string | null | undefined): Promise<Ok | Err> {
  const auth = await requireAuthApi();
  if (auth.error) return { error: auth.error };

  if (!problemId || typeof problemId !== "string") {
    return { error: NextResponse.json({ error: "problemId required" }, { status: 400 }) };
  }

  const isAdmin = auth.session.profile.role === "admin";

  // Admins skip the DB lookup.
  if (isAdmin) {
    return { session: auth.session, isOwner: false, isAdmin: true, isShared: false };
  }

  const rows = await db
    .select({ createdBy: problems.createdBy })
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);

  const owner = rows[0]?.createdBy;

  // Generic 404 for "not found" so we don't leak existence.
  if (!owner) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  if (owner === auth.session.userId) {
    return { session: auth.session, isOwner: true, isAdmin: false, isShared: false };
  }

  // Not the owner — check the problem's shared-access list.
  const shared = await db
    .select({ id: problemAccess.id })
    .from(problemAccess)
    .where(
      and(
        eq(problemAccess.problemId, problemId),
        eq(problemAccess.memberId, auth.session.userId),
      ),
    )
    .limit(1);

  if (shared.length > 0) {
    return { session: auth.session, isOwner: false, isAdmin: false, isShared: true };
  }

  // Generic 404 for "not yours" so we don't leak existence.
  return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
}

/**
 * Authorize *managing* a problem's access list (and other owner/admin-only
 * actions). Only the problem's owner or an admin pass; shared members and
 * everyone else get the same generic 404 as `requireProblemAccess`.
 */
export async function requireProblemManageAccess(
  problemId: string | null | undefined,
): Promise<Ok | Err> {
  const auth = await requireProblemAccess(problemId);
  if (auth.error) return { error: auth.error };

  if (!auth.isOwner && !auth.isAdmin) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  return auth;
}
