import { and, desc, eq, sql } from "drizzle-orm";
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

/** One log entry: timestamped and single-line, so the column stays greppable. */
export function formatLogLine(phase: string, message: string): string {
  const flat = String(message).replace(/\s*\n\s*/g, " ").trim();
  return `[${new Date().toISOString()}] [${phase}] ${flat}`;
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
