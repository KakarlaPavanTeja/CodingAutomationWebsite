import { getStepConfig } from "@/lib/pipeline-config";
import {
  getLangsForStep,
  PARALLEL_LANG_STEPS,
  languageSubStepLogKey,
} from "@/lib/pipeline-language-steps";
import {
  canRunBruteForce,
  deriveEnabledQuestionSubSteps,
  getQuestionSubStepWaves,
  shouldRunTitlesLlm,
  type GQSubStepContext,
} from "@/lib/pipeline-question";
import type { QuestionSubStepId, QuestionType, StepId, StepState } from "@/types/pipeline";

/** One `startStep` call: exactly one Python process. */
export interface SpawnRequest {
  stepId: StepId;
  subSteps: string[];
  languages: string[];
  /** Composite `pipeline_runs.step_id`; absent for a plain single-process step. */
  runKey?: string;
}

export interface LaunchPlanOptions {
  questionType: QuestionType;
  gqContext: GQSubStepContext;
  languages: string[];
  /** `pipeline_states.step_configs`, for a step's saved sub-step selection. */
  stepConfigs?: Record<string, { enabledSubSteps?: string[] } | undefined>;
}

const DONE = new Set(["completed", "skipped"]);

function enabledSubStepsFor(
  stepId: StepId,
  stepConfigs: LaunchPlanOptions["stepConfigs"]
): string[] {
  const saved = stepConfigs?.[stepId]?.enabledSubSteps;
  if (Array.isArray(saved)) return saved;
  return getStepConfig(stepId)
    .subSteps.filter((s) => s.defaultEnabled)
    .map((s) => s.id);
}

/**
 * Which processes a queued step needs started RIGHT NOW.
 *
 * The client drove multi-process steps with an await-loop: Generate Question ran
 * wave by wave, the language steps fanned out and waited. The server has no loop
 * — every child's `close` handler re-enters `advanceQueue`, which calls this
 * again — so the waves emerge from repeated planning instead of being awaited.
 * Anything already running is never re-launched.
 */
export function planLaunches(
  stepId: StepId,
  stepStates: Map<StepId, StepState>,
  opts: LaunchPlanOptions
): SpawnRequest[] {
  if (stepId === "generate_question") return planQuestion(stepStates, opts);

  if (PARALLEL_LANG_STEPS.includes(stepId)) {
    const state = stepStates.get(stepId);
    return getLangsForStep(stepId, opts.languages)
      .filter((lang) => {
        const run = state?.languageSubRuns?.[lang];
        return !run || (!DONE.has(run.status) && run.status !== "running");
      })
      .map((lang) => ({
        stepId,
        subSteps: [],
        languages: [lang],
        runKey: languageSubStepLogKey(stepId, lang),
      }));
  }

  return [
    {
      stepId,
      subSteps: enabledSubStepsFor(stepId, opts.stepConfigs),
      languages: opts.languages,
    },
  ];
}

function planQuestion(
  stepStates: Map<StepId, StepState>,
  opts: LaunchPlanOptions
): SpawnRequest[] {
  const gq = stepStates.get("generate_question");
  const runs = gq?.subStepRuns ?? {};
  const settled = (id: QuestionSubStepId) => {
    // Titles without the AI toggle never spawns — the client marks it skipped
    // outright, so treat it as settled rather than waiting for a run that the
    // pipeline will never produce.
    if (id === "titles" && !shouldRunTitlesLlm(opts.gqContext)) return true;
    return DONE.has(runs[id]?.status ?? "pending");
  };

  // Derived from the global config, not from `gq.enabledSubSteps`: on a fresh
  // problem there is no run row and therefore no state entry to read it from.
  const waves = getQuestionSubStepWaves(
    opts.questionType,
    deriveEnabledQuestionSubSteps(opts.gqContext)
  );
  // The first wave that is not fully settled is the only one that may start.
  // Waves are NOT collapsed into "everything whose prerequisite is done":
  // `naming` must run alone — a sibling beside it holds the pre-naming
  // PYTHON.py and re-uploads it, silently reverting the normalization.
  const wave = waves.find((w) => w.some((id) => !settled(id)));
  const out: SpawnRequest[] = [];

  if (wave) {
    for (const id of wave) {
      if (settled(id) || runs[id]?.status === "running") continue;
      out.push({ stepId: "generate_question", subSteps: [id], languages: opts.languages });
    }
  }

  // Brute force runs CONCURRENTLY with the translation wave, and the question
  // phase stays open until it finishes (an in-flight brute force otherwise lets
  // generate_testcases start and silently degrade to single-oracle mode).
  const isCodeWave = wave?.some((id) => id.startsWith("translate_")) ?? false;
  const bf = stepStates.get("generate_brute_force");
  if (
    isCodeWave &&
    gq &&
    bf?.status !== "completed" &&
    bf?.status !== "running" &&
    canRunBruteForce(gq, opts.questionType)
  ) {
    out.push({ stepId: "generate_brute_force", subSteps: [], languages: opts.languages });
  }

  return out;
}
