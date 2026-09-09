import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
  queuedAt: Date | null;
  sourcePath: string | null;
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

/**
 * Join the waiting line.
 *
 * A pipeline load is `queued`: the queue promotes exactly one row at a time
 * (see `claimNextQueuedLoad`), and `sourcePath` is remembered because the
 * questions are NOT stored on the row — the load re-reads its
 * coding_questions.json from storage when it is claimed, which may be minutes
 * after the POST that enqueued it.
 *
 * An UPLOAD is inserted `running`, not `queued`, and its caller drives it
 * inline. Its file exists only inside the request that uploaded it, so there
 * is nothing for a later claim to re-read; a row left `queued` would sit in
 * the line waiting for questions that no longer exist anywhere.
 */
export async function enqueueLoadRecord(args: {
  problemId: string | null;
  userId: string;
  source: LoadSource;
  remarks?: string | null;
  sourcePath?: string | null;
}): Promise<string> {
  const isUpload = args.source === "upload";
  const [row] = await db
    .insert(codingQuestionLoads)
    .values({
      problemId: args.problemId,
      userId: args.userId,
      source: args.source,
      remarks: args.remarks ?? null,
      sourcePath: args.sourcePath ?? null,
      status: isUpload ? "running" : "queued",
      startedAt: isUpload ? new Date() : null,
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

/**
 * The log exists for live progress and post-mortem debugging. Once a load has
 * gone green nobody reads the phase-by-phase detail again, so a completed row
 * keeps only this one line instead of the full log — reclaiming ~55% of the
 * row's storage (measured). A failed row is untouched by this: it is the
 * diagnostic value, see `finishLoadRecord`.
 *
 * Reuses `formatLogLine` so the timestamp is the same IST stamp, in the same
 * format, as every other line this feature writes.
 */
export function buildCompletionSummary(
  args: { questionSetId: string | null; questionIds: string[]; orderRange?: { start: number; end: number } | null },
  now: Date = new Date(),
): string {
  const range = args.orderRange ? ` (order ${args.orderRange.start}-${args.orderRange.end})` : "";
  const set = args.questionSetId ?? "(none)";
  return formatLogLine(
    "summary",
    `succeeded: loaded ${args.questionIds.length} question(s) into set ${set}${range}`,
    now,
  );
}

/**
 * Only path that flips a row to a terminal status, so this is also the only
 * place the log gets trimmed — and only for `completed`. `failed` never gets
 * a `logs` key in the SET clause, so that column is untouched: the full log
 * survives (see `buildCompletionSummary`).
 *
 * The trim is a plain overwrite in this SAME statement as the status flip —
 * not a read-modify-write — so a poll lands on either the pre-trim row
 * (running, full log) or the post-trim row (completed, summary), never
 * something in between.
 *
 * `onLog` callbacks in the caller are fire-and-forget (`.catch()`'d, not
 * awaited), so one can still be in flight when this runs and land AFTER it.
 * That is fine, not silently lost: `appendLoadLog` only ever *concatenates*
 * (`logs || line`), so a late line lands as a stray orphan after the summary
 * — readable, if odd — never overwrites or erases it. A late line that lands
 * BEFORE this UPDATE is simply superseded by the overwrite, which is exactly
 * the intended trim.
 */
export async function finishLoadRecord(
  id: string,
  patch: {
    status: "completed" | "failed";
    questionSetId?: string | null;
    questionIds?: string[];
    taskOutputUrl?: string | null;
    error?: string | null;
    orderRange?: { start: number; end: number } | null;
  },
): Promise<void> {
  const { orderRange, ...rest } = patch;
  await db
    .update(codingQuestionLoads)
    .set({
      ...rest,
      finishedAt: new Date(),
      ...(patch.status === "completed"
        ? {
            logs: buildCompletionSummary({
              questionSetId: patch.questionSetId ?? null,
              questionIds: patch.questionIds ?? [],
              orderRange,
            }),
          }
        : {}),
    })
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
 * `claimNextQueuedLoad` and `finishLoadRecord` strands the row at "running"
 * forever and nothing reaps it. The longest real run is bounded by the task
 * polls in `load-coding-questions.ts` (SHEET_LOADING 100x3s + unlock 60x3s +
 * link confirmation, per batch), so 30 minutes is well past a live load and
 * still stops one crash from bricking the problem's Load-to-beta button.
 */
export const RUNNING_LOAD_STALE_MS = 30 * 60 * 1000;

/**
 * Promote the oldest waiting load to `running`, or return null if one is
 * already live.
 *
 * ONE STATEMENT on purpose. Two drainers firing at the same instant both pick
 * the same oldest row; Postgres row-locks it, the loser re-evaluates this WHERE
 * against the committed row (EvalPlanQual under READ COMMITTED), now sees a
 * live `running` row, and updates nothing. A `select` followed by an `update`
 * would reintroduce exactly the check-then-act race the old global refusal
 * carried, and this is the one thing here that must not be racy.
 *
 * Drizzle's update builder with a raw WHERE, NOT `db.execute`: `.returning()`
 * hands back typed rows in the same camelCase shape as every other query in
 * this file, so there is no snake_case row to hand-map and no cast to get
 * wrong. Nothing else in this repo uses `db.execute` with a `returning`, so its
 * row shape is unproven here.
 *
 * `now()` for `started_at` rather than `new Date()`: the stale window below is
 * measured against the database clock, and one clock is the only way that
 * comparison stays honest.
 *
 * This is a transcription of `claimableFrom` in `./load-queue.ts`, which is
 * where the rule is stated and tested. THE TWO CHANGE TOGETHER. It is also not
 * the only guard — `advanceLoadQueue` holds a Postgres advisory lock across the
 * whole drain, which is what stops two app instances from both promoting a row
 * when a stale `running` row satisfies the guard for both.
 *
 * Verified against the real database on 2026-09-09, because `npm run test:ts`
 * has no database and cannot race two connections. Three queued rows, then
 * five simultaneous `claimNextQueuedLoad()` calls per pass:
 *   pass 1, nothing running        -> 1 winner  (not 5, not 2)
 *   pass 2, that one still running -> 0 winners
 *   pass 3, after it completed     -> 1 winner, and it was the NEXT-OLDEST row
 * `started_at` was populated by the claim in every case. If this statement is
 * ever edited, re-run that probe — a regression here is silent, and the cost of
 * it is two loads claiming the same order in a shared question set, which the
 * backend rejects with a bare FAILURE and no reason.
 */
export async function claimNextQueuedLoad(): Promise<LoadRecord | null> {
  const staleSeconds = Math.floor(RUNNING_LOAD_STALE_MS / 1000);
  const [row] = await db
    .update(codingQuestionLoads)
    .set({ status: "running", startedAt: sql`now()` })
    .where(sql`
      ${codingQuestionLoads.id} = (
        select id from ${codingQuestionLoads}
         where status = 'queued'
         order by queued_at asc
         limit 1
      )
      and not exists (
        select 1 from ${codingQuestionLoads}
         where status = 'running'
           and started_at > now() - make_interval(secs => ${staleSeconds})
      )
    `)
    .returning();
  return (row as LoadRecord) ?? null;
}

/** 1-based place in the waiting line, or null when this load is not waiting. */
export async function queuePositionForLoad(id: string): Promise<number | null> {
  const rows = await db
    .select({ id: codingQuestionLoads.id })
    .from(codingQuestionLoads)
    .where(eq(codingQuestionLoads.status, "queued"))
    .orderBy(asc(codingQuestionLoads.queuedAt));
  const index = rows.findIndex((r) => r.id === id);
  return index === -1 ? null : index + 1;
}

/**
 * Pull a load out of the line, or clear one wedged in `running`.
 *
 * Both cases in one function on purpose: a row stranded `running` by a crash
 * blocks the whole queue for the full stale window, and "cancel it" is the same
 * operator gesture as pulling a waiting row out. A genuinely live `running` row
 * is refused — cancelling it would leave an NKB task writing to beta with
 * nothing tracking it.
 */
export async function cancelLoad(
  id: string,
  now: Date = new Date(),
): Promise<"cancelled" | "not-cancellable" | "missing"> {
  const [row] = await db
    .select({ status: codingQuestionLoads.status, startedAt: codingQuestionLoads.startedAt })
    .from(codingQuestionLoads)
    .where(eq(codingQuestionLoads.id, id))
    .limit(1);
  if (!row) return "missing";
  const stale =
    row.status === "running" &&
    (row.startedAt?.getTime() ?? 0) <= now.getTime() - RUNNING_LOAD_STALE_MS;
  if (row.status !== "queued" && !stale) return "not-cancellable";
  await db
    .update(codingQuestionLoads)
    .set({
      status: "cancelled",
      finishedAt: new Date(),
      error:
        row.status === "queued"
          ? "Cancelled before it started."
          : "Cancelled: no progress for over 30 minutes, presumed dead.",
    })
    .where(eq(codingQuestionLoads.id, id));
  return "cancelled";
}

/**
 * This problem's load that has not finished — queued OR running. Both block a
 * second load of the same problem and both are worth re-attaching a log panel
 * to, so they are one query and one concept.
 *
 * No staleness filter, unlike the `running`-only query this replaces: a row
 * wedged past the stale window still belongs in the UI, which offers to cancel
 * it. `claimNextQueuedLoad` is where staleness decides anything.
 *
 * Deliberately separate from `latestLoadForProblem`, whose completed-only
 * semantics drive the duplicate gate and must not shift.
 */
export async function liveLoadForProblem(problemId: string): Promise<LoadRecord | null> {
  const [row] = await db
    .select()
    .from(codingQuestionLoads)
    .where(
      and(
        eq(codingQuestionLoads.problemId, problemId),
        inArray(codingQuestionLoads.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(codingQuestionLoads.queuedAt))
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
