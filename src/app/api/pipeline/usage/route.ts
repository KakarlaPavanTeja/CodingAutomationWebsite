import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { llmUsage, pipelineRuns } from "@/lib/db/schema";
import { aggregateUsageRows, usageRowMatchesRunStep } from "@/lib/pipeline-usage-match";
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

  return NextResponse.json(
    { usage },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}
