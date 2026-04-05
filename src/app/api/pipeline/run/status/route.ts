import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = request.nextUrl.searchParams.get("runId");
  const problemId = request.nextUrl.searchParams.get("problemId");

  if (runId) {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ run: data });
  }

  if (problemId) {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("problem_id", problemId)
      .order("started_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ runs: data || [] });
  }

  return NextResponse.json({ error: "runId or problemId required" }, { status: 400 });
}
