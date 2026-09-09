/**
 * What the problems list's "Load" column says for one problem.
 *
 * Pure, and separate from the table, because this is five branches with a
 * precedence order — the kind of thing that silently starts claiming "Loaded"
 * for something that is not. The rendering around it is trivial; this is not.
 */

export interface LoadSummary {
  id: string;
  status: string;
  queuePosition?: number | null;
  questionIds: string[];
  queuedAt: string | Date | null;
  finishedAt: string | Date | null;
}

export type LoadCellKind = "queued" | "running" | "loaded" | "failed" | "untracked" | "none";

export interface LoadCell<T extends LoadSummary = LoadSummary> {
  kind: LoadCellKind;
  label: string;
  /** Is there anything to show when the row is expanded? */
  expandable: boolean;
  /**
   * The load the expanded panel should render, when there is one. Generic so a
   * caller passing richer records (logs, errors, beta ids) gets its own type
   * back and can hand it straight to LoadLogPanel — narrowing to LoadSummary
   * here would force a cast at every call site.
   */
  load: T | null;
}

const time = (v: string | Date | null | undefined): number =>
  v == null ? 0 : (v instanceof Date ? v : new Date(v)).getTime();

/**
 * Ordered by `finished_at`, NOT `queued_at`.
 *
 * `queued_at` was added to an existing table with `NOT NULL DEFAULT now()`, so
 * every row that predates it carries the same synthetic timestamp — the instant
 * of the migration. Sorting ~60 historical loads by it is sorting by a
 * constant, and the winner is whatever order the rows happen to arrive in.
 * `finished_at` was always written per row and is genuine history.
 */
const newest = <T extends LoadSummary>(loads: T[], status: string): T | null =>
  loads
    .filter((l) => l.status === status)
    .sort((a, b) => time(b.finishedAt) - time(a.finishedAt))[0] ?? null;

/**
 * Precedence, highest first:
 *   1. a load still in flight — that is what the operator is waiting on;
 *   2. the newest COMPLETED load — not the newest attempt, because "Load
 *      anyway" regenerates question ids, so the newest completed load holds
 *      the beta links that are actually live and an older one points at a
 *      superseded copy;
 *   3. the newest failed attempt;
 *   4. no record at all, on a problem older than load tracking — it may well
 *      be in beta, loaded before any of this existed, and the app cannot tell.
 *      Say so rather than implying it was never loaded;
 *   5. no record, and new enough that we would have one.
 */
export function deriveLoadCell<T extends LoadSummary>(args: {
  loads: T[];
  problemCreatedAt: string | Date | null;
  /** When the first load was ever recorded; null when nothing has been. */
  trackingStartedAt: string | Date | null;
}): LoadCell<T> {
  const { loads, problemCreatedAt, trackingStartedAt } = args;

  const live = loads.find((l) => l.status === "queued" || l.status === "running") ?? null;
  if (live) {
    if (live.status === "running") {
      return { kind: "running", label: "Loading…", expandable: true, load: live };
    }
    const ahead = (live.queuePosition ?? 1) - 1;
    return {
      kind: "queued",
      label: ahead > 0 ? `Queued · ${ahead} ahead` : "Queued · next",
      expandable: true,
      load: live,
    };
  }

  const completed = newest(loads, "completed");
  if (completed) return { kind: "loaded", label: "Loaded", expandable: true, load: completed };

  const failed = newest(loads, "failed");
  if (failed) return { kind: "failed", label: "Failed", expandable: true, load: failed };

  // A cancelled-only history means nothing was ever loaded — fall through to
  // the untracked/none decision rather than reporting the cancellation, which
  // is not a fact about beta.
  if (
    trackingStartedAt != null &&
    problemCreatedAt != null &&
    time(problemCreatedAt) < time(trackingStartedAt)
  ) {
    return { kind: "untracked", label: "Loaded earlier · not tracked", expandable: false, load: null };
  }

  return { kind: "none", label: "Not loaded", expandable: false, load: null };
}
