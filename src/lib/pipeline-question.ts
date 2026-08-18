import type {
  PipelineMode,
  QuestionSubStepId,
  QuestionType,
  StepState,
  StepStatus,
  SubStepRunState,
} from "@/types/pipeline";
import { getTranslateSubStepsForLanguages } from "@/lib/pipeline-language-steps";

export interface GQSubStepContext {
  questionType: QuestionType;
  mode: PipelineMode;
  languages: string[];
  generateTitleWithAi: boolean;
  ownerTitle: string;
  ownerDifficulty: string;
}

export function subStepLogKey(subStepId: QuestionSubStepId): string {
  return `generate_question__${subStepId}`;
}

export function getQuestionSubStepsForType(questionType: QuestionType): QuestionSubStepId[] {
  const base: QuestionSubStepId[] = [
    "description",
    "naming",
    "titles",
    "difficulty",
    "topics",
    "translate_cpp",
    "translate_java",
    "translate_nodejs",
  ];
  if (questionType === "nonfunction") {
    return base.filter((id) => id !== "naming");
  }
  return base;
}

/** Derive which GQ sub-steps run — fixed by variant + languages + owner overrides. */
export function getApplicableGQSubSteps(ctx: GQSubStepContext): QuestionSubStepId[] {
  const applicable = getQuestionSubStepsForType(ctx.questionType);
  const result: QuestionSubStepId[] = [];

  for (const id of applicable) {
    if (id === "topics" && ctx.mode === "exam") continue;
    if (id.startsWith("translate_")) {
      const langSubSteps = getTranslateSubStepsForLanguages(ctx.languages);
      if (!langSubSteps.includes(id)) continue;
    }
    if (id === "titles") {
      // Always in graph; LLM only when AI choice enabled and no saved manual title
      result.push(id);
      continue;
    }
    result.push(id);
  }
  return result;
}

/** Sub-steps that must complete (LLM may be skipped for titles/difficulty). */
export function getRequiredGQSubSteps(ctx: GQSubStepContext): QuestionSubStepId[] {
  return getApplicableGQSubSteps(ctx).filter((id) => {
    if (id === "titles") {
      if (ctx.generateTitleWithAi) return true;
      if (ctx.ownerTitle.trim()) return false;
      return true;
    }
    return true;
  });
}

export function shouldRunTitlesLlm(ctx: GQSubStepContext): boolean {
  return ctx.generateTitleWithAi;
}

export function getSubStepDisplayStatus(
  subStepId: QuestionSubStepId,
  run: SubStepRunState | undefined,
  ctx: GQSubStepContext
): StepStatus {
  if (subStepId === "titles" && !shouldRunTitlesLlm(ctx) && ctx.ownerTitle.trim()) {
    return "skipped";
  }
  if (subStepId === "difficulty" && !shouldRunDifficultyLlm(ctx.ownerDifficulty)) {
    return run?.status === "completed" || run?.status === "failed" ? run.status : "skipped";
  }
  return run?.status ?? "pending";
}

export function shouldRunDifficultyLlm(ownerDifficulty: string): boolean {
  const d = ownerDifficulty.trim().toLowerCase();
  return d !== "easy" && d !== "medium" && d !== "hard";
}

export function getQuestionSubStepPrerequisite(
  subStepId: QuestionSubStepId,
  questionType: QuestionType
): QuestionSubStepId | null {
  if (subStepId === "description") return null;
  if (subStepId === "naming") return "description";
  if (subStepId === "titles" || subStepId === "difficulty" || subStepId === "topics") {
    return "description";
  }
  if (
    subStepId === "translate_cpp" ||
    subStepId === "translate_java" ||
    subStepId === "translate_nodejs"
  ) {
    return questionType === "function" ? "naming" : "description";
  }
  return null;
}

/** Waves of substeps that can execute in parallel within each wave. */
export function getQuestionSubStepWaves(
  questionType: QuestionType,
  enabledSubSteps: string[]
): QuestionSubStepId[][] {
  const enabled = new Set(enabledSubSteps);
  const applicable = new Set(getQuestionSubStepsForType(questionType));
  const incl = (id: QuestionSubStepId) => enabled.has(id) && applicable.has(id);

  if (questionType === "function") {
    const waves: QuestionSubStepId[][] = [];
    if (incl("description")) waves.push(["description"]);
    // Naming runs ALONE. Every sub-step gets its own temp workspace hydrated from
    // storage, and naming is the only one that rewrites generatedFullCode/PYTHON.py —
    // so a sibling running beside it holds the pre-naming copy and re-uploads it,
    // silently reverting the normalization. description_signature.json survives
    // (nobody else has that file), leaving a signature that names `findPairs` next to
    // code that still has the old name. Worse, the stdin and checker gates in
    // run_naming_step pass on the code that then gets discarded, so what actually
    // ships was never gated at all.
    if (incl("naming")) waves.push(["naming"]);
    const wave1 = (["titles", "difficulty", "topics"] as QuestionSubStepId[]).filter(incl);
    if (wave1.length) waves.push(wave1);
    const wave2 = (["translate_cpp", "translate_java", "translate_nodejs"] as QuestionSubStepId[]).filter(
      incl
    );
    if (wave2.length) waves.push(wave2);
    return waves;
  }

  const waves: QuestionSubStepId[][] = [];
  if (incl("description")) waves.push(["description"]);
  const wave1 = (["titles", "difficulty", "topics"] as QuestionSubStepId[]).filter(incl);
  if (wave1.length) waves.push(wave1);
  const wave2 = (["translate_cpp", "translate_java", "translate_nodejs"] as QuestionSubStepId[]).filter(
    incl
  );
  if (wave2.length) waves.push(wave2);
  return waves;
}

export function createEmptySubStepRun(): SubStepRunState {
  return {
    status: "pending",
    logs: [],
    exitCode: null,
    startTime: null,
    endTime: null,
  };
}

export function recomputeGenerateQuestionStatus(
  state: StepState,
  questionType: QuestionType,
  ctx?: GQSubStepContext
): Pick<StepState, "status" | "startTime" | "endTime" | "exitCode"> {
  const required = ctx
    ? getRequiredGQSubSteps(ctx)
    : getQuestionSubStepsForType(questionType).filter((id) => state.enabledSubSteps.includes(id));

  if (required.length === 0) {
    return { status: "pending", startTime: null, endTime: null, exitCode: null };
  }

  const runs = state.subStepRuns ?? {};
  const statuses = required.map((id) => {
    const run = runs[id];
    if (id === "titles" && ctx && !ctx.generateTitleWithAi && ctx.ownerTitle.trim()) {
      return run?.status === "completed" ? "completed" : "skipped";
    }
    if (id === "difficulty" && ctx && !shouldRunDifficultyLlm(ctx.ownerDifficulty)) {
      return run?.status === "completed" || run?.status === "failed" ? run.status : "skipped";
    }
    return run?.status ?? "pending";
  });

  if (statuses.every((s) => s === "completed" || s === "skipped")) {
    const ends = required.map((id) => runs[id]?.endTime).filter((t): t is number => t != null);
    const starts = required.map((id) => runs[id]?.startTime).filter((t): t is number => t != null);
    return {
      status: "completed",
      startTime: starts.length ? Math.min(...starts) : state.startTime,
      // Prefer child end times; otherwise reuse the already-stored end time so a
      // completed step's duration stays stable across recomputes instead of
      // creeping up by Date.now() on every poll (P1-M4 / timer bug #1).
      endTime: ends.length ? Math.max(...ends) : state.endTime ?? Date.now(),
      exitCode: 0,
    };
  }
  if (statuses.some((s) => s === "failed")) {
    const starts = required.map((id) => runs[id]?.startTime).filter((t): t is number => t != null);
    const ends = required.map((id) => runs[id]?.endTime).filter((t): t is number => t != null);
    return {
      status: "failed",
      exitCode: 1,
      startTime: starts.length ? Math.min(...starts) : state.startTime,
      endTime: ends.length ? Math.max(...ends) : state.endTime ?? Date.now(),
    };
  }
  if (statuses.some((s) => s === "running")) {
    const starts = required.map((id) => runs[id]?.startTime).filter((t): t is number => t != null);
    return {
      status: "running",
      startTime: starts.length ? Math.min(...starts) : state.startTime ?? Date.now(),
      endTime: null,
      exitCode: null,
    };
  }
  return { status: "pending", startTime: null, endTime: null, exitCode: null };
}

export function isGenerateQuestionComplete(
  state: StepState,
  questionType: QuestionType,
  ctx?: GQSubStepContext
): boolean {
  return recomputeGenerateQuestionStatus(state, questionType, ctx).status === "completed";
}

export function canRunQuestionSubStep(
  subStepId: QuestionSubStepId,
  state: StepState,
  questionType: QuestionType,
  ctx?: GQSubStepContext
): boolean {
  const run = state.subStepRuns?.[subStepId];
  if (run?.status === "running") return false;

  if (subStepId === "titles" && ctx && !shouldRunTitlesLlm(ctx) && ctx.ownerTitle.trim()) {
    return false;
  }

  const prereq = getQuestionSubStepPrerequisite(subStepId, questionType);
  if (!prereq) return true;
  return state.subStepRuns?.[prereq]?.status === "completed";
}

/** True if `ancestor` sits anywhere on `node`'s prerequisite chain. */
function isPrereqAncestor(
  ancestor: QuestionSubStepId,
  node: QuestionSubStepId,
  questionType: QuestionType
): boolean {
  let cur = getQuestionSubStepPrerequisite(node, questionType);
  while (cur) {
    if (cur === ancestor) return true;
    cur = getQuestionSubStepPrerequisite(cur, questionType);
  }
  return false;
}

/**
 * What becomes STALE when `subStepId` is (re-)run: every sub-step whose
 * prerequisite chain passes through it, plus the brute-force step when its
 * prerequisite (naming for function, description otherwise) is affected.
 * Used to reset downstream work back to pending so it re-locks instead of
 * showing a "completed" badge against an outdated upstream.
 */
export function getQuestionSubStepDependents(
  subStepId: QuestionSubStepId,
  questionType: QuestionType
): { subSteps: QuestionSubStepId[]; bruteForce: boolean } {
  const all = getQuestionSubStepsForType(questionType);
  const subSteps = all.filter(
    (id) => id !== subStepId && isPrereqAncestor(subStepId, id, questionType)
  );
  const bfPrereq: QuestionSubStepId = questionType === "function" ? "naming" : "description";
  const bruteForce =
    subStepId === bfPrereq || isPrereqAncestor(subStepId, bfPrereq, questionType);
  return { subSteps, bruteForce };
}

/** Brute force runs in parallel with translations once naming (function) or description is done. */
export function canRunBruteForce(state: StepState, questionType: QuestionType): boolean {
  const prereq: QuestionSubStepId = questionType === "function" ? "naming" : "description";
  return state.subStepRuns?.[prereq]?.status === "completed";
}

/**
 * GQ complete for downstream gates. Brute force runs in the same wave as the
 * translate sub-steps, but the phase used to flip to complete the moment the
 * last translation landed — so generate_testcases launched while BF was still
 * in flight, found no brute force file, and silently degraded to SINGLE-ORACLE
 * mode. An IN-FLIGHT brute force therefore holds the phase open.
 *
 * Only "running" blocks, never "pending": a pending BF that nobody will launch
 * (legacy problems predating the step) would stall Run All forever, and those
 * problems already degrade to SINGLE-ORACLE by design.
 */
export function isQuestionPhaseComplete(
  gqState: StepState | undefined,
  questionType: QuestionType,
  ctx?: GQSubStepContext,
  bruteForceState?: StepState
): boolean {
  if (!gqState) return false;
  if (bruteForceState?.status === "running") return false;
  return isGenerateQuestionComplete(gqState, questionType, ctx);
}

/** Build derived enabledSubSteps from global config — replaces user toggles. */
export function deriveEnabledQuestionSubSteps(ctx: GQSubStepContext): string[] {
  return getApplicableGQSubSteps(ctx);
}

/** Restore default sub-steps when saved config looks like a legacy monolithic run. */
export function normalizeEnabledQuestionSubSteps(
  questionType: QuestionType,
  saved: string[] | undefined,
  derived: string[]
): string[] {
  const applicable = getQuestionSubStepsForType(questionType);
  const base = (saved ?? derived).filter((id) => applicable.includes(id as QuestionSubStepId));
  if (base.length >= derived.length - 1) return derived;
  return derived;
}
