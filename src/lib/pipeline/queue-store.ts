import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineStates } from "@/lib/db/schema";
import type { GQSubStepContext } from "@/lib/pipeline-question";
import type { PipelineMode, QuestionType, StepId } from "@/types/pipeline";

/** An in-flight "Run all", persisted on `pipeline_states.run_all_queue`. */
export interface StoredQueue {
  steps: StepId[];
  questionType: QuestionType;
  mode: PipelineMode;
  /**
   * The GQ context captured when the run started. Snapshotted rather than
   * re-derived because `ownerDifficulty` lives outside `pipeline_states` and
   * the phase gate reads wrong without it. A title/difficulty edit made mid-run
   * is therefore not picked up until the next Run all — same as before, when
   * the queue lived in a browser tab.
   */
  gqContext: GQSubStepContext;
  startedAt: string;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Narrow a value read out of jsonb. Anything unexpected — a legacy shape, a
 * hand-edited row, a half-written value — yields `null` (no active run-all)
 * rather than throwing, so one bad row cannot break the pipeline page.
 */
export function parseStoredQueue(value: unknown): StoredQueue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!isStringArray(v.steps) || v.steps.length === 0) return null;
  if (v.questionType !== "function" && v.questionType !== "nonfunction") return null;
  if (v.mode !== "practice" && v.mode !== "exam") return null;
  if (!v.gqContext || typeof v.gqContext !== "object") return null;
  if (typeof v.startedAt !== "string") return null;
  return {
    steps: v.steps as StepId[],
    questionType: v.questionType,
    mode: v.mode,
    gqContext: v.gqContext as GQSubStepContext,
    startedAt: v.startedAt,
  };
}

export async function readQueue(problemId: string): Promise<StoredQueue | null> {
  const rows = await db
    .select({ runAllQueue: pipelineStates.runAllQueue })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, problemId))
    .limit(1);
  return parseStoredQueue(rows[0]?.runAllQueue);
}

/**
 * Persist the queue. `userId` creates the `pipeline_states` row if it is
 * missing — without it an UPDATE against a problem that has never saved state
 * would match no rows and lose the queue silently.
 */
export async function writeQueue(
  problemId: string,
  queue: StoredQueue,
  userId?: string
): Promise<void> {
  if (userId) {
    await db
      .insert(pipelineStates)
      .values({
        problemId,
        userId,
        questionType: queue.questionType,
        mode: queue.mode,
        runAllQueue: queue,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pipelineStates.problemId,
        set: { runAllQueue: queue, updatedAt: new Date() },
      });
    return;
  }
  await db
    .update(pipelineStates)
    .set({ runAllQueue: queue, updatedAt: new Date() })
    .where(eq(pipelineStates.problemId, problemId));
}

export async function clearQueue(problemId: string): Promise<void> {
  await db
    .update(pipelineStates)
    .set({ runAllQueue: null, updatedAt: new Date() })
    .where(eq(pipelineStates.problemId, problemId));
}
