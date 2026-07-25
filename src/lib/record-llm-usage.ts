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
