import { NextRequest, NextResponse } from "next/server";
import { getProcessPid } from "@/lib/process-registry";
import { createClient } from "@/lib/supabase/server";

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

  const pid = getProcessPid(runId);
  if (!pid) {
    return NextResponse.json({ error: "Process not found or already finished" }, { status: 404 });
  }

  try {
    // Kill the process group (negative PID kills the group since we used detached: true)
    process.kill(-pid, "SIGTERM");
  } catch {
    // Process may have already exited
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already dead
    }
  }

  return NextResponse.json({ success: true, message: "Stop signal sent" });
}
