import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { profiles, problems, pipelineRuns, llmUsage } from "@/lib/db/schema";

const countQuery = (table: typeof profiles | typeof problems | typeof pipelineRuns) =>
  db.select({ count: sql<number>`count(*)::int` }).from(table);

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const [
    usersTotal,
    usersActive,
    usersAdmin,
    usersPending,
    problemsTotal,
    problemsDraft,
    problemsProcessing,
    problemsCompleted,
    problemsFailed,
    problemsFunction,
    problemsNonfunction,
    runsTotal,
    runsRunning,
    runsCompleted,
    runsFailed,
    usageAgg,
  ] = await Promise.all([
    countQuery(profiles),
    countQuery(profiles).where(eq(profiles.status, "active")),
    countQuery(profiles).where(eq(profiles.role, "admin")),
    countQuery(profiles).where(eq(profiles.status, "pending_approval")),
    countQuery(problems).where(ne(problems.status, "deleted")),
    countQuery(problems).where(eq(problems.status, "draft")),
    countQuery(problems).where(eq(problems.status, "processing")),
    countQuery(problems).where(eq(problems.status, "completed")),
    countQuery(problems).where(eq(problems.status, "failed")),
    countQuery(problems).where(and(eq(problems.questionType, "function"), ne(problems.status, "deleted"))),
    countQuery(problems).where(and(eq(problems.questionType, "nonfunction"), ne(problems.status, "deleted"))),
    countQuery(pipelineRuns),
    countQuery(pipelineRuns).where(eq(pipelineRuns.status, "running")),
    countQuery(pipelineRuns).where(eq(pipelineRuns.status, "completed")),
    countQuery(pipelineRuns).where(eq(pipelineRuns.status, "failed")),
    db
      .select({
        totalCost: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)::text`,
        totalTokens: sql<number>`coalesce(sum(${llmUsage.totalTokens}), 0)::int`,
        apiCalls: sql<number>`count(*)::int`,
      })
      .from(llmUsage),
  ]);

  const usage = usageAgg[0] ?? { totalCost: "0", totalTokens: 0, apiCalls: 0 };

  return NextResponse.json({
    users: {
      total: usersTotal[0]?.count ?? 0,
      active: usersActive[0]?.count ?? 0,
      admins: usersAdmin[0]?.count ?? 0,
      pending: usersPending[0]?.count ?? 0,
    },
    problems: {
      total: problemsTotal[0]?.count ?? 0,
      byStatus: {
        draft: problemsDraft[0]?.count ?? 0,
        processing: problemsProcessing[0]?.count ?? 0,
        completed: problemsCompleted[0]?.count ?? 0,
        failed: problemsFailed[0]?.count ?? 0,
      },
      byType: {
        function: problemsFunction[0]?.count ?? 0,
        nonfunction: problemsNonfunction[0]?.count ?? 0,
      },
    },
    runs: {
      total: runsTotal[0]?.count ?? 0,
      running: runsRunning[0]?.count ?? 0,
      completed: runsCompleted[0]?.count ?? 0,
      failed: runsFailed[0]?.count ?? 0,
    },
    costs: {
      total: parseFloat(usage.totalCost),
      totalTokens: usage.totalTokens,
      apiCalls: usage.apiCalls,
    },
  });
}
