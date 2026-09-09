import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "./index";
import { problemAccess, problems, profiles } from "./schema";

export async function getProfileById(userId: string) {
  const rows = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function getProfileRoleById(userId: string) {
  const rows = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export const nowExpr = sql`now()`;

/**
 * Which problems may this user see?
 *
 * Non-admins see problems they own OR ones explicitly shared with them through
 * `problem_access`; admins see everything not deleted.
 *
 * Extracted rather than left inline in `/api/problems` because a SECOND
 * endpoint now needs the identical rule (the live-loads feed behind the
 * problems list). Two copies of a visibility rule drift, and the direction this
 * one drifts is "shows you a load belonging to someone else's problem" — so it
 * gets exactly one definition and both callers use it.
 */
export function visibleProblemsFilter(args: { userId: string; isAdmin: boolean }) {
  if (args.isAdmin) return ne(problems.status, "deleted");
  const shared = db
    .select({ id: problemAccess.problemId })
    .from(problemAccess)
    .where(eq(problemAccess.memberId, args.userId));
  return and(
    ne(problems.status, "deleted"),
    or(eq(problems.createdBy, args.userId), inArray(problems.id, shared)),
  );
}
