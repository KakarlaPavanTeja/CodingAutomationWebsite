import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { llmUsage, profiles, problems } from "@/lib/db/schema";

// Always read fresh from the DB — usage rows are written by the pipeline as it
// runs, so this endpoint must never be cached (server or browser).
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The dashboard computes every total, chart, and breakdown client-side, so it
// needs the WHOLE history — a small cap here silently under-reports cost. This
// is a guardrail against an unbounded payload, not a real limit: at current
// volume (~730 rows/month) it is years away. If it is ever hit we flag it
// instead of quietly dropping rows.
// ponytail: row-count guardrail; move aggregation server-side if this trips.
const MAX_ROWS = 100_000;

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const [rows, countRes] = await Promise.all([
    db
      .select({
        usage: llmUsage,
        user_email: profiles.email,
        user_display_name: profiles.displayName,
        problem_name: problems.name,
      })
      .from(llmUsage)
      .leftJoin(profiles, eq(llmUsage.userId, profiles.id))
      .leftJoin(problems, eq(llmUsage.problemId, problems.id))
      .orderBy(desc(llmUsage.createdAt))
      .limit(MAX_ROWS),
    db.select({ count: sql<number>`count(*)::int` }).from(llmUsage),
  ]);

  const total = countRes[0]?.count ?? rows.length;
  const truncated = rows.length >= MAX_ROWS;

  const usage = rows.map((r) => ({
    id: r.usage.id,
    user_id: r.usage.userId,
    problem_id: r.usage.problemId,
    model: r.usage.model,
    purpose: r.usage.purpose,
    step_id: r.usage.stepId,
    prompt_tokens: r.usage.promptTokens,
    completion_tokens: r.usage.completionTokens,
    total_tokens: r.usage.totalTokens,
    cost_usd: r.usage.costUsd,
    problem_name: r.usage.problemName,
    created_at: r.usage.createdAt,
    profiles: r.user_email
      ? { email: r.user_email, display_name: r.user_display_name }
      : null,
    problems: r.problem_name ? { name: r.problem_name } : null,
  }));

  return NextResponse.json(
    { usage, total, truncated },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}
