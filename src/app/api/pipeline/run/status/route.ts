import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineRuns } from "@/lib/db/schema";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";
import { requireAuthApi } from "@/lib/auth/server";
import { reconcileStalePipelineRuns } from "@/lib/reconcile-pipeline-runs";

function toLegacyRun(r: typeof pipelineRuns.$inferSelect) {
  return {
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
  };
}

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId");
  const problemId = request.nextUrl.searchParams.get("problemId");

  if (runId) {
    if (!/^[0-9a-fA-F-]{36}$/.test(runId)) {
      return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
    }
    // First require auth, then look up the run, then verify access to its problem.
    const baseAuth = await requireAuthApi();
    if (baseAuth.error) return baseAuth.error;

    const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
    if (!rows[0]) {
      // Generic 404 to avoid leaking run-id existence to non-owners.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const access = await requireProblemAccess(rows[0].problemId);
    if (access.error) return access.error;
    await reconcileStalePipelineRuns(rows[0].problemId);
    const refreshed = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
    return NextResponse.json({ run: toLegacyRun(refreshed[0] ?? rows[0]) });
  }

  if (problemId) {
    let safeProblemId: string;
    try {
      safeProblemId = assertSafeProblemId(problemId);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const access = await requireProblemAccess(safeProblemId);
    if (access.error) return access.error;

    await reconcileStalePipelineRuns(safeProblemId);

    const rows = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.problemId, safeProblemId))
      .orderBy(desc(pipelineRuns.startedAt));
    return NextResponse.json({ runs: rows.map(toLegacyRun) });
  }

  return NextResponse.json({ error: "runId or problemId required" }, { status: 400 });
}
