import { NextRequest, NextResponse } from "next/server";
import { getProcessPidAsync } from "@/lib/process-registry";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { runId } = await request.json();

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Immediately mark the run as failed in the DB so page reloads don't resume it
  const serviceClient = await createServiceClient();
  const { data: run } = await serviceClient
    .from("pipeline_runs")
    .select("problem_id, step_id")
    .eq("id", runId)
    .single();

  await serviceClient
    .from("pipeline_runs")
    .update({
      status: "failed",
      exit_code: -1,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  // Update pipeline_states so the step shows as failed
  if (run) {
    const { data: stateData } = await serviceClient
      .from("pipeline_states")
      .select("step_statuses")
      .eq("problem_id", run.problem_id)
      .single();

    if (stateData) {
      const stepStatuses = stateData.step_statuses || {};
      stepStatuses[run.step_id] = {
        status: "failed",
        exitCode: -1,
        endTime: Date.now(),
      };
      await serviceClient
        .from("pipeline_states")
        .update({ step_statuses: stepStatuses, updated_at: new Date().toISOString() })
        .eq("problem_id", run.problem_id);
    }

    // Reset problem status from "processing" back to "draft"
    await serviceClient
      .from("problems")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", run.problem_id)
      .eq("status", "processing");
  }

  // Kill the process (async lookup checks DB if in-memory miss)
  const pid = await getProcessPidAsync(runId);
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already dead
      }
    }
  }

  return NextResponse.json({ success: true, message: "Step stopped" });
}
