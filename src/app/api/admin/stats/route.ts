import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  const supabase = auth.supabase;

  // Run all count queries in parallel using Supabase's count feature + RPC
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
    usageRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "admin"),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("status", "pending_approval"),
    supabase.from("problems").select("*", { count: "exact", head: true }).neq("status", "deleted"),
    supabase.from("problems").select("*", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("problems").select("*", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("problems").select("*", { count: "exact", head: true }).eq("status", "completed"),
    supabase.from("problems").select("*", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("problems").select("*", { count: "exact", head: true }).eq("question_type", "function").neq("status", "deleted"),
    supabase.from("problems").select("*", { count: "exact", head: true }).eq("question_type", "nonfunction").neq("status", "deleted"),
    supabase.from("pipeline_runs").select("*", { count: "exact", head: true }),
    supabase.from("pipeline_runs").select("*", { count: "exact", head: true }).eq("status", "running"),
    supabase.from("pipeline_runs").select("*", { count: "exact", head: true }).eq("status", "completed"),
    supabase.from("pipeline_runs").select("*", { count: "exact", head: true }).eq("status", "failed"),
    // For costs, we still need to fetch values to sum — but only cost_usd and total_tokens (lightweight)
    supabase.from("llm_usage").select("cost_usd, total_tokens"),
  ]);

  // Calculate cost totals from the lightweight usage query
  const usage = usageRes.data || [];
  const totalCost = usage.reduce((sum, u) => sum + parseFloat(u.cost_usd || "0"), 0);
  const totalTokens = usage.reduce((sum, u) => sum + (u.total_tokens || 0), 0);

  return NextResponse.json({
    users: {
      total: usersTotal.count ?? 0,
      active: usersActive.count ?? 0,
      admins: usersAdmin.count ?? 0,
      pending: usersPending.count ?? 0,
    },
    problems: {
      total: problemsTotal.count ?? 0,
      byStatus: {
        draft: problemsDraft.count ?? 0,
        processing: problemsProcessing.count ?? 0,
        completed: problemsCompleted.count ?? 0,
        failed: problemsFailed.count ?? 0,
      },
      byType: {
        function: problemsFunction.count ?? 0,
        nonfunction: problemsNonfunction.count ?? 0,
      },
    },
    runs: {
      total: runsTotal.count ?? 0,
      running: runsRunning.count ?? 0,
      completed: runsCompleted.count ?? 0,
      failed: runsFailed.count ?? 0,
    },
    costs: {
      total: totalCost,
      totalTokens,
      apiCalls: usage.length,
    },
  });
}
