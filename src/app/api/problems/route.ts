import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { problems, profiles } from "@/lib/db/schema";
import { getProfileRoleById, visibleProblemsFilter } from "@/lib/db/queries";

export async function GET() {
  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getProfileRoleById(user.id);
  const isAdmin = profile?.role === "admin";

  // Own problems plus ones shared through problem_access; admins see all. The
  // rule lives in `visibleProblemsFilter` because the live-loads feed needs the
  // identical one — see there.
  const baseFilter = visibleProblemsFilter({ userId: user.id, isAdmin });

  const rows = await db
    .select({
      problem: problems,
      creator_email: profiles.email,
      creator_display_name: profiles.displayName,
    })
    .from(problems)
    .leftJoin(profiles, eq(problems.createdBy, profiles.id))
    .where(baseFilter)
    .orderBy(desc(problems.createdAt));

  // Join creator profile for list API response.
  const data = rows.map((r) => ({
    id: r.problem.id,
    created_by: r.problem.createdBy,
    name: r.problem.name,
    question_type: r.problem.questionType,
    structure_type: r.problem.structureType,
    mode: r.problem.mode,
    scenario_level: r.problem.scenarioLevel,
    difficulty: r.problem.difficulty,
    score: r.problem.score,
    languages: r.problem.languages,
    status: r.problem.status,
    storage_path: r.problem.storagePath,
    created_at: r.problem.createdAt,
    updated_at: r.problem.updatedAt,
    deletion_reason: r.problem.deletionReason,
    deleted_at: r.problem.deletedAt,
    profiles: r.creator_email
      ? { email: r.creator_email, display_name: r.creator_display_name }
      : null,
  }));

  return NextResponse.json({ problems: data });
}
