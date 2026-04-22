import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { pipelineStates } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");
  if (!problemId) {
    return NextResponse.json({ error: "problemId required" }, { status: 400 });
  }

  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, problemId))
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
  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  if (!problemId) {
    return NextResponse.json({ error: "problemId required" }, { status: 400 });
  }

  const values = {
    problemId,
    userId: user.id,
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
