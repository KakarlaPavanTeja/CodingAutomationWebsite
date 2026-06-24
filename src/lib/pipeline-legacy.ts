import type { QuestionSubStepId, QuestionType, StepId, StepState, StepStatus, SubStepRunState } from "@/types/pipeline";
import {
  createEmptySubStepRun,
  getQuestionSubStepsForType,
  recomputeGenerateQuestionStatus,
} from "@/lib/pipeline-question";

/** Output artifacts that indicate a sub-step completed (paths relative to outputs/). */
const SUB_STEP_OUTPUT_MARKERS: Record<QuestionSubStepId, string[]> = {
  description: ["generated_description.md"],
  naming: ["description_signature.json", "normalized_source.py", "normalized_source.cpp", "normalized_source.java", "normalized_source.js"],
  titles: ["generated_titles.txt"],
  difficulty: ["generated_difficulty.txt"],
  topics: ["generated_topics.json"],
  translate_cpp: ["generatedFullCode/CPP.cpp"],
  translate_java: ["generatedFullCode/JAVA.java"],
  translate_nodejs: ["generatedFullCode/NODEJS.js"],
};

export type WaveVisualStatus = "blocked" | "ready" | "running" | "completed" | "failed" | "partial";

export interface LegacyReconcileResult {
  state: StepState;
  wasLegacy: boolean;
  inferredSubSteps: QuestionSubStepId[];
  message: string | null;
}

function pathSetHas(paths: Set<string>, markers: string[]): boolean {
  for (const marker of markers) {
    if (paths.has(marker)) return true;
    for (const p of paths) {
      if (p.endsWith(`/${marker}`) || p === marker) return true;
    }
  }
  return false;
}

export function inferSubStepsFromOutputPaths(
  outputPaths: string[],
  questionType: QuestionType
): QuestionSubStepId[] {
  const paths = new Set(outputPaths.map((p) => p.replace(/^Outputs\//, "")));
  const applicable = getQuestionSubStepsForType(questionType);
  return applicable.filter((id) => pathSetHas(paths, SUB_STEP_OUTPUT_MARKERS[id]));
}

function markSubStepCompleted(
  runs: NonNullable<StepState["subStepRuns"]>,
  subId: QuestionSubStepId,
  parentStart: number | null,
  parentEnd: number | null
): void {
  runs[subId] = {
    ...(runs[subId] ?? createEmptySubStepRun()),
    status: "completed",
    exitCode: 0,
    startTime: parentStart,
    endTime: parentEnd ?? parentStart ?? Date.now(),
  };
}

/**
 * Backfill sub-step status for problems run before the wave UI existed.
 * Uses saved parent status, downstream progress, and output file artifacts.
 */
export function reconcileLegacyGenerateQuestion(
  gq: StepState,
  questionType: QuestionType,
  savedParent: { status?: string; startTime?: number | null; endTime?: number | null },
  outputPaths: string[],
  downstreamHasProgress: boolean
): LegacyReconcileResult {
  const runs = { ...(gq.subStepRuns ?? {}) } as NonNullable<StepState["subStepRuns"]>;

  // Only OLD, monolithic runs (no per-sub-step tracking) need output-based
  // backfill. If any sub-step already has real execution evidence (a startTime
  // or an activeRunId), this is a new-format run — never treat it as "legacy",
  // even mid-run when saved state momentarily lags the produced output files.
  const hasNewFormatTracking = Object.values(runs).some(
    (r) => r != null && (r.startTime != null || r.activeRunId != null || r.endTime != null)
  );
  if (hasNewFormatTracking) {
    return { state: gq, wasLegacy: false, inferredSubSteps: [], message: null };
  }

  const applicable = getQuestionSubStepsForType(questionType);
  const enabled = applicable.filter((id) => gq.enabledSubSteps.includes(id));
  const inferred = inferSubStepsFromOutputPaths(outputPaths, questionType);

  const pendingEnabled = enabled.filter((id) => runs[id]?.status !== "completed");
  const parentWasCompleted = savedParent.status === "completed";
  const needsReconcile =
    pendingEnabled.length > 0 &&
    (parentWasCompleted || downstreamHasProgress || inferred.length > 0);

  if (!needsReconcile) {
    return { state: gq, wasLegacy: false, inferredSubSteps: [], message: null };
  }

  const parentStart = savedParent.startTime ?? gq.startTime;
  const parentEnd = savedParent.endTime ?? gq.endTime ?? Date.now();
  const applied = new Set<QuestionSubStepId>();

  for (const subId of inferred) {
    if (!enabled.includes(subId)) continue;
    if (runs[subId]?.status === "completed") continue;
    markSubStepCompleted(runs, subId, parentStart, parentEnd);
    applied.add(subId);
  }

  // Monolithic legacy run: parent marked complete but no per-sub-step records
  if (parentWasCompleted && applied.size < pendingEnabled.length) {
    for (const subId of enabled) {
      if (runs[subId]?.status === "completed") continue;
      markSubStepCompleted(runs, subId, parentStart, parentEnd);
      applied.add(subId);
    }
  }

  // Downstream ran but outputs sparse — infer from enabled list if description exists
  if (
    !parentWasCompleted &&
    downstreamHasProgress &&
    inferred.includes("description") &&
    applied.size > 0
  ) {
    for (const subId of enabled) {
      if (runs[subId]?.status === "completed") continue;
      if (inferred.includes(subId)) continue;
      // Only infer metadata/translations if description artifact exists and downstream progressed
      markSubStepCompleted(runs, subId, parentStart, parentEnd);
      applied.add(subId);
    }
  }

  if (applied.size === 0) {
    return { state: gq, wasLegacy: false, inferredSubSteps: [], message: null };
  }

  const updated: StepState = {
    ...gq,
    subStepRuns: runs,
    ...recomputeGenerateQuestionStatus({ ...gq, subStepRuns: runs }, questionType),
    startTime: gq.startTime ?? parentStart,
    endTime: gq.endTime ?? parentEnd,
  };

  return {
    state: updated,
    wasLegacy: true,
    inferredSubSteps: [...applied],
    message:
      "This problem was processed with an older pipeline layout. Sub-step status was restored from saved outputs.",
  };
}

export function aggregateWaveStatus(
  statuses: StepStatus[],
  prevWaveComplete: boolean
): WaveVisualStatus {
  if (!prevWaveComplete && statuses.every((s) => s === "pending")) return "blocked";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.length > 0 && statuses.every((s) => s === "completed")) return "completed";
  if (statuses.some((s) => s === "completed")) return "partial";
  if (prevWaveComplete) return "ready";
  return "blocked";
}

export function downstreamHasProgress(
  stepStates: Map<StepId, StepState>,
  workflowSteps: StepId[]
): boolean {
  const afterGq = workflowSteps.filter((id) => id !== "generate_question");
  return afterGq.some((id) => {
    const s = stepStates.get(id)?.status;
    return s === "completed" || s === "failed" || s === "running";
  });
}
