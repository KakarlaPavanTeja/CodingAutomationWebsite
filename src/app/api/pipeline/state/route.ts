import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");
  if (!problemId) {
    return NextResponse.json({ error: "problemId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("pipeline_states")
    .select("*")
    .eq("problem_id", problemId)
    .single();

  if (error || !data) {
    return NextResponse.json({ state: null });
  }

  return NextResponse.json({ state: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  // Upsert: create or update
  const { error } = await supabase
    .from("pipeline_states")
    .upsert(
      {
        problem_id: problemId,
        user_id: user.id,
        question_type: questionType || "function",
        mode: mode || "practice",
        enabled_languages: enabledLanguages || ["Python", "C++", "Java", "Node.js"],
        testcase_count: testcaseCount || 48,
        step_configs: stepConfigs || {},
        step_statuses: stepStatuses || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "problem_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
