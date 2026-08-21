import type { LogLine, StepStatus, SubStepRunState } from "@/types/pipeline";

/** A step that is in progress (running) or being stopped — treat as "busy" for
 * spinners, polling, disabling Run, and live timers. */
export function isActiveStatus(status: StepStatus): boolean {
  return status === "running" || status === "stopping";
}

/** A step that has reached a terminal state (no more progress expected). */
export function isTerminalStatus(status: StepStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped" || status === "skipped";
}

function boundsFromLogs(logs: LogLine[] | undefined): { start: number | null; end: number | null } {
  if (!logs?.length) return { start: null, end: null };
  let start: number | null = null;
  let end: number | null = null;
  for (const line of logs) {
    if (typeof line.ts !== "number") continue;
    if (start === null || line.ts < start) start = line.ts;
    if (end === null || line.ts > end) end = line.ts;
  }
  return { start, end };
}

/** Resolve wall-clock bounds for a sub-step / lang run (handles missing startTime). */
export function resolveRunBounds(
  run: SubStepRunState | undefined,
  status: StepStatus,
  now = Date.now()
): { startTime: number | null; endTime: number | null } {
  if (!run) return { startTime: null, endTime: null };

  const fromLogs = boundsFromLogs(run.logs);
  const startTime = run.startTime ?? fromLogs.start;

  if (isActiveStatus(status)) {
    if (!startTime) return { startTime: null, endTime: null };
    // While running/stopping the timer ticks live; once an endTime exists
    // (stopping after the run already finished) prefer it.
    return { startTime, endTime: status === "stopping" ? run.endTime ?? now : now };
  }

  const endTime = run.endTime ?? fromLogs.end;
  return { startTime, endTime };
}

export function durationFromRunState(
  run: SubStepRunState | undefined,
  status: StepStatus,
  now = Date.now()
): number | null {
  const { startTime, endTime } = resolveRunBounds(run, status, now);
  if (!startTime || !endTime) return null;
  return Math.max(0, Math.floor((endTime - startTime) / 1000));
}

/**
 * The run row owns its own bounds, so `started_at` WINS over whatever startTime the
 * client is holding.
 *
 * It used to only fill a blank, and the value it deferred to could belong to a
 * PREVIOUS run of the same step: re-run a step, or reload the page while one is
 * running, and the client adopted the new run while keeping the old start — pairing
 * run #1's start with run #2's finish. A 41-second step read 42 minutes because its
 * first run had been 41 minutes earlier.
 */
export function startTimeFromRun(
  startedAtIso: string | null | undefined,
  fallback: number | null | undefined
): number | null {
  if (startedAtIso) {
    const t = new Date(startedAtIso).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return fallback ?? null;
}

/** Bounds a finished run implies, for steps that run as ONE process. Per-language and
 *  per-sub-step runs are excluded: they own their own rows, and their parent step spans
 *  the whole wave rather than any single row. Newest run per step wins (rows arrive
 *  newest-first), so a re-run replaces the previous reading instead of merging with it. */
export function plainStepBoundsFromRuns(
  runs: Array<{
    step_id: string;
    status: string;
    started_at?: string | null;
    finished_at?: string | null;
  }>
): Map<string, { startTime: number; endTime: number }> {
  const bounds = new Map<string, { startTime: number; endTime: number }>();
  for (const run of runs) {
    if (run.step_id.includes("__")) continue;
    if (run.status !== "completed" && run.status !== "failed") continue;
    if (bounds.has(run.step_id)) continue;
    const startTime = startTimeFromRun(run.started_at, null);
    const endTime = run.finished_at ? new Date(run.finished_at).getTime() : NaN;
    if (startTime === null || Number.isNaN(endTime) || endTime < startTime) continue;
    bounds.set(run.step_id, { startTime, endTime });
  }
  return bounds;
}

/** Backfill startTime when polling completes if the parallel-run race cleared it. */
export function mergeSubStepCompletion(
  prevRun: SubStepRunState,
  patch: Partial<SubStepRunState> & { startedAtIso?: string | null }
): SubStepRunState {
  const { startedAtIso, ...runPatch } = patch;
  const merged: SubStepRunState = { ...prevRun, ...runPatch };
  merged.startTime = startTimeFromRun(startedAtIso, merged.startTime);
  if (!merged.startTime && merged.logs?.length) {
    merged.startTime = boundsFromLogs(merged.logs).start;
  }
  return merged;
}

/** Sync in-flight run state while polling (startTime from DB, clear stale endTime). */
export function mergeRunProgress(
  prevRun: SubStepRunState,
  patch: Partial<SubStepRunState> & { startedAtIso?: string | null }
): SubStepRunState {
  const { startedAtIso, ...runPatch } = patch;
  const merged: SubStepRunState = { ...prevRun, ...runPatch };
  merged.startTime = startTimeFromRun(startedAtIso, merged.startTime);
  if (!merged.startTime && merged.logs?.length) {
    merged.startTime = boundsFromLogs(merged.logs).start;
  }
  if (merged.status === "running") {
    merged.endTime = null;
    merged.exitCode = null;
  }
  return merged;
}
