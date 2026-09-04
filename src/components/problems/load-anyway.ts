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
 * May a new load start right now?
 *
 * `loadRunning` wins over everything, forced or not: a load already in flight
 * for this problem would be joined by a second one loading the same question
 * ids into shared beta twice, or racing it for the same `childOrder` under the
 * real testing parent. Remarks do not make that safe, so they do not lift it —
 * the server refuses the same case with 423, this is only the fast local no.
 *
 * Otherwise a bare submit is blocked once a completed prior load is known (it
 * would just bounce off the server's 409 duplicate gate); forcing is always
 * available but requires non-blank remarks, since supplying them is what
 * triggers server-side id regeneration.
 *
 * `loadRunning` is a required argument on purpose: defaulting it to false is
 * exactly the bug this function exists to stop a caller from reintroducing.
 */
export function canSubmitLoad(
  priorStatus: PriorLoadStatus,
  forceLoad: boolean,
  remarks: string,
  loadRunning: boolean,
): boolean {
  if (loadRunning) return false;
  if (forceLoad) return remarks.trim() !== "";
  return priorStatus !== "completed";
}
