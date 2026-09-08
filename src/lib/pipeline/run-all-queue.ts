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
  /**
   * Steps the user re-queued by name ("re-run affected"). They stay in the
   * queue even though their newest run reads `completed` — that completion is
   * the STALE one the user is asking to replace. The caller clears a step from
   * this set once it has been launched.
   */
  force?: Set<StepId>;
  /**
   * Failed runs per step SINCE THIS Run All started. A blocking step is retried
   * (that is the point of keeping it queued), but only up to
   * `MAX_STEP_ATTEMPTS` — without a cap, a step that fails every time is
   * re-launched by every advance forever, which on an LLM step burns real money
   * per lap. Absent = never counted, so callers that don't track attempts keep
   * the old unbounded behaviour.
   */
  attempts?: Map<StepId, number>;
  /** Seam for tests only. Production always uses the real step config. */
  stepConfig?: (stepId: StepId) => PipelineStepConfig;
}

/** Launches of one step per Run All before it is treated as terminally failed. */
export const MAX_STEP_ATTEMPTS = 2;

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
  // Mutable: a step we give up on is deleted, so its dependents below stop
  // seeing it as "queued, therefore still being retried" and drain too.
  const queued = new Set(queue);

  const questionPhaseComplete = isQuestionPhaseComplete(
    stepStates.get("generate_question"),
    input.questionType,
    input.gqContext,
    stepStates.get("generate_brute_force")
  );

  for (const id of queue) {
    const status = stepStates.get(id)?.status ?? "pending";
    // Drop steps that are done — unless the user named this one for a re-run,
    // in which case the `completed` on record is exactly the stale result being
    // replaced.
    if (status === "completed" && !input.force?.has(id)) continue;
    // Non-blocking steps (if any) are best-effort: once they've failed, drop
    // them from the queue instead of retrying, so Run All continues to the next
    // steps rather than looping on the failure.
    if (status === "failed" && config(id).nonBlocking) {
      queued.delete(id);
      continue;
    }
    // Out of attempts: this Run All has launched the step MAX_STEP_ATTEMPTS
    // times and it failed every time. Retrying again would just repeat the same
    // failure on the next advance, forever (generate_testcases looping on a
    // generator-script timeout cost ~$0.85 a lap). Drop it; the user re-runs it
    // by hand once the underlying cause is fixed.
    if (status === "failed" && (input.attempts?.get(id) ?? 0) >= MAX_STEP_ATTEMPTS) {
      queued.delete(id);
      continue;
    }

    // A running step is KEPT, where the client dropped it. The client dropped it
    // because its own await-loop drove the step to completion; the server has no
    // such loop, and a multi-process step (Generate Question's waves, the
    // per-language fan-out) reads `running` between waves and still has work to
    // launch. Dropping it here would abandon the step half-done.
    if (status === "running" || input.launching.has(id)) {
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
