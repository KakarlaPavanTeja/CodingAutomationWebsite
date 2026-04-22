import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { pipelineRuns } from "@/lib/db/schema";

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
  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = request.nextUrl.searchParams.get("runId");
  const problemId = request.nextUrl.searchParams.get("problemId");

  if (runId) {
    const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
    if (!rows[0]) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json({ run: toLegacyRun(rows[0]) });
  }

  if (problemId) {
    const rows = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.problemId, problemId))
      .orderBy(desc(pipelineRuns.startedAt));
    return NextResponse.json({ runs: rows.map(toLegacyRun) });
  }

  return NextResponse.json({ error: "runId or problemId required" }, { status: 400 });
}
