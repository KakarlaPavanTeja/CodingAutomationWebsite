/**
 * In-memory registry of running pipeline processes.
 * Maps runId → process PID for stop functionality.
 * This works because the Python process runs on the same server.
 */

const runningProcesses = new Map<string, number>();

export function registerProcess(runId: string, pid: number) {
  runningProcesses.set(runId, pid);
}

export function unregisterProcess(runId: string) {
  runningProcesses.delete(runId);
}

export function getProcessPid(runId: string): number | undefined {
  return runningProcesses.get(runId);
}
