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

/**
 * Ceiling on the stored log. No real load comes near it (a whole load logs
 * well under 1 kB), but `appendLoadLog` appends without bound, so the column
 * gets a limit before something in a retry loop finds it.
 */
export const LOG_CAP_CHARS = 64 * 1024;
export const LOG_TRUNCATION_MARKER = "[... earlier log lines dropped: log truncated ...]";

/**
 * Keep the MOST RECENT `cap` characters and head them with a marker on its own
 * line, so a truncated log can never be mistaken for a complete one. The first
 * line after the marker may be a partial one — that is what the marker says,
 * and it beats dropping the newest line when the cut lands mid-line.
 *
 * The SQL in `appendLoadLog` is a transcription of this function. The append
 * has to stay ONE statement — a read-modify-write would reintroduce the
 * lost-line race the SQL concatenation exists to avoid — so this is the
 * testable statement of the rule, and the two change together.
 */
export function capLogText(text: string, cap: number = LOG_CAP_CHARS): string {
  if (text.length <= cap) return text;
  const marker = `${LOG_TRUNCATION_MARKER}\n`;
  return marker + text.slice(text.length - Math.max(0, cap - marker.length));
}

/**
 * Append rather than overwrite, so concurrent phase writes cannot lose lines —
 * and cap the result in the SAME statement (see `capLogText`), because a
 * read-modify-write would bring that lost-line race straight back.
 */
export async function appendLoadLog(id: string, line: string): Promise<void> {
  const marker = `${LOG_TRUNCATION_MARKER}\n`;
  const appended = sql`${codingQuestionLoads.logs} || ${line + "\n"}`;
  await db
    .update(codingQuestionLoads)
    .set({
      logs: sql`case when length(${appended}) <= ${sql.raw(String(LOG_CAP_CHARS))} then ${appended}
        else ${marker} || right(${appended}, ${sql.raw(String(LOG_CAP_CHARS - marker.length))}) end`,
    })
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
