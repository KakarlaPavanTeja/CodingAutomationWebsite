/**
 * Pure decision logic for LoadToBeta's "Load anyway" force path.
 *
 * The force option must always be reachable — a missing or failed prior
 * load row must not be a dead end, only a *completed* prior load should
 * make a bare (non-forced) submit locally pointless (the server would 409
 * it). Keeping this as one small function (rather than inline JSX
 * conditions) is what lets a regression — re-gating force on prior status —
 * get caught by a test instead of only in production.
 */

export type PriorLoadStatus = "none" | "failed" | "completed";

/**
 * May the operator use the force ("Load anyway") control right now? Always
 * — the control itself is never conditioned on what happened before. Takes
 * `priorStatus` purely so the call site and the tests read as a decision
 * over prior state, not a hardcoded `true` sprinkled into the JSX.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
export function mayForceLoad(priorStatus: PriorLoadStatus): boolean {
  return true;
}

/**
 * Is the load form submittable right now? A bare submit is blocked once a
 * completed prior load is known (it would just bounce off the server's 409
 * duplicate gate); forcing is always available but requires non-blank
 * remarks, since supplying them is what triggers server-side id
 * regeneration.
 */
export function canSubmitLoad(
  priorStatus: PriorLoadStatus,
  forceLoad: boolean,
  remarks: string,
): boolean {
  if (forceLoad) return remarks.trim() !== "";
  return priorStatus !== "completed";
}
