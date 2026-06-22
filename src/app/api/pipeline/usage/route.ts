import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { llmUsage, pipelineRuns } from "@/lib/db/schema";
import { assertSafeProblemId } from "@/lib/storage-path";
import type { StepId } from "@/types/pipeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Legacy step ids stored in older usage rows */
const STEP_ID_ALIASES: Record<string, StepId> = {
  create_testcases: "generate_testcases",
};

export type StepLlmUsageSummary = {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  models: string[];
  callCount: number;
};

function aggregateRows(
  rows: Array<{
    model: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: string;
  }>
): StepLlmUsageSummary {
  const models = new Set<string>();
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;

  for (const row of rows) {
    if (row.model && row.model !== "unknown") models.add(row.model);
    promptTokens += row.promptTokens;
    completionTokens += row.completionTokens;
    costUsd += parseFloat(row.costUsd || "0");
  }

  return {
    promptTokens,
    completionTokens,
    costUsd,
    models: Array.from(models),
    callCount: rows.length,
  };
}

export async function GET(request: NextRequest) {
  const problemIdParam = request.nextUrl.searchParams.get("problemId");
  if (!problemIdParam) {
    return NextResponse.json({ error: "problemId required" }, { status: 400 });
  }

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemIdParam);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const access = await requireProblemAccess(safeProblemId);
  if (access.error) return access.error;

  const [runs, usageRows] = await Promise.all([
    db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.problemId, safeProblemId))
      .orderBy(desc(pipelineRuns.startedAt)),
    db.select().from(llmUsage).where(eq(llmUsage.problemId, safeProblemId)),
  ]);

  // Latest run per step (runs are ordered newest-first)
  const latestRunByStep = new Map<string, (typeof runs)[0]>();
  for (const run of runs) {
    if (!latestRunByStep.has(run.stepId)) {
      latestRunByStep.set(run.stepId, run);
    }
  }

  const usage: Record<string, StepLlmUsageSummary> = {};

  for (const [stepId, run] of latestRunByStep) {
    const startedAt = run.startedAt;
    if (!startedAt) continue;

    const endAt = run.finishedAt ?? new Date();
    const endMs = endAt.getTime() + 30_000; // small buffer for clock skew

    const matched = usageRows.filter((row) => {
      if (!row.createdAt) return false;
      const rowStep = row.stepId ?? "";
      const normalized =
        (STEP_ID_ALIASES[rowStep] as string | undefined) ?? rowStep;
      if (normalized !== stepId) return false;
      const ts = row.createdAt.getTime();
      return ts >= startedAt.getTime() && ts <= endMs;
    });

    if (matched.length > 0) {
      usage[stepId] = aggregateRows(matched);
    }
  }

  return NextResponse.json(
    { usage },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}
