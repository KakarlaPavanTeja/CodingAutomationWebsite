import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { problems, pipelineRuns, pipelineLogs, llmUsage } from "@/lib/db/schema";
import {
  formatPipelineRunStepDisplay,
  resolvePipelineRunStepKey,
} from "@/lib/pipeline-run-label";
import { aggregateUsageRows, matchUsageRowsForRun } from "@/lib/pipeline-usage-match";
import { reconcileStalePipelineRuns } from "@/lib/reconcile-pipeline-runs";
import { getObjectString } from "@/lib/object-storage";

type OptimalWarning = {
  reason: string;
  mismatches: { input: string; optimal: string; brute: string }[];
};

/**
 * Read the optimal-vs-brute cross-check verdict written by generate_brute_force.py.
 * Returns a warning only when the reference solution disagreed with the brute force
 * (status "mismatch"); ok/skipped/absent all mean "no warning".
 */
async function readOptimalWarning(problemId: string): Promise<OptimalWarning | null> {
  try {
    const raw = await getObjectString(`${problemId}/outputs/optimal_brute_check.json`);
    const parsed = JSON.parse(raw) as {
      status?: string;
      reason?: string;
      mismatches?: { input?: string; optimal?: string; brute?: string }[];
    };
    if (parsed?.status !== "mismatch") return null;
    return {
      reason:
        typeof parsed.reason === "string" && parsed.reason
          ? parsed.reason
          : "Reference solution disagrees with the brute-force oracle",
      mismatches: (Array.isArray(parsed.mismatches) ? parsed.mismatches : [])
        .slice(0, 5)
        .map((m) => ({
          input: String(m?.input ?? ""),
          optimal: String(m?.optimal ?? ""),
          brute: String(m?.brute ?? ""),
        })),
    };
  } catch {
    // No marker (older problem / step not run) or unreadable → no warning.
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Owner, admin, or any member the problem is shared with may view it.
  const auth = await requireProblemAccess(id);
  if (auth.error) return auth.error;

  const problemRows = await db.select().from(problems).where(eq(problems.id, id)).limit(1);
  const problem = problemRows[0];

  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  await reconcileStalePipelineRuns(id);

  const runs = await db
    .select({
      id: pipelineRuns.id,
      problemId: pipelineRuns.problemId,
      userId: pipelineRuns.userId,
      stepId: pipelineRuns.stepId,
      status: pipelineRuns.status,
      exitCode: pipelineRuns.exitCode,
      startedAt: pipelineRuns.startedAt,
      finishedAt: pipelineRuns.finishedAt,
      logsSummary: pipelineRuns.logsSummary,
      pid: pipelineRuns.pid,
      logStepId: pipelineLogs.stepId,
      logContent: pipelineLogs.content,
    })
    .from(pipelineRuns)
    .leftJoin(pipelineLogs, eq(pipelineLogs.runId, pipelineRuns.id))
    .where(eq(pipelineRuns.problemId, id))
    .orderBy(desc(pipelineRuns.startedAt));

  const usageRows = await db.select().from(llmUsage).where(eq(llmUsage.problemId, id));

  const optimalWarning = await readOptimalWarning(id);

  const usageSummary = aggregateUsageRows(
    usageRows.map((row) => ({
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      costUsd: row.costUsd,
    }))
  );

  // Snake-case for legacy frontend
  const problemOut = {
    id: problem.id,
    created_by: problem.createdBy,
    name: problem.name,
    question_type: problem.questionType,
    structure_type: problem.structureType,
    mode: problem.mode,
    scenario_level: problem.scenarioLevel,
    difficulty: problem.difficulty,
    score: problem.score,
    languages: problem.languages,
    status: problem.status,
    storage_path: problem.storagePath,
    created_at: problem.createdAt,
    updated_at: problem.updatedAt,
    deletion_reason: problem.deletionReason,
    deleted_at: problem.deletedAt,
  };

  const runsOut = runs.map((r) => {
    const logSnippet = r.logContent?.slice(0, 4000) ?? null;
    const runStepKey = resolvePipelineRunStepKey(r.stepId, r.logStepId, logSnippet);
    const display = formatPipelineRunStepDisplay(runStepKey);
    const usage = matchUsageRowsForRun(
      usageRows,
      runStepKey,
      r.startedAt,
      r.finishedAt,
      r.status,
      r.id
    );
    return {
      id: r.id,
      problem_id: r.problemId,
      user_id: r.userId,
      step_id: r.stepId,
      run_step_key: runStepKey,
      step_label: display.step,
      substep_label: display.substep,
      status: r.status,
      exit_code: r.exitCode,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      logs_summary: r.logsSummary,
      pid: r.pid,
      usage: usage
        ? {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            cost_usd: usage.costUsd,
            call_count: usage.callCount,
          }
        : null,
    };
  });

  return NextResponse.json({
    problem: problemOut,
    runs: runsOut,
    optimal_warning: optimalWarning,
    usage_summary: {
      prompt_tokens: usageSummary.promptTokens,
      completion_tokens: usageSummary.completionTokens,
      cost_usd: usageSummary.costUsd,
      call_count: usageSummary.callCount,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireProblemAccess(id);
  if (auth.error) return auth.error;

  let body: { difficulty?: unknown; score?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: { difficulty?: string | null; score?: number | null } = {};

  if ("difficulty" in body) {
    const d = body.difficulty;
    if (d === null || d === "") {
      updates.difficulty = null;
    } else if (typeof d === "string" && ["easy", "medium", "hard"].includes(d)) {
      updates.difficulty = d;
    } else {
      return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 });
    }
  }

  if ("score" in body) {
    const s = body.score;
    if (s === null || s === "") {
      updates.score = null;
    } else {
      const n = typeof s === "number" ? s : parseInt(String(s), 10);
      if (!Number.isFinite(n) || n < 1 || n > 100000) {
        return NextResponse.json({ error: "Invalid score" }, { status: 400 });
      }
      updates.score = Math.trunc(n);
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await db
    .update(problems)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(problems.id, id))
    .returning({ difficulty: problems.difficulty, score: problems.score });

  return NextResponse.json({
    difficulty: updated[0]?.difficulty ?? null,
    score: updated[0]?.score ?? null,
  });
}
