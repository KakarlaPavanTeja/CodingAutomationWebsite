/**
 * Pure decision logic for LoadToBeta's "Load anyway" force path.
 *
 * A first-ever attempt has nothing to override, so the force control has no
 * reason to show — a first load is never a forced load. Once ANY prior
 * attempt exists — failed or completed — force must stay reachable, because
 * a question already in beta with no row in our table (loaded before this
 * feature shipped) would otherwise be a dead end forever: that gap is closed
 * by the fact that the first attempt against it creates a `failed` row,
 * after which force is offered. Keeping this as one small function (rather
 * than inline JSX conditions) is what lets a regression — showing force with
 * nothing to override, or re-closing the dead end above — get caught by a
 * test instead of only in production.
 */

export type PriorLoadStatus = "none" | "failed" | "completed";

/**
 * May the operator use the force ("Load anyway") control right now? Only
 * once a prior attempt (failed or completed) exists for this problem — never
 * on a brand-new problem's first try, which has nothing to force past.
 */
export function mayForceLoad(priorStatus: PriorLoadStatus): boolean {
  return priorStatus !== "none";
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
