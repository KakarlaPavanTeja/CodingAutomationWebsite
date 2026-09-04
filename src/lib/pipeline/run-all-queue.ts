import { getStepConfig, getWorkflowSteps } from "@/lib/pipeline-config";
import {
  getIncompletePrerequisites,
  isStepReadyForRunAll,
} from "@/lib/pipeline-prerequisites";
import { isQuestionPhaseComplete, type GQSubStepContext } from "@/lib/pipeline-question";
import type {
  PipelineMode,
  PipelineStepConfig,
  QuestionType,
  StepId,
  StepState,
} from "@/types/pipeline";

export interface QueueInput {
  queue: StepId[];
  stepStates: Map<StepId, StepState>;
  questionType: QuestionType;
  mode: PipelineMode;
  /** Steps the caller has already spawned in this pass — the server's `launchingStepsRef`. */
  launching: Set<StepId>;
  /** Global config the GQ phase gate needs; without it GQ can never read complete. */
  gqContext?: GQSubStepContext;
  /** Seam for tests only. Production always uses the real step config. */
  stepConfig?: (stepId: StepId) => PipelineStepConfig;
}

export interface QueueDecision {
  launch: StepId[];
  remaining: StepId[];
}

/**
 * The Run All driver, lifted verbatim in behaviour out of the client effect that
 * used to own it (`pipeline-context.tsx`). Scan the whole queue and launch every
 * step whose prerequisite has completed and that isn't already running. Steps
 * still waiting on a prerequisite that is running, queued ahead, or being
 * retried by this same Run All stay queued; steps whose prerequisite has truly
 * failed (and is not being retried) are dropped so the queue always drains.
 *
 * The one adaptation for the server: a queued step with NO `pipeline_runs` row
 * is PENDING, not missing. The client always held a state entry for every
 * tracked step, so `!state` meant "not in this workflow"; here it just means
 * "has never run", which is exactly the case Run All starts from.
 */
export function decideQueue(input: QueueInput): QueueDecision {
  const config = input.stepConfig ?? getStepConfig;
  const { stepStates, queue } = input;
  const steps = getWorkflowSteps(input.questionType, input.mode);

  const launch: StepId[] = [];
  const remaining: StepId[] = [];
  // Steps that are kept (waiting) or launched — used to decide whether a
  // pending prerequisite is still going to run or was already dropped.
  const alive = new Set<StepId>();
  const queued = new Set(queue);

  const questionPhaseComplete = isQuestionPhaseComplete(
    stepStates.get("generate_question"),
    input.questionType,
    input.gqContext,
    stepStates.get("generate_brute_force")
  );

  for (const id of queue) {
    const status = stepStates.get(id)?.status ?? "pending";
    // Drop steps that are done or already executing.
    if (status === "completed" || status === "running") continue;
    // Non-blocking steps (if any) are best-effort: once they've failed, drop
    // them from the queue instead of retrying, so Run All continues to the next
    // steps rather than looping on the failure.
    if (status === "failed" && config(id).nonBlocking) continue;

    if (input.launching.has(id)) {
      remaining.push(id);
      alive.add(id);
      continue;
    }

    if (!isStepReadyForRunAll(id, steps, stepStates, questionPhaseComplete)) {
      const blocking = getIncompletePrerequisites(id, steps, stepStates, questionPhaseComplete);
      // Only DROP a queued step if a prerequisite has terminally failed/stopped
      // and is NOT being retried. Count any prerequisite still on this Run All
      // queue as "being retried" even before it is processed in this pass —
      // otherwise a downstream step could be dropped while its failed upstream
      // is still queued to run, stalling the whole chain on a second Run All.
      const anyBlockingDead = blocking.some((b) => {
        const st = stepStates.get(b)?.status;
        const beingRetried =
          alive.has(b) || queued.has(b) || input.launching.has(b) || st === "running";
        return (st === "failed" || st === "stopped" || st === "skipped") && !beingRetried;
      });
      if (!anyBlockingDead) {
        remaining.push(id);
        alive.add(id);
      }
      continue;
    }

    launch.push(id);
    alive.add(id);
  }

  return { launch, remaining };
}
