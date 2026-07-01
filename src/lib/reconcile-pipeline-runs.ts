import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineLogs, pipelineRuns, problems } from "@/lib/db/schema";
import { getProcessPidAsync } from "@/lib/process-registry";
import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
import type { StepId } from "@/types/pipeline";

// Steps whose (re-)run genuinely changes the PACKAGED content — re-running any of
// these AFTER a successful prepare_platform_json means the problem is no longer a
// finished artifact, so it drops back to "draft" (per the chosen policy: any
// content re-run demotes to draft).
//
// Deliberately EXCLUDED from this set:
//  - generate_editorial: runs CONCURRENTLY with prepare_platform_json in Run All
//    (both only need packaging), so its start time is not a reliable "after
//    completion" signal — counting it would false-demote a clean full run. It is
//    also re-run frequently via the Refine feature; re-folding it into the JSON
//    goes through prepare_platform_json, which IS in this set.
//  - execute_tests_*, execute_editorial, harden_testcases, benchmark_testcases:
//    informational / non-blocking steps that legitimately run LAST and must not
//    undo completion. (execute_editorial being the last-started run is exactly
//    what used to wrongly leave a finished pipeline stuck on "draft".)
const CONTENT_RERUN_STEPS = new Set<StepId>([
  "generate_question",
  "generate_brute_force",
  "generate_testcases",
  "generate_wrong_solutions",
  "split_code",
  "generate_enrichment",
  "package_platform",
]);

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
 * Rules (per the Clear Picture plan §4.4, refined):
 *  - any run still `running`                     -> processing
 *  - latest prepare_platform_json succeeded, and
 *    no CONTENT step was re-run after it finished -> completed
 *      (trailing informational steps — execute_editorial, execute_tests,
 *       harden, benchmark — and the concurrent editorial do NOT undo this;
 *       a genuine content re-run after packaging DOES, dropping to draft)
 *  - else, from the latest run overall:
 *      stopped (exit -1) -> draft · failed -> failed · otherwise -> draft
 * Only writes when the derived status differs, to avoid churn.
 */
export async function recomputeProblemStatus(problemId: string): Promise<void> {
  // Serialize all status derivations for this problem inside a transaction that
  // locks the problem row (`SELECT … FOR UPDATE`). Without the lock two
  // concurrent recomputes (a throttled reconcile + a step close-handler, say)
  // can interleave: one reads "X running → processing", the other reads the now
  // -completed rows and writes "completed", then the first writes its stale
  // "processing" on top — and the problem sticks. The lock forces the later
  // recompute to re-read the fresh run rows under the same lock, so the last
  // writer always reflects reality (P1-H6).
  await db.transaction(async (tx) => {
    const prob = await tx
      .select({ status: problems.status })
      .from(problems)
      .where(eq(problems.id, problemId))
      .for("update")
      .limit(1);
    if (!prob[0]) return; // problem gone — nothing to derive

    // Read run rows *inside* the lock so the snapshot can't predate a concurrent
    // recompute's writes.
    const rows = await tx
      .select({
        stepId: pipelineRuns.stepId,
        status: pipelineRuns.status,
        exitCode: pipelineRuns.exitCode,
        startedAt: pipelineRuns.startedAt,
        finishedAt: pipelineRuns.finishedAt,
      })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.problemId, problemId));

    if (rows.length === 0) return; // nothing to derive from — leave as-is

    const startMs = (r: { startedAt: Date | null }) => r.startedAt?.getTime() ?? 0;

    let next: "processing" | "completed" | "failed" | "draft";
    if (rows.some((r) => r.status === "running")) {
      next = "processing";
    } else {
      // Completion is anchored to prepare_platform_json — the terminal packaging
      // step — NOT to "whatever ran last". Trailing informational steps
      // (execute_editorial, execute_tests, harden, benchmark) legitimately run
      // AFTER packaging and must not undo completion.
      const ppjRuns = rows.filter(
        (r) => parsePipelineRunStepKey(r.stepId).parentStepId === "prepare_platform_json"
      );
      const latestPpj = ppjRuns.length
        ? ppjRuns.reduce((a, b) => (startMs(a) >= startMs(b) ? a : b))
        : null;

      if (latestPpj && latestPpj.status === "completed" && latestPpj.exitCode === 0) {
        // Successfully packaged. It stays "completed" UNLESS a content step was
        // genuinely re-run AFTER packaging finished — that makes the packaged
        // artifact stale, so it drops to "draft" (any content re-run demotes).
        // Compare against the ppj run's FINISH time so steps that run
        // concurrently with packaging in the same Run All don't count as re-runs.
        const ppjFinish =
          latestPpj.finishedAt?.getTime() ?? latestPpj.startedAt?.getTime() ?? 0;
        const contentRerunAfter = rows.some((r) => {
          const parent = parsePipelineRunStepKey(r.stepId).parentStepId as StepId;
          return CONTENT_RERUN_STEPS.has(parent) && startMs(r) > ppjFinish;
        });
        next = contentRerunAfter ? "draft" : "completed";
      } else {
        // Never packaged (or the latest packaging attempt failed). Classify from
        // the most recent run overall.
        const latest = rows.reduce((a, b) => (startMs(a) >= startMs(b) ? a : b));
        if (latest.exitCode === -1) {
          next = "draft"; // stopped / aborted
        } else if (latest.status === "failed") {
          next = "failed";
        } else {
          next = "draft"; // partial / non-final success with nothing running
        }
      }
    }

    if (prob[0].status !== next) {
      await tx
        .update(problems)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(problems.id, problemId));
    }
  });
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
