import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
import { recomputeProblemStatus } from "@/lib/reconcile-pipeline-runs";
import { requireAuthApi } from "@/lib/auth/server";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineStates } from "@/lib/db/schema";
import { getProcessPidAsync } from "@/lib/process-registry";
import { pipelineStateCacheInvalidate } from "@/lib/pipeline-state-cache";

export async function POST(request: NextRequest) {
  const { runId } = await request.json();

  if (!runId || typeof runId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(runId)) {
    return NextResponse.json({ error: "Valid runId is required" }, { status: 400 });
  }

  // Require auth before any DB lookup.
  const baseAuth = await requireAuthApi();
  if (baseAuth.error) return baseAuth.error;

  const runRows = await db
    .select({ problemId: pipelineRuns.problemId, stepId: pipelineRuns.stepId })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, runId))
    .limit(1);
  const run = runRows[0];
  if (!run) {
    // Generic 404 to avoid leaking run-id existence.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only the owner of the run's problem (or admin) can stop it.
  const access = await requireProblemAccess(run.problemId);
  if (access.error) return access.error;

  await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      exitCode: -1,
      finishedAt: new Date(),
    })
    .where(eq(pipelineRuns.id, runId));

  const stateRows = await db
    .select({ stepStatuses: pipelineStates.stepStatuses })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, run.problemId))
    .limit(1);

  if (stateRows[0]) {
    const stepStatuses = (stateRows[0].stepStatuses as Record<string, unknown>) || {};
    const { parentStepId } = parsePipelineRunStepKey(run.stepId);
    // Only mark the PARENT failed when stopping the atomic parent run itself.
    // Stopping one GQ sub-step or one language tile (run.stepId is a composite
    // "parent__sub" key) must NOT flip the whole parent to failed and discard
    // its sibling progress — the client patches just that sub-run (P1-C2).
    const isAtomicParentRun = run.stepId === parentStepId;
    if (isAtomicParentRun) {
      stepStatuses[parentStepId] = {
        status: "failed",
        exitCode: -1,
        endTime: Date.now(),
      };
      await db
        .update(pipelineStates)
        .set({ stepStatuses, updatedAt: new Date() })
        .where(eq(pipelineStates.problemId, run.problemId));

      // The dashboard polls /api/pipeline/state; stale cache here means a
      // stopped step shows "running" for up to 5 seconds.
      pipelineStateCacheInvalidate(run.problemId);
    }
  }

  // Re-derive problems.status from the run rows in one place (P1-H6). This run
  // is now exitCode -1; if siblings are still running the problem stays
  // "processing", otherwise it drops to "draft".
  await recomputeProblemStatus(run.problemId);

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
