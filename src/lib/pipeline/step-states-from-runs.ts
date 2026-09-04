import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
import { effectiveStepStatus } from "@/lib/pipeline-orphan";
import type { StepId, StepState, StepStatus, SubStepRunState } from "@/types/pipeline";

/** The `pipeline_runs` columns a readiness decision needs. Logs are irrelevant. */
export interface RunRow {
  id?: string;
  stepId: string;
  status: string;
  exitCode: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const ms = (d: Date | null | undefined) => d?.getTime() ?? null;

/**
 * Build the `Map<StepId, StepState>` the pure decision helpers expect out of
 * `pipeline_runs` rows, so the server can reach the same verdict as the browser.
 *
 * Two rules are copied from the client and must stay copied, or the two will
 * disagree about what is complete:
 *  - a soft-orphaned run (failed with exit -2) still counts as RUNNING
 *    (`effectiveStepStatus`, mirroring `isRunStillInFlight` in the client's
 *    status poll) — the process may yet close and correct itself;
 *  - a `parent__child` key is routed by `parsePipelineRunStepKey`, which decides
 *    from the parent whether the suffix is a question sub-step or a language,
 *    rather than guessing from the suffix text.
 *
 * `logs` is always `[]`: log lines live in object storage and no readiness
 * decision reads them. Steps with no run row are ABSENT, not invented as
 * pending — the caller's workflow list says which steps should exist.
 */
export function stepStatesFromRuns(rows: RunRow[]): Map<StepId, StepState> {
  // Newest row wins per exact run key (a re-run replaces the previous reading).
  const newest = new Map<string, RunRow>();
  for (const row of rows) {
    const prev = newest.get(row.stepId);
    if (!prev || (ms(row.startedAt) ?? 0) >= (ms(prev.startedAt) ?? 0)) {
      newest.set(row.stepId, row);
    }
  }

  const states = new Map<StepId, StepState>();
  const ensure = (id: StepId): StepState => {
    let state = states.get(id);
    if (!state) {
      state = {
        id,
        status: "pending",
        logs: [],
        exitCode: null,
        startTime: null,
        endTime: null,
        enabledSubSteps: [],
        enabledLanguages: [],
        testcaseCount: 0,
      };
      states.set(id, state);
    }
    return state;
  };

  const toRun = (row: RunRow): SubStepRunState => ({
    status: effectiveStepStatus(row.status as StepStatus, row.exitCode),
    logs: [],
    exitCode: row.exitCode,
    startTime: ms(row.startedAt),
    endTime: ms(row.finishedAt),
    activeRunId: row.id ?? null,
  });

  for (const row of newest.values()) {
    const parsed = parsePipelineRunStepKey(row.stepId);
    const state = ensure(parsed.parentStepId);
    const run = toRun(row);

    if (parsed.subStepId) {
      state.subStepRuns = { ...state.subStepRuns, [parsed.subStepId]: run };
      continue;
    }
    if (parsed.langId) {
      state.languageSubRuns = { ...state.languageSubRuns, [parsed.langId]: run };
      continue;
    }

    state.status = run.status;
    state.exitCode = run.exitCode;
    state.startTime = run.startTime;
    state.endTime = run.endTime;
    state.activeRunId = run.activeRunId;
  }

  return states;
}
