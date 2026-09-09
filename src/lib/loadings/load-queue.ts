/**
 * Who runs next?
 *
 * Loads are strictly single-file: every one of them claims the next free order
 * inside a shared question set, and two loads claiming the same order are
 * rejected by the NKB backend with a bare FAILURE and no reason. So this
 * decides ONE thing — given every load row, may a waiting one start, and which.
 *
 * Pure and database-free so it is testable without a database (this project's
 * test runner has none — see load-records.test.ts). `claimNextQueuedLoad` in
 * `load-records.ts` is a direct SQL transcription of `claimableFrom`, and THE
 * TWO CHANGE TOGETHER. Same arrangement as `capLogText` and `appendLoadLog` in
 * that file, for the same reason: the rule belongs somewhere a test can reach.
 */

import { RUNNING_LOAD_STALE_MS } from "./load-records";

export interface QueueRow {
  id: string;
  status: string;
  queuedAt: Date | null;
  startedAt: Date | null;
}

/** Is this status one the operator is still waiting on? */
export function isLiveLoad(status: string): boolean {
  return status === "queued" || status === "running";
}

/**
 * A `running` row whose `started_at` is older than the stale window is presumed
 * dead. Without this an interrupted load — deploy, restart, killed process —
 * would leave a row claiming `running` forever and nothing would ever start
 * again. A `running` row with no `started_at` at all is dead by the same
 * argument: `started_at` is written at claim time, so its absence means that
 * write never landed.
 */
function isRunningLive(row: QueueRow, now: Date): boolean {
  if (row.status !== "running") return false;
  const started = row.startedAt?.getTime();
  if (started == null) return false;
  return started > now.getTime() - RUNNING_LOAD_STALE_MS;
}

const byQueuedAt = (a: QueueRow, b: QueueRow) =>
  (a.queuedAt?.getTime() ?? 0) - (b.queuedAt?.getTime() ?? 0);

/**
 * The row that may start right now, or null. FIFO on `queued_at` — `id` is a v4
 * UUID and carries no ordering.
 */
export function claimableFrom(rows: QueueRow[], now: Date = new Date()): QueueRow | null {
  if (rows.some((r) => isRunningLive(r, now))) return null;
  return rows.filter((r) => r.status === "queued").sort(byQueuedAt)[0] ?? null;
}

/**
 * 1-based place in the waiting line, or null when the row is not waiting. Only
 * `queued` rows are numbered: a running load is not "position 0", it is the
 * thing the queue is waiting behind, and the UI says so separately.
 */
export function queuePositionOf(rows: QueueRow[], id: string): number | null {
  const waiting = rows.filter((r) => r.status === "queued").sort(byQueuedAt);
  const index = waiting.findIndex((r) => r.id === id);
  return index === -1 ? null : index + 1;
}
