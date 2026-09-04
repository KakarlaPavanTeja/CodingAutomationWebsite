/**
 * Pure decision logic for the "Load anyway" force path, shared by LoadToBeta
 * (the problem page, keyed on `problemId`) and the standalone upload page
 * (`/load-coding-question`, `source: "upload"`, no `problemId`).
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
 *
 * The upload page has no `problemId`, so it has no server-known prior state
 * to consult on mount — an uploaded file's beta history is unknown until the
 * pre-flight duplicate check inside its own load actually runs. `mayForceLoad`
 * itself still fits its VISIBILITY rule (once a prior attempt is known);
 * `mayForceUploadRetry` below just feeds it from this browser session's own
 * last attempt instead of a server GET, and narrows it to "failed" — a
 * "completed" prior upload has no 409 dead-end to pre-empt (the server's
 * completed-duplicate gate is keyed on `problemId`, which upload requests
 * never have), so treating a plain success as a reason to show a force
 * control would only be noise. `canSubmitLoad`'s post-"completed" block is
 * the same story: it exists solely to avoid a 409 that can't happen here, so
 * `canSubmitUpload` below does not carry it — the two surfaces' visibility
 * rules match, their submit-gating rules deliberately do not.
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

/**
 * May the upload page's force control show right now? Fed by this browser
 * session's own last finished attempt (there is no `problemId` to fetch
 * server-known history for), and — unlike `mayForceLoad` — true only once
 * that attempt actually FAILED. A "completed" upload has nothing to
 * pre-empt: the server's 409 completed-duplicate gate never fires for an
 * upload request (it is keyed on `problemId`), so offering the remedy after
 * a plain success would just be the pre-first-attempt noise the operator
 * already objected to, not the "moment it becomes relevant."
 */
export function mayForceUploadRetry(lastAttemptStatus: PriorLoadStatus): boolean {
  return lastAttemptStatus === "failed";
}

/**
 * May the upload page submit right now? Gating stops at "is there a file,
 * are we mid-submit, and — if forcing — are there real remarks": there is no
 * `loadRunning` concept (the 423 concurrent-load gate is `problemId`-only, so
 * an upload has nothing server-side to join), and no reason to block a bare
 * resubmit after a "completed" prior attempt (that block in `canSubmitLoad`
 * exists only to dodge the `problemId`-keyed 409 gate, which upload requests
 * never reach). A first upload therefore never needs the checkbox ticked.
 */
export function canSubmitUpload(
  hasFile: boolean,
  forceLoad: boolean,
  remarks: string,
  submitting: boolean,
): boolean {
  if (submitting || !hasFile) return false;
  if (forceLoad) return remarks.trim() !== "";
  return true;
}
