import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineStates } from "@/lib/db/schema";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  const rows = await db
    .select()
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, safeProblemId))
    .limit(1);
  const row = rows[0];

  if (!row) {
    return NextResponse.json({ state: null });
  }

  return NextResponse.json({
    state: {
      id: row.id,
      problem_id: row.problemId,
      user_id: row.userId,
      question_type: row.questionType,
      mode: row.mode,
      enabled_languages: row.enabledLanguages,
      testcase_count: row.testcaseCount,
      step_configs: row.stepConfigs,
      step_statuses: row.stepStatuses,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    problemId,
    questionType,
    mode,
    enabledLanguages,
    testcaseCount,
    stepConfigs,
    stepStatuses,
  } = body;

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  const values = {
    problemId: safeProblemId,
    userId: auth.session.userId,
    questionType: questionType || "function",
    mode: mode || "practice",
    enabledLanguages: enabledLanguages || ["Python", "C++", "Java", "Node.js"],
    testcaseCount: testcaseCount ?? 48,
    stepConfigs: stepConfigs || {},
    stepStatuses: stepStatuses || {},
    updatedAt: new Date(),
  };

  await db
    .insert(pipelineStates)
    .values(values)
    .onConflictDoUpdate({
      target: pipelineStates.problemId,
      set: {
        questionType: values.questionType,
        mode: values.mode,
        enabledLanguages: values.enabledLanguages,
        testcaseCount: values.testcaseCount,
        stepConfigs: values.stepConfigs,
        stepStatuses: values.stepStatuses,
        updatedAt: values.updatedAt,
      },
    });

  return NextResponse.json({ success: true });
}
