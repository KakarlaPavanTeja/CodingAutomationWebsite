import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { problems, pipelineRuns } from "@/lib/db/schema";
import { getProfileRoleById } from "@/lib/db/queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const problemRows = await db.select().from(problems).where(eq(problems.id, id)).limit(1);
  const problem = problemRows[0];

  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  const profile = await getProfileRoleById(user.id);

  if (problem.createdBy !== user.id && profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const runs = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.problemId, id))
    .orderBy(desc(pipelineRuns.startedAt));

  // Snake-case for legacy frontend
  const problemOut = {
    id: problem.id,
    created_by: problem.createdBy,
    name: problem.name,
    question_type: problem.questionType,
    structure_type: problem.structureType,
    mode: problem.mode,
    scenario_level: problem.scenarioLevel,
    languages: problem.languages,
    status: problem.status,
    storage_path: problem.storagePath,
    created_at: problem.createdAt,
    updated_at: problem.updatedAt,
    deletion_reason: problem.deletionReason,
    deleted_at: problem.deletedAt,
  };

  const runsOut = runs.map((r) => ({
    id: r.id,
    problem_id: r.problemId,
    user_id: r.userId,
    step_id: r.stepId,
    status: r.status,
    exit_code: r.exitCode,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
    logs_summary: r.logsSummary,
    pid: r.pid,
  }));

  return NextResponse.json({ problem: problemOut, runs: runsOut });
}
