import {
  isLanguageSubStepLocked,
  isWorkflowStepLocked,
} from "@/lib/pipeline-prerequisites";
import {
  canRunBruteForce,
  canRunQuestionSubStep,
  type GQSubStepContext,
} from "@/lib/pipeline-question";
import type { PipelineWaveItem } from "@/lib/pipeline-waves";
import type { QuestionSubStepId, QuestionType, StepId, StepState, StepStatus } from "@/types/pipeline";

export interface PipelineItemLockInput {
  item: PipelineWaveItem;
  status: StepStatus;
  questionType: QuestionType;
  questionPhaseComplete: boolean;
  gqState: StepState | undefined;
  stepStates: Map<StepId, StepState>;
  workflowSteps: StepId[];
  gqCtx?: GQSubStepContext;
}

/** Mirrors graph lock state: pending items blocked until prerequisites are met. */
export function isPipelineWaveItemLocked(input: PipelineItemLockInput): boolean {
  const {
    item,
    status,
    questionType,
    questionPhaseComplete,
    gqState,
    stepStates,
    workflowSteps,
    gqCtx,
  } = input;

  if (status !== "pending") return false;

  if (item.kind === "sub") {
    if (!gqState) return true;
    return !canRunQuestionSubStep(item.id as QuestionSubStepId, gqState, questionType, gqCtx);
  }

  const stepId =
    item.kind === "lang" && item.parentStepId ? item.parentStepId : (item.id as StepId);

  if (stepId === "generate_brute_force") {
    if (!gqState) return true;
    return !canRunBruteForce(gqState, questionType);
  }

  if (item.kind === "lang" && item.parentStepId && item.langId) {
    return isLanguageSubStepLocked(
      item.parentStepId,
      item.langId,
      workflowSteps,
      stepStates,
      questionPhaseComplete
    );
  }

  return isWorkflowStepLocked(stepId, workflowSteps, stepStates, questionPhaseComplete);
}
