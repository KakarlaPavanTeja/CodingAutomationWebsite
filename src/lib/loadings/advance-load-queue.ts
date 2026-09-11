/**
 * Drain the coding-question load queue.
 *
 * Claim the oldest waiting load, run it, record the outcome, repeat until
 * nothing is claimable. Modelled on `src/lib/pipeline/advance-queue.ts`, which
 * does the same job for the pipeline's Run All — same dependency-injection seam
 * so the flow is testable without a database, same two-layer locking.
 *
 * There is no worker process, and this deliberately does not add one. It is
 * called from two places that already happen: the end of a load (drains the
 * next), and the status GET the log panel polls every two seconds (which is
 * what recovers a queue stranded by a deploy or a crash).
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { readStorageFile } from "@/lib/storage-sync";
import { parseCodingQuestionsPayload, type CodingQuestionRow } from "./coding-questions-json";
import { loadCodingQuestions, type LoadResult } from "./load-coding-questions";
import {
  appendLoadLog,
  claimNextQueuedLoad,
  finishLoadRecord,
  formatLogLine,
  type LoadRecord,
} from "./load-records";
import { regenerateQuestionIds } from "./regenerate-ids";

/** Where a pipeline load reads its questions when the POST named no path. */
export const DEFAULT_SOURCE_PATH = "forJSONPreparation/coding_questions.json";

/** One lane today: every load shares one question set, so all of them queue. */
export const BETA_LANE = "beta";

/**
 * Loads run serially and each can take minutes, so one pass is bounded rather
 * than looping until the queue is empty. The next trigger — the log panel's
 * poll, two seconds later — picks up where this left off. Without a bound, a
 * queue someone keeps adding to would hold one call open indefinitely.
 */
export const MAX_DRAIN_PER_PASS = 25;

type ClaimedLoad = Pick<LoadRecord, "id" | "problemId" | "remarks" | "sourcePath">;

export interface AdvanceLoadDeps {
  claim: () => Promise<ClaimedLoad | null>;
  readQuestions: (record: ClaimedLoad) => Promise<CodingQuestionRow[]>;
  runLoad: (
    questions: CodingQuestionRow[],
    opts: { loadId: string; skipDuplicateCheck: boolean },
  ) => Promise<LoadResult>;
  finish: (
    id: string,
    args: {
      status: "completed" | "failed";
      questionSetId?: string | null;
      questionIds?: string[];
      taskOutputUrl?: string | null;
      error?: string | null;
      orderRange?: { start: number; end: number } | null;
    },
  ) => Promise<void>;
  log: (id: string, line: string) => Promise<void>;
  /** Cross-process mutual exclusion for the lane's whole drain. */
  withLock: <T>(lane: string, fn: () => Promise<T>) => Promise<T>;
}

/**
 * Re-read a queued load's questions from storage.
 *
 * They are deliberately not stored on the row — one coding_questions.json runs
 * to megabytes with testcases, per-language solutions and an editorial — so the
 * row carries the path and this reads it at claim time.
 */
async function readQuestions(record: ClaimedLoad): Promise<CodingQuestionRow[]> {
  if (!record.problemId) {
    throw new Error(
      "An upload-sourced load cannot be queued: its file exists only in the request that " +
        "uploaded it, so there is nothing to re-read. Uploads load immediately or not at all.",
    );
  }
  const path = record.sourcePath || DEFAULT_SOURCE_PATH;
  const raw = await readStorageFile(record.problemId, path, "outputs");
  const parsed = parseCodingQuestionsPayload(JSON.parse(raw));
  if (!parsed?.length) {
    throw new Error(
      `No questions in ${path} — the file was readable but held no question array.`,
    );
  }
  // Remarks mean "make a deliberate second copy", which is what regenerating
  // the ids achieves. Applied here rather than at enqueue time because the
  // questions themselves are only read now.
  return record.remarks ? regenerateQuestionIds(parsed) : parsed;
}

// Namespace half of the advisory-lock key so a `pg_advisory_lock` taken by any
// other feature (or by Drizzle Kit) cannot collide. `advance-queue.ts` uses
// 0x6370 ("cp") for the pipeline; this is a DIFFERENT namespace, because the
// two queues must never wait on each other.
const ADVISORY_LOCK_NAMESPACE = 0x6c64; // "ld"

/** Stable 32-bit (signed, for int4) FNV-1a hash of the lane name. */
function advisoryLockKey(lane: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < lane.length; i++) {
    h ^= lane.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * Hold the lane's lock IN POSTGRES, so two app instances cannot both write to
 * the lane. Exported because the inline UPLOAD path in the loadings route must
 * take this same lock: an upload cannot queue (its file exists only in its own
 * request), but it writes to the same shared question set as every queued
 * load, and without this it would run alongside one. `withSetLock` only covers
 * one process. Copied deliberately from `withAdvisoryLock` in
 * `src/lib/pipeline/advance-queue.ts`, which exists because in-process chaining
 * alone demonstrably failed there — one problem got two live processes 300ms
 * apart. Do not assume this app is single-instance.
 *
 * The transaction exists only to scope the lock: `_xact_` releases it on commit
 * OR rollback, so a throwing drain cannot strand it. The drain's own reads and
 * writes run on other pooled connections, so this tx takes no row locks and
 * cannot deadlock against them.
 *
 * `lock_timeout` is 10 minutes, not the pipeline's 30 seconds: a load
 * legitimately holds this for minutes, and a drain waiting behind one should
 * wait rather than give up.
 */
export async function withLaneLock<T>(lane: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10min'`);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}::int4, ${advisoryLockKey(lane)}::int4)`,
      );
      return fn();
    });
  } catch (err) {
    // Postgres says "canceling statement due to lock timeout", which tells an
    // operator nothing. Say what actually happened: another load held the
    // lane for longer than we were prepared to wait.
    if (/lock timeout/i.test((err as Error).message)) {
      throw new Error(
        "Waited 10 minutes for the beta lane to free up and gave up — another load " +
          "(or a batch of them) is still running. Retry once it finishes.",
      );
    }
    throw err;
  }
}

const defaultDeps: AdvanceLoadDeps = {
  claim: claimNextQueuedLoad,
  readQuestions,
  runLoad: (questions, opts) =>
    loadCodingQuestions(questions, {
      skipDuplicateCheck: opts.skipDuplicateCheck,
      onLog: (phase, message) => {
        appendLoadLog(opts.loadId, formatLogLine(phase, message)).catch((err) =>
          console.error("[Loadings] appendLoadLog failed:", (err as Error).message),
        );
      },
    }),
  finish: finishLoadRecord,
  log: (id, line) => appendLoadLog(id, line),
  withLock: withLaneLock,
};

/**
 * In-process queue kept IN FRONT of the advisory lock, not instead of it: two
 * triggers firing in the same process wait here without each holding a pooled
 * connection open to contend for the database lock. Same arrangement, and same
 * reasoning, as `advance-queue.ts`.
 */
let chain: Promise<unknown> = Promise.resolve();

export function advanceLoadQueue(overrides: Partial<AdvanceLoadDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps, ...overrides };
  const pass = () => deps.withLock(BETA_LANE, () => drain(deps));
  const run = chain.then(pass, pass);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function drain(deps: AdvanceLoadDeps): Promise<string[]> {
  const ran: string[] = [];

  while (ran.length < MAX_DRAIN_PER_PASS) {
    const record = await deps.claim();
    if (!record) break;
    ran.push(record.id);

    try {
      const questions = await deps.readQuestions(record);
      const result = await deps.runLoad(questions, {
        loadId: record.id,
        // Ids were regenerated when remarks are present, so they cannot collide
        // with anything already in beta.
        skipDuplicateCheck: Boolean(record.remarks),
      });
      const { batches } = result;
      // A load can split across several question sets and every one belongs in
      // the audit row — the registry sheet can legitimately list an id twice,
      // hence the de-dupe.
      const questionSetIds = [...new Set(batches.map((b) => b.questionSetId))];
      const orderRange = batches.length
        ? {
            start: Math.min(...batches.map((b) => b.orderStart)),
            end: Math.max(...batches.map((b) => b.orderStart + b.questionCount - 1)),
          }
        : null;
      await deps.finish(record.id, {
        status: result.success ? "completed" : "failed",
        questionSetId: questionSetIds.join(", ") || null,
        questionIds: batches.flatMap((b) => b.questionIds),
        // On failure the batch loop stops at the failed batch, so its task
        // output is the one worth linking to.
        taskOutputUrl: batches[batches.length - 1]?.taskOutputUrl ?? null,
        error: result.error ?? null,
        orderRange,
      });
    } catch (e) {
      const message = (e as Error).message;
      // Do NOT await the log write: `finish` must run even if it rejects, or a
      // transient DB blip strands the row at `running` and blocks the queue for
      // the whole stale window.
      deps
        .log(record.id, formatLogLine("error", message))
        .catch((err) => console.error("[Loadings] appendLoadLog failed:", (err as Error).message));
      await deps.finish(record.id, { status: "failed", error: message });
    }
    // A failure does NOT stop the queue: a walk-away batch should report
    // "3 loaded, 1 failed", not leave three problems never attempted.
  }

  return ran;
}
