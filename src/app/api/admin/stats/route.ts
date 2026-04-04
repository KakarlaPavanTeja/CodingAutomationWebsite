import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServiceClient();

  const [usersRes, problemsRes, runsRes, usageRes] = await Promise.all([
    supabase.from("profiles").select("id, role, status"),
    supabase.from("problems").select("id, status, question_type"),
    supabase.from("pipeline_runs").select("id, status"),
    supabase.from("llm_usage").select("cost_usd, model, purpose"),
  ]);

  const users = usersRes.data || [];
  const problems = problemsRes.data || [];
  const runs = runsRes.data || [];
  const usage = usageRes.data || [];

  const totalCost = usage.reduce(
    (sum, u) => sum + parseFloat(u.cost_usd || "0"),
    0
  );
  const costByModel: Record<string, number> = {};
  const costByPurpose: Record<string, number> = {};
  for (const u of usage) {
    const cost = parseFloat(u.cost_usd || "0");
    costByModel[u.model] = (costByModel[u.model] || 0) + cost;
    costByPurpose[u.purpose] = (costByPurpose[u.purpose] || 0) + cost;
  }

  return NextResponse.json({
    users: {
      total: users.length,
      active: users.filter((u) => u.status === "active").length,
      admins: users.filter((u) => u.role === "admin").length,
    },
    problems: {
      total: problems.length,
      byStatus: {
        draft: problems.filter((p) => p.status === "draft").length,
        processing: problems.filter((p) => p.status === "processing").length,
        completed: problems.filter((p) => p.status === "completed").length,
        failed: problems.filter((p) => p.status === "failed").length,
      },
      byType: {
        function: problems.filter((p) => p.question_type === "function").length,
        nonfunction: problems.filter((p) => p.question_type === "nonfunction")
          .length,
      },
    },
    runs: {
      total: runs.length,
      running: runs.filter((r) => r.status === "running").length,
      completed: runs.filter((r) => r.status === "completed").length,
      failed: runs.filter((r) => r.status === "failed").length,
    },
    costs: {
      total: totalCost,
      byModel: costByModel,
      byPurpose: costByPurpose,
      apiCalls: usage.length,
    },
  });
}
