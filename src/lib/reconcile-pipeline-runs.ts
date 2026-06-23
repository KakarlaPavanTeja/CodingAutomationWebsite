import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineLogs, pipelineRuns, problems } from "@/lib/db/schema";
import { getProcessPidAsync } from "@/lib/process-registry";
import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";

const STALE_ORPHAN_MS = 5 * 60 * 1000;
const EMPTY_LOG_ORPHAN_MS = 3 * 60 * 1000;
// Hard ceiling: a run "running" longer than the pipeline timeout (45 min) plus a
// buffer is force-failed regardless of pid liveness, so a recycled PID that
// process.kill(pid,0) reports as alive can't keep a dead run stuck forever (P1-H8).
const MAX_RUNNING_MS = 50 * 60 * 1000;

// Throttle reconciliation so frontend polling (every 2-4s) doesn't turn every
// read into a write storm against pipeline_runs/problems (P1-M3).
const RECONCILE_THROTTLE_MS = 5000;
const lastReconcileAt = new Map<string, number>();

/**
 * Single source of truth for `problems.status`, derived from the problem's
 * pipeline_runs rows (P1-H6). Call this after any run/stop/reconcile mutation
 * instead of writing problems.status ad-hoc from multiple places.
 *
 * Rules (per the Clear Picture plan §4.4):
 *  - any run still `running`            -> processing
 *  - latest run is a successful
 *    prepare_platform_json              -> completed
 *  - latest run was stopped (exit -1)   -> draft
 *  - latest run failed                  -> failed
 *  - otherwise (partial / non-final
 *    success, nothing running)          -> draft
 * Only writes when the derived status differs, to avoid churn.
 */
export async function recomputeProblemStatus(problemId: string): Promise<void> {
  const rows = await db
    .select({
      stepId: pipelineRuns.stepId,
      status: pipelineRuns.status,
      exitCode: pipelineRuns.exitCode,
      startedAt: pipelineRuns.startedAt,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.problemId, problemId));

  if (rows.length === 0) return; // nothing to derive from — leave as-is

  let next: "processing" | "completed" | "failed" | "draft";
  if (rows.some((r) => r.status === "running")) {
    next = "processing";
  } else {
    const latest = rows.reduce((a, b) =>
      (a.startedAt?.getTime() ?? 0) >= (b.startedAt?.getTime() ?? 0) ? a : b
    );
    const parent = parsePipelineRunStepKey(latest.stepId).parentStepId;
    if (parent === "prepare_platform_json" && latest.status === "completed" && latest.exitCode === 0) {
      next = "completed";
    } else if (latest.exitCode === -1) {
      next = "draft"; // stopped
    } else if (latest.status === "failed") {
      next = "failed";
    } else {
      next = "draft"; // partial / non-final success with nothing running
    }
  }

  const prob = await db
    .select({ status: problems.status })
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);
  if (prob[0] && prob[0].status !== next) {
    await db
      .update(problems)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(problems.id, problemId));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseExitFromLog(content: string): number | null {
  const matches = [...content.matchAll(/Process exited with code (\d+)/g)];
  if (matches.length === 0) return null;
  return parseInt(matches[matches.length - 1][1], 10);
}

/** Close pipeline_runs left as `running` after crashes, early API errors, or dead PIDs. */
export async function reconcileStalePipelineRuns(problemId: string): Promise<number> {
  // Throttle: skip if we reconciled this problem very recently (P1-M3).
  const last = lastReconcileAt.get(problemId) ?? 0;
  const nowTs = Date.now();
  if (nowTs - last < RECONCILE_THROTTLE_MS) return 0;
  lastReconcileAt.set(problemId, nowTs);

  const running = await db
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.problemId, problemId), eq(pipelineRuns.status, "running")));

  if (running.length === 0) return 0;

  const now = Date.now();
  let fixed = 0;

  for (const run of running) {
    const runAge = now - (run.startedAt?.getTime() ?? now);
    const pid = (await getProcessPidAsync(run.id)) ?? run.pid ?? undefined;
    // Trust "alive" only within the max-runtime ceiling; beyond it the pid is
    // almost certainly reused (the real process would have hit the 45-min
    // SIGTERM), so fall through and force-fail (P1-H8).
    if (pid && isProcessAlive(pid) && runAge < MAX_RUNNING_MS) {
      continue;
    }

    const logRows = await db
      .select({ content: pipelineLogs.content })
      .from(pipelineLogs)
      .where(eq(pipelineLogs.runId, run.id))
      .limit(1);
    const content = logRows[0]?.content ?? "";
    const exitFromLog = parseExitFromLog(content);

    if (exitFromLog !== null) {
      await db
        .update(pipelineRuns)
        .set({
          status: exitFromLog === 0 ? "completed" : "failed",
          exitCode: exitFromLog,
          finishedAt: run.finishedAt ?? new Date(),
          pid: null,
        })
        .where(eq(pipelineRuns.id, run.id));
      fixed++;
      continue;
    }

    const startedMs = run.startedAt?.getTime() ?? now;
    const age = now - startedMs;
    // Over the runtime ceiling -> force-fail even if a (likely reused) pid still
    // looks alive. Otherwise apply the normal orphan heuristics.
    const overMaxRuntime = age >= MAX_RUNNING_MS;
    const isOrphan = overMaxRuntime || !pid || !isProcessAlive(pid);

    if (isOrphan && (overMaxRuntime || age > STALE_ORPHAN_MS || (!content.trim() && age > EMPTY_LOG_ORPHAN_MS))) {
      await db
        .update(pipelineRuns)
        .set({
          status: "failed",
          exitCode: -1,
          finishedAt: run.finishedAt ?? new Date(),
          pid: null,
        })
        .where(eq(pipelineRuns.id, run.id));
      fixed++;
    }
  }

  if (fixed > 0) {
    // Re-derive problems.status from the (now-updated) run rows in one place
    // instead of the previous ad-hoc processing->draft flip (P1-H6).
    await recomputeProblemStatus(problemId);
  }

  return fixed;
}
