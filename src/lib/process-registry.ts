/**
 * Hybrid process registry: in-memory + database.
 * In-memory is the fast path (same server instance).
 * DB (pipeline_runs.pid column) is the durable fallback that survives restarts.
 */

import { createServiceClient } from "@/lib/supabase/server";

// Fast in-memory lookup for same-instance stop
const runningProcesses = new Map<string, number>();

export function registerProcess(runId: string, pid: number) {
  runningProcesses.set(runId, pid);
  // Also persist to DB (fire-and-forget)
  createServiceClient().then((supabase) =>
    supabase
      .from("pipeline_runs")
      .update({ pid })
      .eq("id", runId)
      .then(() => {})
  ).catch(() => {});
}

export function unregisterProcess(runId: string) {
  runningProcesses.delete(runId);
  // Clear PID in DB (fire-and-forget)
  createServiceClient().then((supabase) =>
    supabase
      .from("pipeline_runs")
      .update({ pid: null })
      .eq("id", runId)
      .then(() => {})
  ).catch(() => {});
}

/**
 * Get PID for a running process.
 * Checks in-memory first (fast), falls back to DB (durable).
 */
export async function getProcessPidAsync(runId: string): Promise<number | undefined> {
  // Fast path: in-memory
  const memPid = runningProcesses.get(runId);
  if (memPid) return memPid;

  // Slow path: DB lookup (handles server restart case)
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("pipeline_runs")
      .select("pid")
      .eq("id", runId)
      .eq("status", "running")
      .single();
    return data?.pid ?? undefined;
  } catch {
    return undefined;
  }
}

// Keep sync version for backward compat (in-memory only)
export function getProcessPid(runId: string): number | undefined {
  return runningProcesses.get(runId);
}
