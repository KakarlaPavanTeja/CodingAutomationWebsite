import type { StepStatus } from "@/types/pipeline";

/** Exit code for a *soft* orphan: reconciler suspects the PID is gone but the
 * process may still be alive and will self-correct via the run close handler. */
export const ORPHAN_EXIT_CODE = -2;

/** True when the server only suspects a run is orphaned (not a real failure). */
export function isSoftOrphanExitCode(exitCode: unknown): boolean {
  return exitCode === ORPHAN_EXIT_CODE || exitCode === String(ORPHAN_EXIT_CODE);
}

/** A pipeline run row that should still be treated as in-flight by the client. */
export function isRunStillInFlight(status: string, exitCode: unknown): boolean {
  return status === "running" || (status === "failed" && isSoftOrphanExitCode(exitCode));
}

/** Map a soft-orphan failure back to running for display and gating. */
export function effectiveStepStatus(status: StepStatus, exitCode: number | null): StepStatus {
  if (status === "failed" && isSoftOrphanExitCode(exitCode)) return "running";
  return status;
}
