import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getProcessPidAsync } from "@/lib/process-registry";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineStates, problems } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const { runId } = await request.json();

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runRows = await db
    .select({ problemId: pipelineRuns.problemId, stepId: pipelineRuns.stepId })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, runId))
    .limit(1);
  const run = runRows[0];

  await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      exitCode: -1,
      finishedAt: new Date(),
    })
    .where(eq(pipelineRuns.id, runId));

  if (run) {
    const stateRows = await db
      .select({ stepStatuses: pipelineStates.stepStatuses })
      .from(pipelineStates)
      .where(eq(pipelineStates.problemId, run.problemId))
      .limit(1);

    if (stateRows[0]) {
      const stepStatuses = (stateRows[0].stepStatuses as Record<string, unknown>) || {};
      stepStatuses[run.stepId] = {
        status: "failed",
        exitCode: -1,
        endTime: Date.now(),
      };
      await db
        .update(pipelineStates)
        .set({ stepStatuses, updatedAt: new Date() })
        .where(eq(pipelineStates.problemId, run.problemId));
    }

    await db
      .update(problems)
      .set({ status: "draft", updatedAt: new Date() })
      .where(and(eq(problems.id, run.problemId), eq(problems.status, "processing")));
  }

  const pid = await getProcessPidAsync(runId);
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already dead
      }
    }
  }

  return NextResponse.json({ success: true, message: "Step stopped" });
}
