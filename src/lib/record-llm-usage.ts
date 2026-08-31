import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { llmUsage } from "@/lib/db/schema";

export interface LlmUsageInsert {
  model: string;
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  userId?: string | null;
  problemId?: string | null;
  problemName?: string | null;
  stepId?: string | null;
  /** Which OpenRouter account key produced this call. Defaults to "new". */
  account?: "new" | "old";
}

/** Insert one LLM usage row (shared by CP prep and other server-side callers). */
export async function recordLlmUsage(row: LlmUsageInsert): Promise<void> {
  try {
    await db.insert(llmUsage).values({
      model: row.model.slice(0, 100),
      purpose: row.purpose.slice(0, 100),
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      costUsd: Math.min(Math.max(row.costUsd, 0), 1_000_000).toFixed(6),
      userId: row.userId ?? null,
      problemId: row.problemId ?? null,
      problemName: row.problemName?.slice(0, 200) ?? null,
      stepId: row.stepId?.slice(0, 100) ?? null,
      account: row.account ?? "new",
    });
  } catch (err) {
    console.error("[record-llm-usage] insert failed:", err);
  }
}

/** Window in which a cp_prep call is considered part of creating this problem.
 * Prep runs before the problem row exists (the user is still reviewing the
 * generated markdown), so its usage rows start life with problem_id NULL. */
const CP_PREP_CLAIM_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Attach a user's recent unattributed cp_prep spend to the problem it produced.
 *
 * Without this a problem's cost is split in two: the pipeline rows carry a
 * problem_id, the prep rows carry none, and nothing joins them — $18.17 of
 * August sat in that gap. Called once the problem row exists.
 *
 * Only claims rows that are still unattributed, so re-running it is harmless
 * and it can never move spend off another problem.
 */
export async function claimCpPrepUsageForProblem(
  problemId: string,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - CP_PREP_CLAIM_WINDOW_MS);
  try {
    const claimed = await db
      .update(llmUsage)
      .set({ problemId })
      .where(
        and(
          eq(llmUsage.userId, userId),
          eq(llmUsage.stepId, "cp_prep"),
          isNull(llmUsage.problemId),
          gte(llmUsage.createdAt, since),
        ),
      )
      .returning({ id: llmUsage.id });
    return claimed.length;
  } catch (err) {
    // Attribution is bookkeeping — never fail an upload over it.
    console.error("[claimCpPrepUsageForProblem] failed:", err);
    return 0;
  }
}
