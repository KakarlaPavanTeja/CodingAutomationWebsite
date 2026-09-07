import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineStates } from "@/lib/db/schema";
import { pipelineStateCacheInvalidate } from "@/lib/pipeline-state-cache";
import type { GQSubStepContext } from "@/lib/pipeline-question";
import type { PipelineMode, QuestionType, StepId } from "@/types/pipeline";

/**
 * An in-flight "Run all", persisted on `pipeline_states.run_all_queue`.
 *
 * `gqContext` is captured when the queue is created rather than re-derived on
 * every advance: it is the context the browser used to decide what to queue, so
 * storing it keeps the server's later decisions consistent with that one. The
 * trade-off is that editing the title mid-run does not change an already-running
 * queue — same as the client, which snapshots the workflow up front.
 */
export interface StoredQueue {
  steps: StepId[];
  questionType: QuestionType;
  mode: PipelineMode;
  gqContext: GQSubStepContext;
  /** Who started the run-all: `pipeline_runs.userId` for every step it spawns. */
  userId: string;
  /**
   * Steps the user asked for BY NAME ("re-run affected"), which must run again
   * even though their newest run says `completed`. A step drops out of this set
   * as soon as it is launched, so its next completion ends it normally.
   */
  force?: StepId[];
  startedAt: string;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Narrow whatever is in the jsonb column. A malformed value yields `null`, never
 * a throw — one corrupt row must not break the pipeline page for a problem.
 * An empty step list is "no queue" too: nothing is left to advance.
 */
export function parseStoredQueue(value: unknown): StoredQueue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const q = value as Record<string, unknown>;
  if (!isStringArray(q.steps) || q.steps.length === 0) return null;
  if (q.questionType !== "function" && q.questionType !== "nonfunction") return null;
  if (q.mode !== "practice" && q.mode !== "exam") return null;
  if (!q.gqContext || typeof q.gqContext !== "object") return null;
  if (typeof q.userId !== "string" || !q.userId) return null;
  if (typeof q.startedAt !== "string" || Number.isNaN(Date.parse(q.startedAt))) return null;
  return {
    steps: q.steps as StepId[],
    questionType: q.questionType,
    mode: q.mode,
    gqContext: q.gqContext as GQSubStepContext,
    userId: q.userId,
    // Absent or malformed force list is simply "nothing forced" — an older
    // queue written before this field existed must still parse.
    force: isStringArray(q.force) ? (q.force as StepId[]) : undefined,
    startedAt: q.startedAt,
  };
}

export async function readQueue(problemId: string): Promise<StoredQueue | null> {
  const rows = await db
    .select({ queue: pipelineStates.runAllQueue })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, problemId))
    .limit(1);
  return parseStoredQueue(rows[0]?.queue);
}

/** The user a server-launched step runs as — `pipeline_runs.user_id` is NOT NULL. */
export async function readQueueOwner(problemId: string): Promise<string | null> {
  const rows = await db
    .select({ userId: pipelineStates.userId })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, problemId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

async function setQueue(problemId: string, queue: StoredQueue | null): Promise<void> {
  await db
    .update(pipelineStates)
    .set({ runAllQueue: queue, updatedAt: new Date() })
    .where(eq(pipelineStates.problemId, problemId));
  pipelineStateCacheInvalidate(problemId);
}

export async function writeQueue(problemId: string, queue: StoredQueue): Promise<void> {
  await setQueue(problemId, queue);
}

export async function clearQueue(problemId: string): Promise<void> {
  await setQueue(problemId, null);
}
