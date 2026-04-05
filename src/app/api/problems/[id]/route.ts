import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch problem
  const { data: problem, error: problemError } = await supabase
    .from("problems")
    .select("*")
    .eq("id", id)
    .single();

  if (problemError || !problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  // Check ownership (unless admin)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (problem.created_by !== user.id && profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch pipeline runs for this problem
  const { data: runs } = await supabase
    .from("pipeline_runs")
    .select("*")
    .eq("problem_id", id)
    .order("started_at", { ascending: false });

  return NextResponse.json({ problem, runs: runs || [] });
}
