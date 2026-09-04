import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { codingQuestionLoads } from "@/lib/db/schema";

export type LoadSource = "pipeline" | "upload";

export interface LoadRecord {
  id: string;
  problemId: string | null;
  userId: string;
  status: string;
  questionSetId: string | null;
  questionIds: string[];
  taskOutputUrl: string | null;
  error: string | null;
  remarks: string | null;
  logs: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const IST_STAMP_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * One log entry: timestamped and single-line, so the column stays greppable.
 * The stamp is pinned to Asia/Kolkata (the team reading these logs is IST),
 * independent of the host process's timezone, and labelled "IST" so it can't
 * be misread as UTC next to the UI's `toLocaleString` banners.
 * `now` defaults to the real clock; it exists only so tests can pin an instant.
 */
export function formatLogLine(phase: string, message: string, now: Date = new Date()): string {
  const flat = String(message).replace(/\s*\n\s*/g, " ").trim();
  const parts = IST_STAMP_FORMAT.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const stamp = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
  return `[${stamp} IST] [${phase}] ${flat}`;
}

export async function createLoadRecord(args: {
  problemId: string | null;
  userId: string;
  source: LoadSource;
  remarks?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(codingQuestionLoads)
    .values({
      problemId: args.problemId,
      userId: args.userId,
      source: args.source,
      remarks: args.remarks ?? null,
    })
    .returning({ id: codingQuestionLoads.id });
  return row.id;
}

/** Append rather than overwrite, so concurrent phase writes cannot lose lines. */
export async function appendLoadLog(id: string, line: string): Promise<void> {
  await db
    .update(codingQuestionLoads)
    .set({ logs: sql`${codingQuestionLoads.logs} || ${line + "\n"}` })
    .where(eq(codingQuestionLoads.id, id));
}

export async function finishLoadRecord(
  id: string,
  patch: {
    status: "completed" | "failed";
    questionSetId?: string | null;
    questionIds?: string[];
    taskOutputUrl?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(codingQuestionLoads)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(codingQuestionLoads.id, id));
}

export async function getLoadRecord(id: string): Promise<LoadRecord | null> {
  const [row] = await db
    .select()
    .from(codingQuestionLoads)
    .where(eq(codingQuestionLoads.id, id))
    .limit(1);
  return (row as LoadRecord) ?? null;
}

/**
 * Most recent COMPLETED load for a problem — drives the duplicate warning
 * and the server's 409 gate. Deliberately status-scoped: a failed attempt
 * must never read as "already loaded" nor block a plain retry. Any caller
 * needing the most recent attempt regardless of outcome wants
 * `latestAttemptForProblem` instead.
 */
export async function latestLoadForProblem(problemId: string): Promise<LoadRecord | null> {
  const [row] = await db
    .select()
    .from(codingQuestionLoads)
    .where(
      and(
        eq(codingQuestionLoads.problemId, problemId),
        eq(codingQuestionLoads.status, "completed"),
      ),
    )
    .orderBy(desc(codingQuestionLoads.startedAt))
    .limit(1);
  return (row as LoadRecord) ?? null;
}

/**
 * A "running" row older than this is not a load in flight, it is wreckage: the
 * job is fire-and-forget in the API process, so a restart or a crash between
 * `createLoadRecord` and `finishLoadRecord` strands the row at "running"
 * forever and nothing reaps it. The longest real run is bounded by the task
 * polls in `load-coding-questions.ts` (SHEET_LOADING 100x3s + unlock 60x3s +
 * link confirmation, per batch), so 30 minutes is well past a live load and
 * still stops one crash from bricking the problem's Load-to-beta button.
 */
export const RUNNING_LOAD_STALE_MS = 30 * 60 * 1000;

/**
 * The load actually in flight for a problem, if any — the row `latestLoadForProblem`
 * (completed-only) and `latestAttemptForProblem` (newest, whatever that is) both
 * miss. Two callers need exactly this row and nothing else:
 *   - POST refuses to start a second concurrent load into shared beta,
 *   - GET hands the UI an id to re-attach its log panel to after a remount.
 * Deliberately a separate query: `latestLoadForProblem`'s completed-only
 * semantics drive the 409 duplicate gate and must not shift.
 */
export async function runningLoadForProblem(
  problemId: string,
  now: Date = new Date(),
): Promise<LoadRecord | null> {
  const [row] = await db
    .select()
    .from(codingQuestionLoads)
    .where(
      and(
        eq(codingQuestionLoads.problemId, problemId),
        eq(codingQuestionLoads.status, "running"),
        gt(codingQuestionLoads.startedAt, new Date(now.getTime() - RUNNING_LOAD_STALE_MS)),
      ),
    )
    .orderBy(desc(codingQuestionLoads.startedAt))
    .limit(1);
  return (row as LoadRecord) ?? null;
}

/**
 * Most recent load attempt for a problem, any status — lets the UI tell a
 * failed (or still-running) last attempt apart from "never loaded", instead
 * of only ever seeing a completed row or nothing at all.
 */
export async function latestAttemptForProblem(problemId: string): Promise<LoadRecord | null> {
  const [row] = await db
    .select()
    .from(codingQuestionLoads)
    .where(eq(codingQuestionLoads.problemId, problemId))
    .orderBy(desc(codingQuestionLoads.startedAt))
    .limit(1);
  return (row as LoadRecord) ?? null;
}
