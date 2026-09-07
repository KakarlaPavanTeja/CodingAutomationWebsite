import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineStates } from "@/lib/db/schema";
import { startStep as realStartStep, setOnStepClosed } from "@/app/api/pipeline/run/start-step";
import type { StartStepArgs, StartStepResult } from "@/app/api/pipeline/run/start-step";
import { LANGUAGES } from "@/lib/pipeline-config";
import { decideQueue } from "./run-all-queue";
import { planLaunches } from "./launch-plan";
import { deriveParentStatuses, stepStatesFromRuns, type RunRow } from "./step-states-from-runs";
import {
  clearQueue as realClearQueue,
  readQueue as realReadQueue,
  writeQueue as realWriteQueue,
  type StoredQueue,
} from "./queue-store";
import type { StepId } from "@/types/pipeline";

/** What a launch needs that the queue itself does not carry. */
export interface QueueContext {
  /** Owner of the run rows the orchestrator creates — `pipeline_runs.user_id` is NOT NULL. */
  userId: string;
  languages: string[];
  stepConfigs: Record<string, { enabledSubSteps?: string[] } | undefined>;
}

export interface AdvanceDeps {
  readQueue: (problemId: string) => Promise<StoredQueue | null>;
  writeQueue: (problemId: string, queue: StoredQueue) => Promise<void>;
  clearQueue: (problemId: string) => Promise<void>;
  readRuns: (problemId: string) => Promise<RunRow[]>;
  readContext: (problemId: string) => Promise<QueueContext | null>;
  startStep: (args: StartStepArgs) => Promise<StartStepResult>;
}

async function readRuns(problemId: string): Promise<RunRow[]> {
  return db
    .select({
      id: pipelineRuns.id,
      stepId: pipelineRuns.stepId,
      status: pipelineRuns.status,
      exitCode: pipelineRuns.exitCode,
      startedAt: pipelineRuns.startedAt,
      finishedAt: pipelineRuns.finishedAt,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.problemId, problemId));
}

async function readContext(problemId: string): Promise<QueueContext | null> {
  const rows = await db
    .select({
      userId: pipelineStates.userId,
      enabledLanguages: pipelineStates.enabledLanguages,
      stepConfigs: pipelineStates.stepConfigs,
    })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, problemId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    languages:
      row.enabledLanguages ?? LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id),
    stepConfigs: (row.stepConfigs as QueueContext["stepConfigs"]) ?? {},
  };
}

const defaultDeps: AdvanceDeps = {
  readQueue: realReadQueue,
  writeQueue: realWriteQueue,
  clearQueue: realClearQueue,
  readRuns,
  readContext,
  startStep: realStartStep,
};

// ponytail: in-process per-problem lock, upgrade to a `SELECT … FOR UPDATE` on
// the pipeline_states row if this app is ever run as more than one Node process.
//
// Two steps finishing at the same instant both call advanceQueue. Without this
// they interleave — both read the same queue, both decide to launch the same
// ready step, and it spawns twice. Chaining every advance for a problem onto
// the previous one makes read-decide-write atomic *within this process*. It is
// NOT a distributed lock: a second server instance against the same database
// would not see this map.
const chains = new Map<string, Promise<unknown>>();

function serialise<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow on the stored link only: a rejected advance must not poison the
  // next one, but the caller still sees its own rejection through `next`.
  const link = next.then(
    () => {},
    () => {}
  );
  chains.set(key, link);
  void link.then(() => {
    if (chains.get(key) === link) chains.delete(key);
  });
  return next;
}

export interface AdvanceResult {
  launched: StepId[];
  remaining: StepId[];
}

/**
 * Move a problem's server-owned Run All forward by one pass: read the persisted
 * queue, rebuild step states from `pipeline_runs`, ask `decideQueue` what may
 * start, and spawn it.
 *
 * Called from the `close` handler of every step this orchestrator starts, so the
 * queue advances with no browser attached — which is the whole point of moving
 * it off the client.
 */
export async function advanceQueue(
  problemId: string,
  deps: AdvanceDeps = defaultDeps
): Promise<AdvanceResult> {
  return serialise(problemId, async () => {
    const queue = await deps.readQueue(problemId);
    if (!queue) return { launched: [], remaining: [] };

    const context = await deps.readContext(problemId);
    // No pipeline_states row means no user to attribute runs to. Leave the queue
    // alone rather than clearing it — the row may simply not have been written
    // yet, and dropping the queue here would silently abandon the run.
    if (!context) return { launched: [], remaining: queue.steps };

    const stepStates = deriveParentStatuses(stepStatesFromRuns(await deps.readRuns(problemId)), {
      questionType: queue.questionType,
      gqContext: queue.gqContext,
      languages: context.languages,
    });

    const decision = decideQueue({
      queue: queue.steps,
      stepStates,
      questionType: queue.questionType,
      mode: queue.mode,
      // Empty by design: this whole body holds the per-problem lock, so nothing
      // else in this process is mid-launch. The client needed a `launchingRef`
      // because its effect could re-enter across an async gap.
      launching: new Set<StepId>(),
      gqContext: queue.gqContext,
    });

    const launched: StepId[] = [];
    for (const stepId of decision.launch) {
      const spawns = planLaunches(stepId, stepStates, {
        questionType: queue.questionType,
        gqContext: queue.gqContext,
        languages: context.languages,
        stepConfigs: context.stepConfigs,
      });
      let any = false;
      for (const spawn of spawns) {
        const result = await deps.startStep({
          problemId,
          userId: context.userId,
          stepId: spawn.stepId,
          subSteps: spawn.subSteps,
          languages: spawn.languages,
          runKey: spawn.runKey,
        });
        if (result.ok) {
          any = true;
        } else {
          // Never throw out of here: the caller is a `close` handler. The step
          // keeps its place in the queue, so a transient failure retries on the
          // next advance instead of stranding the run.
          console.error(
            `[run-all] ${problemId} ${spawn.runKey ?? spawn.stepId} failed to start (${result.status}): ${result.error}`
          );
        }
      }
      if (any) launched.push(stepId);
    }

    // A launched step STAYS on the queue. Generate Question's waves and the
    // per-language fan-out each need a later advance to plan their next
    // processes; a step leaves only when `decideQueue` sees it completed (or
    // drops it). Original queue order is preserved.
    const keep = new Set([...decision.remaining, ...decision.launch]);
    const nextSteps = queue.steps.filter((id) => keep.has(id));

    if (nextSteps.length === 0) {
      await deps.clearQueue(problemId);
    } else {
      await deps.writeQueue(problemId, { ...queue, steps: nextSteps });
    }

    return { launched, remaining: nextSteps };
  });
}

// Close the loop: every step this process spawns advances the queue when it
// ends. Registered via the seam in start-step so that module never has to
// import this one back (the two would form a require cycle). `advanceQueue`
// resolves rather than throwing, and the terminal catch guarantees it — an
// unhandled rejection inside a `close` handler kills the Node process.
setOnStepClosed((problemId) => {
  void advanceQueue(problemId).catch((err) => {
    console.error(`[run-all] advance failed for ${problemId}:`, err);
  });
});
