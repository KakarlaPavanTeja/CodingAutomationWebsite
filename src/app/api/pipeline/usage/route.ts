import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { llmUsage, pipelineRuns } from "@/lib/db/schema";
import {
  aggregateUsageRows,
  normalizeUsageStepId,
  usageRowMatchesRunStep,
} from "@/lib/pipeline-usage-match";
import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
import { assertSafeProblemId } from "@/lib/storage-path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type StepLlmUsageSummary = ReturnType<typeof aggregateUsageRows>;

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

    const matched = usageRows.filter((row) =>
      usageRowMatchesRunStep(row, stepId, startedAt.getTime(), endMs, run.id)
    );

    if (matched.length > 0) {
      usage[stepId] = aggregateUsageRows(matched);
    }
  }

  // All-time totals per parent step (every run summed, not just the latest).
  // Used to show "total cost" alongside the latest run's cost after a re-run —
  // e.g. re-running Generate Editorial shows this run's cost and the running
  // total across every editorial generation for the problem.
  const totalsByStep = new Map<string, typeof usageRows>();
  for (const row of usageRows) {
    const parent = parsePipelineRunStepKey(
      normalizeUsageStepId(row.stepId ?? "")
    ).parentStepId;
    if (!parent) continue;
    const bucket = totalsByStep.get(parent);
    if (bucket) bucket.push(row);
    else totalsByStep.set(parent, [row]);
  }
  const totals: Record<string, StepLlmUsageSummary> = {};
  for (const [stepId, rows] of totalsByStep) {
    totals[stepId] = aggregateUsageRows(rows);
  }

  return NextResponse.json(
    { usage, totals },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}
