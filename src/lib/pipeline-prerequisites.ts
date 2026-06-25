import { getStepConfig } from "@/lib/pipeline-config";
import type { StepId, StepState } from "@/types/pipeline";

/** Whether a tracked workflow step is done (GQ uses the phase gate, not parent status). */
export function isTrackedStepComplete(
  stepId: StepId,
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): boolean {
  if (stepId === "generate_question") return questionPhaseComplete;
  // Non-blocking steps (e.g. Strengthen Test Cases) never gate downstream work —
  // treat as satisfied regardless of their own pending/failed/completed status.
  if (getStepConfig(stepId).nonBlocking) return true;
  return stepStates.get(stepId)?.status === "completed";
}

/** Every workflow step strictly before `stepId` must be complete. */
export function arePriorWorkflowStepsComplete(
  stepId: StepId,
  workflowSteps: StepId[],
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): boolean {
  const index = workflowSteps.indexOf(stepId);
  if (index <= 0) return true;

  for (let i = 0; i < index; i++) {
    const prevId = workflowSteps[i];
    if (!isTrackedStepComplete(prevId, stepStates, questionPhaseComplete)) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a top-level pipeline step is unlocked (pending → can run).
 * Enrichment is special: only needs Generate Question complete.
 * Editorial/JSON steps honor explicit `prerequisite` in step config.
 * Everything else needs the full prior workflow chain.
 */
export function isWorkflowStepUnlocked(
  stepId: StepId,
  workflowSteps: StepId[],
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): boolean {
  if (stepId === "generate_enrichment") {
    return questionPhaseComplete;
  }

  const explicit = getStepConfig(stepId).prerequisite;
  if (explicit) {
    return isTrackedStepComplete(explicit, stepStates, questionPhaseComplete);
  }

  return arePriorWorkflowStepsComplete(
    stepId,
    workflowSteps,
    stepStates,
    questionPhaseComplete
  );
}

/** Per-language tile under split / execute. */
export function isLanguageSubStepUnlocked(
  parentStepId: StepId,
  langId: string,
  workflowSteps: StepId[],
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): boolean {
  if (
    !isWorkflowStepUnlocked(parentStepId, workflowSteps, stepStates, questionPhaseComplete)
  ) {
    return false;
  }

  if (
    parentStepId === "execute_tests_function" ||
    parentStepId === "execute_tests_nonfunction"
  ) {
    const splitRun = stepStates.get("split_code")?.languageSubRuns?.[langId];
    return splitRun?.status === "completed";
  }

  return true;
}

/** Inverse of unlock — used for lock UI and disabled Run buttons. */
export function isLanguageSubStepLocked(
  parentStepId: StepId,
  langId: string,
  workflowSteps: StepId[],
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): boolean {
  return !isLanguageSubStepUnlocked(
    parentStepId,
    langId,
    workflowSteps,
    stepStates,
    questionPhaseComplete
  );
}

export function isWorkflowStepLocked(
  stepId: StepId,
  workflowSteps: StepId[],
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): boolean {
  return !isWorkflowStepUnlocked(stepId, workflowSteps, stepStates, questionPhaseComplete);
}

export function getIncompletePrerequisites(
  stepId: StepId,
  workflowSteps: StepId[],
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): StepId[] {
  if (isWorkflowStepUnlocked(stepId, workflowSteps, stepStates, questionPhaseComplete)) {
    return [];
  }

  if (stepId === "generate_enrichment") {
    return questionPhaseComplete ? [] : ["generate_question"];
  }

  const explicit = getStepConfig(stepId).prerequisite;
  if (explicit) {
    return isTrackedStepComplete(explicit, stepStates, questionPhaseComplete) ? [] : [explicit];
  }

  const index = workflowSteps.indexOf(stepId);
  const out: StepId[] = [];
  for (let i = 0; i < index; i++) {
    const prevId = workflowSteps[i];
    if (!isTrackedStepComplete(prevId, stepStates, questionPhaseComplete)) {
      out.push(prevId);
    }
  }
  return out;
}

/** Run All: step is ready when unlocked and not already running/done. */
export function isStepReadyForRunAll(
  stepId: StepId,
  workflowSteps: StepId[],
  stepStates: Map<StepId, StepState>,
  questionPhaseComplete: boolean
): boolean {
  return isWorkflowStepUnlocked(stepId, workflowSteps, stepStates, questionPhaseComplete);
}
