/**
 * Hybrid process registry: in-memory + database.
 * In-memory is the fast path (same server instance).
 * DB (pipeline_runs.pid column) is the durable fallback that survives restarts.
 */

import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineRuns } from "@/lib/db/schema";
import { ORPHAN_EXIT_CODE } from "@/lib/pipeline-orphan";

const runningProcesses = new Map<string, number>();

export function registerProcess(runId: string, pid: number) {
  runningProcesses.set(runId, pid);
  db.update(pipelineRuns)
    .set({ pid })
    .where(eq(pipelineRuns.id, runId))
    .catch(() => {});
}

export function unregisterProcess(runId: string) {
  runningProcesses.delete(runId);
  db.update(pipelineRuns)
    .set({ pid: null })
    .where(eq(pipelineRuns.id, runId))
    .catch(() => {});
}

export async function getProcessPidAsync(runId: string): Promise<number | undefined> {
  const memPid = runningProcesses.get(runId);
  if (memPid) return memPid;

  try {
    const rows = await db
      .select({ pid: pipelineRuns.pid })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.id, runId),
          or(eq(pipelineRuns.status, "running"), and(eq(pipelineRuns.status, "failed"), eq(pipelineRuns.exitCode, ORPHAN_EXIT_CODE)))
        )
      )
      .limit(1);
    return rows[0]?.pid ?? undefined;
  } catch {
    return undefined;
  }
}

export function getProcessPid(runId: string): number | undefined {
  return runningProcesses.get(runId);
}
