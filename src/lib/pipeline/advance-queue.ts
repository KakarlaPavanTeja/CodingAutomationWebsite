import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineStates } from "@/lib/db/schema";
import { startStep as realStartStep, setOnStepClosed } from "@/app/api/pipeline/run/start-step";
import type { StartStepArgs, StartStepResult } from "@/app/api/pipeline/run/start-step";
import { LANGUAGES } from "@/lib/pipeline-config";
import { ORPHAN_EXIT_CODE } from "@/lib/pipeline-orphan";
import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
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
  /** Cross-process mutual exclusion for one problem's advance. */
  withLock: <T>(problemId: string, fn: () => Promise<T>) => Promise<T>;
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
      enabledLanguages: pipelineStates.enabledLanguages,
      stepConfigs: pipelineStates.stepConfigs,
    })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, problemId))
    .limit(1);
  // No row is not a reason to stall: the run-all endpoint creates one when it
  // stores the queue, but a queue written by an older build (or a row deleted
  // underneath us) must still advance on the client's defaults rather than
  // freezing the run.
  const row = rows[0];
  return {
    languages:
      row?.enabledLanguages ?? LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id),
    stepConfigs: (row?.stepConfigs as QueueContext["stepConfigs"]) ?? {},
  };
}

/**
 * How many times each step has already failed under THIS Run All, keyed by the
 * parent step (a per-language or per-sub-step child failing is a failure of its
 * parent). Runs that predate the queue don't count — a Run All the user starts
 * after last week's failure must still get its full allowance.
 *
 * A soft orphan (-2) is excluded: `effectiveStepStatus` still treats it as
 * running, so counting it would spend an attempt on a run that may yet close
 * cleanly and correct itself.
 */
function failuresSinceQueueStart(runs: RunRow[], queueStartedAt: string): Map<StepId, number> {
  const since = Date.parse(queueStartedAt);
  const counts = new Map<StepId, number>();
  for (const run of runs) {
    if (run.status !== "failed" || run.exitCode === ORPHAN_EXIT_CODE) continue;
    if (!Number.isNaN(since) && (run.startedAt?.getTime() ?? 0) < since) continue;
    const parent = parsePipelineRunStepKey(run.stepId).parentStepId as StepId;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

// Namespace half of the advisory-lock key, so a `pg_advisory_lock` taken by any
// other feature (or by Drizzle Kit) can never collide with ours.
const ADVISORY_LOCK_NAMESPACE = 0x6370; // "cp"

/** Stable 32-bit (signed, for int4) FNV-1a hash of a problem id. */
function advisoryLockKey(problemId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < problemId.length; i++) {
    h ^= problemId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * Hold a per-problem lock IN POSTGRES for the whole advance, so two app
 * instances against the same database cannot both decide "this step is ready"
 * and spawn it. The in-process `chains` map below cannot do this — it is one
 * `Map` per Node process, which is exactly how one problem got two live
 * `generate_testcases` processes 300ms apart.
 *
 * The transaction exists only to scope the lock (`_xact_` releases it on commit
 * OR rollback, so a throwing advance cannot strand it). The advance's own reads
 * and writes deliberately run on other pooled connections — this tx takes no row
 * locks, so it can't deadlock against them.
 *
 * `lock_timeout` bounds the wait: an advance that cannot get in raises instead of
 * blocking a connection forever, and the next advance (a step close, or the
 * client's status poll) retries. One pooled connection is held per in-flight
 * advance; `PG_POOL_MAX` is the knob if a busy instance starts starving.
 */
async function withAdvisoryLock<T>(problemId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '30s'`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}::int4, ${advisoryLockKey(problemId)}::int4)`
    );
    return fn();
  });
}

const defaultDeps: AdvanceDeps = {
  readQueue: realReadQueue,
  writeQueue: realWriteQueue,
  clearQueue: realClearQueue,
  readRuns,
  readContext,
  startStep: realStartStep,
  withLock: withAdvisoryLock,
};

// In-process per-problem queue, kept IN FRONT of the Postgres advisory lock
// above rather than replaced by it.
//
// Two steps finishing at the same instant both call advanceQueue. Without this
// they interleave — both read the same queue, both decide to launch the same
// ready step, and it spawns twice. Chaining every advance for a problem onto the
// previous one makes read-decide-write atomic *within this process*; the
// advisory lock extends that guarantee across processes.
//
// Both are worth keeping: same-process advances wait here without each holding a
// pooled connection open to contend for the database lock.
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
  return serialise(problemId, () => deps.withLock(problemId, async () => {
    const queue = await deps.readQueue(problemId);
    if (!queue) return { launched: [], remaining: [] };

    const context = await deps.readContext(problemId);
    // No pipeline_states row means no user to attribute runs to. Leave the queue
    // alone rather than clearing it — the row may simply not have been written
    // yet, and dropping the queue here would silently abandon the run.
    if (!context) return { launched: [], remaining: queue.steps };

    const runs = await deps.readRuns(problemId);
    const stepStates = deriveParentStatuses(stepStatesFromRuns(runs), {
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
      force: new Set(queue.force ?? []),
      attempts: failuresSinceQueueStart(runs, queue.startedAt),
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
          // Whoever started the Run All owns every step it spawns — not
          // whoever last saved pipeline state for this problem.
          userId: queue.userId,
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

    // A forced step is forced ONCE. Now that it has been launched, its old
    // `completed` no longer matters, and the next completion is the fresh one —
    // leaving it forced would re-run it forever.
    const launchedSet = new Set(launched);
    const nextForce = (queue.force ?? []).filter((id) => !launchedSet.has(id));

    if (nextSteps.length === 0) {
      await deps.clearQueue(problemId);
    } else {
      await deps.writeQueue(problemId, { ...queue, steps: nextSteps, force: nextForce });
    }

    return { launched, remaining: nextSteps };
  }));
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
