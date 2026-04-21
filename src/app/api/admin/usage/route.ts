import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAdminApi } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { llmUsage, profiles, problems } from "@/lib/db/schema";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const rows = await db
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
    .limit(1000);

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

  return NextResponse.json({ usage });
}
