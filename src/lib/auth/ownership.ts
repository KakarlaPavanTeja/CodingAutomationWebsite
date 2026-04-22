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
import { eq } from "drizzle-orm";
import { requireAuthApi } from "./server";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";
import type { SessionUser } from "./session";

type Ok = { session: SessionUser; isOwner: boolean; isAdmin: boolean; error?: never };
type Err = { error: NextResponse; session?: never; isOwner?: never; isAdmin?: never };

export async function requireProblemAccess(problemId: string | null | undefined): Promise<Ok | Err> {
  const auth = await requireAuthApi();
  if (auth.error) return { error: auth.error };

  if (!problemId || typeof problemId !== "string") {
    return { error: NextResponse.json({ error: "problemId required" }, { status: 400 }) };
  }

  const isAdmin = auth.session.profile.role === "admin";

  // Admins skip the DB lookup.
  if (isAdmin) {
    return { session: auth.session, isOwner: false, isAdmin: true };
  }

  const rows = await db
    .select({ createdBy: problems.createdBy })
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);

  const owner = rows[0]?.createdBy;

  // Generic 404 for both "not found" and "not yours" so we don't leak existence.
  if (!owner || owner !== auth.session.userId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  return { session: auth.session, isOwner: true, isAdmin: false };
}
