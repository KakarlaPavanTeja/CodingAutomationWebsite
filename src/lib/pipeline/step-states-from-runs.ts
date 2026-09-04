import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
import { effectiveStepStatus } from "@/lib/pipeline-orphan";
import {
  getLangsForStep,
  PARALLEL_LANG_STEPS,
  recomputeLanguageStepStatus,
} from "@/lib/pipeline-language-steps";
import {
  deriveEnabledQuestionSubSteps,
  recomputeGenerateQuestionStatus,
  shouldRunTitlesLlm,
  type GQSubStepContext,
} from "@/lib/pipeline-question";
import type {
  QuestionType,
  StepId,
  StepState,
  StepStatus,
  SubStepRunState,
} from "@/types/pipeline";

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

/**
 * Fill in the parent status of steps that run as SEVERAL processes.
 *
 * `generate_question` and the per-language steps have no top-level run row of
 * their own — the client recomputes their status from the sub-runs and persists
 * that. The server has to do the same recompute, with the same two functions, or
 * a half-finished Generate Question reads as `pending` and Run All relaunches it.
 *
 * Mutates and returns the map it is given.
 */
export function deriveParentStatuses(
  states: Map<StepId, StepState>,
  opts: { questionType: QuestionType; gqContext: GQSubStepContext; languages: string[] }
): Map<StepId, StepState> {
  const gq = states.get("generate_question");
  if (gq?.subStepRuns) {
    gq.enabledSubSteps = deriveEnabledQuestionSubSteps(opts.gqContext);
    // With the AI title toggle off, Titles never spawns: the client marks it
    // `skipped` in place. `pipeline_runs.status` only allows running/completed/
    // failed, so there is no row to read that back from — synthesize the same
    // skipped run here, or Generate Question waits forever for a step that will
    // never produce one.
    if (!shouldRunTitlesLlm(opts.gqContext) && !gq.subStepRuns.titles) {
      gq.subStepRuns = {
        ...gq.subStepRuns,
        titles: { status: "skipped", logs: [], exitCode: 0, startTime: null, endTime: null },
      };
    }
    Object.assign(gq, recomputeGenerateQuestionStatus(gq, opts.questionType, opts.gqContext));
  }

  for (const id of PARALLEL_LANG_STEPS) {
    const state = states.get(id);
    if (!state?.languageSubRuns) continue;
    const langs = getLangsForStep(id, opts.languages);
    state.enabledLanguages = langs;
    Object.assign(state, recomputeLanguageStepStatus(state, langs));
  }

  return states;
}
