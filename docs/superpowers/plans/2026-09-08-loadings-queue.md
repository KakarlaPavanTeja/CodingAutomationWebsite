# Coding-Question Load Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global 423 "another load is running" refusal with a database-backed waiting line, so clicking Load on several problems queues them instead of throwing all but one away.

**Architecture:** Loads stay strictly single-file — that constraint is real, because every load claims the next free order inside one shared question set and the NKB backend rejects a collision with a bare `FAILURE`. What changes is the losers' fate: a `coding_question_loads` row is born `queued` instead of `running`, and one atomic `UPDATE` promotes the oldest queued row whenever nothing live is running. The queue is drained by two triggers, neither of which is a new process: the finishing load drains the next, and `GET /api/loadings/coding-questions/[id]` — which `LoadLogPanel` already polls every 2s — drains opportunistically, which is what recovers the queue after a deploy or restart.

This mirrors the server-owned Run All queue that already exists in `src/lib/pipeline/`: a pure decision function with unit tests (`run-all-queue.ts`), a driver that reads state, asks the decision function, and acts (`advance-queue.ts`), and an in-process serialise chain carrying an explicit `ponytail:` note about its single-process ceiling. Follow that shape; do not invent a second pattern.

**Tech Stack:** Next.js 16 App Router route handlers, Drizzle ORM over Postgres (`postgres` driver), React 19 client components, `tsx --test` (Node's built-in runner) for TypeScript tests.

**Spec:** This plan is its own spec — the change was classified bounded during brainstorming (existing flow, existing files), so the design lives in the Architecture and Design Decisions sections here rather than in a separate `docs/superpowers/specs/` document.

## Global Constraints

- Next.js 16: route handler `params` is a **Promise** — `await` it. `cookies()`/`headers()` are async.
- Import alias `@/*` → `./src/*`. Use it, not long relative paths.
- Both suites must stay green: `npm run test:ts` and `npm run test:json`.
- `npm run test:ts` has **no database**. It sets a dummy `DATABASE_URL` and imports modules inside test bodies (see `src/lib/loadings/load-records.test.ts:6-12`). Every test in this plan is a pure-function test. The one statement that cannot be tested this way (the atomic claim) is written as a transcription of a tested pure function, following the `capLogText` / `appendLoadLog` precedent at `src/lib/loadings/load-records.ts:78-104`.
- `npm run db:push` targets whatever `.env.local` points at, which is **production**, and runs with `--force`. The human operator runs it, never the implementer.
- Never log secrets, tokens, or raw passwords.
- `QUESTION_SET_MAX = 50` (`src/lib/loadings/config.ts:27`). What happens on overflow depends on the registry, and `scripts/create-testing-units.mts` changed the answer: pre-created empty units are registered as slots, and since `questionSetExists` landed in `question-set.ts`, an empty-but-existing set takes the **JSON** path (`practice-set-db.ts:160`) rather than the sheet path. So a queued load overflowing set 46→50 moves into the next pre-created slot and mints nothing. A unit is minted mid-queue only when the registry runs out of slots. Either way, do not add a stop-and-ask gate — approved.
- Any fire-and-forget promise MUST end in `.catch()`. An unhandled rejection kills the Node process (Node 15+ default). This rule already appears at `src/app/api/loadings/coding-questions/route.ts:252`.

## Design Decisions

| Decision | Rationale |
|---|---|
| Status set becomes `queued \| running \| completed \| failed \| cancelled` | `queued` is the waiting line; `cancelled` is how an operator pulls a row out, and doubles as the manual unstick for a row wedged in `running`. |
| `started_at` is set **at claim time**, not at insert | `RUNNING_LOAD_STALE_MS` (30 min) is measured from `started_at`. If a row sat queued for 40 minutes and then started running, an insert-time `started_at` would make it instantly "stale" and claimable by a second drainer. |
| New column `queued_at` | FIFO ordering key. `id` is a v4 UUID and is not time-ordered, so it cannot serve. |
| New column `source_path` | The questions are NOT stored in the row. A pipeline load's questions are re-read from storage at claim time, so the row must carry the path the POST used (defaults to `forJSONPreparation/coding_questions.json`). |
| Upload-sourced loads are never queued | An uploaded file lives only in that request's memory; queueing it means persisting up to 20MB first. Uploads keep today's refusal. A dedicated upload question set (which would let uploads bypass the queue entirely) is a separate, later change. |
| The gate is keyed on a **lane**, not a global boolean | Today there is exactly one lane (`"beta"`), because every load shares one question set. Writing the gate as a lane rather than `anyRunningLoad()` is what makes the later upload-lane and parallel-loading changes additive instead of rewrites. |
| A failed load does NOT stop the queue | Operator decision: a walk-away batch should come back "3 loaded, 1 failed", not "1 loaded, 3 never tried". |
| The duplicate check runs twice | Once eagerly at POST (so you learn immediately that a question is already in beta) and once inside `loadCodingQuestions` at claim time (where it always ran). The eager one is a cheap admin lookup and is worth the repeat. |

---

### Task 1: Schema — queued/cancelled statuses and the two new columns

**Files:**
- Modify: `src/lib/db/schema.ts:178-206` (the `codingQuestionLoads` table)

**Interfaces:**
- Consumes: nothing.
- Produces: columns `queued_at` (timestamptz, not null, default now()), `source_path` (text, nullable); `status` check constraint accepting `'queued','running','completed','failed','cancelled'`; `started_at` no longer carries a default.

- [ ] **Step 1: Change the table definition**

In `src/lib/db/schema.ts`, replace the `status`, `startedAt` lines and the `statusCheck` inside `codingQuestionLoads`:

```ts
    // Born `queued`: the queue promotes exactly one row to `running` at a time
    // (see src/lib/loadings/load-queue.ts). `cancelled` is how an operator
    // pulls a waiting row out — and how a row wedged in `running` past
    // RUNNING_LOAD_STALE_MS is cleared by hand instead of waiting it out.
    status: text("status").notNull().default("queued"),
    taskOutputUrl: text("task_output_url"),
    error: text("error"),
    remarks: text("remarks"),
    logs: text("logs").notNull().default(""),
    /** FIFO key for the queue. `id` is a v4 UUID, so it cannot order rows. */
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Storage-relative path of the coding_questions.json this load reads.
     * The questions themselves are NOT stored — a queued pipeline load
     * re-reads them from storage when it is claimed, so it must remember
     * where to look. Null for uploads, which are never queued.
     */
    sourcePath: text("source_path"),
    /**
     * When the load was CLAIMED, not when it was enqueued — deliberately no
     * default. RUNNING_LOAD_STALE_MS is measured from this, so an insert-time
     * value would make a long-queued row read as instantly stale.
     */
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      "coding_question_loads_status_check",
      sql`${t.status} IN ('queued','running','completed','failed','cancelled')`,
    ),
```

Leave the `sourceCheck` constraint and every other column untouched.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Existing code still compiles — `status` is typed `string`, and nothing reads `startedAt`'s default.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(loadings): add queued/cancelled statuses and queue columns to coding_question_loads"
```

- [ ] **Step 4: HAND OFF TO THE OPERATOR — do not run this yourself**

Tell the human: the schema change is committed and needs `npm run db:push`, which goes to production. The change is additive — one widened check constraint, two new columns, one dropped default. No column is dropped and no existing row is rewritten. Existing rows get `queued_at = now()` on backfill, which is historically wrong but harmless: `queued_at` is only ever read to order rows that are currently `queued`, and every existing row is terminal.

Wait for confirmation that `db:push` succeeded before starting Task 2.

---

### Task 2: The pure queue decision

**Files:**
- Create: `src/lib/loadings/load-queue.ts`
- Test: `src/lib/loadings/load-queue.test.ts`

**Interfaces:**
- Consumes: `RUNNING_LOAD_STALE_MS` from `@/lib/loadings/load-records`.
- Produces:
  - `interface QueueRow { id: string; status: string; queuedAt: Date | null; startedAt: Date | null }`
  - `claimableFrom(rows: QueueRow[], now?: Date): QueueRow | null`
  - `queuePositionOf(rows: QueueRow[], id: string): number | null`
  - `isLiveLoad(status: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/loadings/load-queue.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  claimableFrom,
  isLiveLoad,
  queuePositionOf,
  type QueueRow,
} from "./load-queue";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-09-08T12:00:00Z");

const queued = (id: string, iso: string): QueueRow => ({
  id,
  status: "queued",
  queuedAt: at(iso),
  startedAt: null,
});

test("claimableFrom takes the oldest queued row when nothing is running", () => {
  const rows = [queued("b", "2026-09-08T11:05:00Z"), queued("a", "2026-09-08T11:00:00Z")];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("claimableFrom refuses while a load is genuinely running", () => {
  const rows: QueueRow[] = [
    { id: "r", status: "running", queuedAt: at("2026-09-08T11:50:00Z"), startedAt: at("2026-09-08T11:55:00Z") },
    queued("a", "2026-09-08T11:00:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW), null);
});

test("claimableFrom ignores a running row stale past the 30 minute window", () => {
  // Started 11:00, checked at 12:00 — presumed dead, or nothing would ever
  // run again after a crash mid-load.
  const rows: QueueRow[] = [
    { id: "dead", status: "running", queuedAt: at("2026-09-08T10:55:00Z"), startedAt: at("2026-09-08T11:00:00Z") },
    queued("a", "2026-09-08T11:10:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("claimableFrom treats a running row with no started_at as dead", () => {
  const rows: QueueRow[] = [
    { id: "odd", status: "running", queuedAt: at("2026-09-08T11:00:00Z"), startedAt: null },
    queued("a", "2026-09-08T11:10:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("claimableFrom returns null when nothing is queued", () => {
  const rows: QueueRow[] = [
    { id: "done", status: "completed", queuedAt: at("2026-09-08T11:00:00Z"), startedAt: at("2026-09-08T11:01:00Z") },
  ];
  assert.equal(claimableFrom(rows, NOW), null);
});

test("claimableFrom skips cancelled and failed rows", () => {
  const rows: QueueRow[] = [
    { id: "x", status: "cancelled", queuedAt: at("2026-09-08T10:00:00Z"), startedAt: null },
    { id: "y", status: "failed", queuedAt: at("2026-09-08T10:30:00Z"), startedAt: at("2026-09-08T10:31:00Z") },
    queued("a", "2026-09-08T11:00:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("queuePositionOf counts from 1 in queued_at order", () => {
  const rows = [
    queued("a", "2026-09-08T11:00:00Z"),
    queued("b", "2026-09-08T11:05:00Z"),
    queued("c", "2026-09-08T11:10:00Z"),
  ];
  assert.equal(queuePositionOf(rows, "a"), 1);
  assert.equal(queuePositionOf(rows, "c"), 3);
});

test("queuePositionOf ignores non-queued rows when numbering", () => {
  const rows: QueueRow[] = [
    { id: "r", status: "running", queuedAt: at("2026-09-08T10:00:00Z"), startedAt: at("2026-09-08T11:59:00Z") },
    queued("a", "2026-09-08T11:00:00Z"),
  ];
  assert.equal(queuePositionOf(rows, "a"), 1);
});

test("queuePositionOf returns null for a row that is not waiting", () => {
  const rows = [queued("a", "2026-09-08T11:00:00Z")];
  assert.equal(queuePositionOf(rows, "nope"), null);
});

test("isLiveLoad covers queued and running only", () => {
  assert.equal(isLiveLoad("queued"), true);
  assert.equal(isLiveLoad("running"), true);
  assert.equal(isLiveLoad("completed"), false);
  assert.equal(isLiveLoad("failed"), false);
  assert.equal(isLiveLoad("cancelled"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/loadings/load-queue.test.ts`
Expected: FAIL — `Cannot find module './load-queue'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/loadings/load-queue.ts`:

```ts
/**
 * Who runs next?
 *
 * Loads are strictly single-file: every one of them claims the next free
 * order inside a shared question set, and two loads claiming the same order
 * are rejected by the NKB backend with a bare FAILURE and no reason. So this
 * decides ONE thing — given every load row, may a waiting one start, and
 * which.
 *
 * Pure and database-free so it is testable without a database (this project's
 * test runner has none). `claimNextQueuedLoad` in `load-records.ts` is a
 * direct SQL transcription of `claimableFrom`; the two change together. Same
 * arrangement as `capLogText` and `appendLoadLog` in that file.
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
 * A `running` row whose `started_at` is older than the stale window is
 * presumed dead. Without this an interrupted load — deploy, restart, killed
 * process — would leave a row claiming `running` forever and nothing would
 * ever start again. A row with no `started_at` at all is dead by the same
 * argument: `started_at` is written at claim time, so its absence on a
 * `running` row means the write never landed.
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
 * The row that may start right now, or null. FIFO on `queued_at` — `id` is a
 * v4 UUID and carries no ordering.
 */
export function claimableFrom(rows: QueueRow[], now: Date = new Date()): QueueRow | null {
  if (rows.some((r) => isRunningLive(r, now))) return null;
  return rows.filter((r) => r.status === "queued").sort(byQueuedAt)[0] ?? null;
}

/**
 * 1-based place in the waiting line, or null when the row is not waiting.
 * Only `queued` rows are numbered: a running load is not "position 0", it is
 * the thing the queue is waiting behind, and the UI says so separately.
 */
export function queuePositionOf(rows: QueueRow[], id: string): number | null {
  const waiting = rows.filter((r) => r.status === "queued").sort(byQueuedAt);
  const index = waiting.findIndex((r) => r.id === id);
  return index === -1 ? null : index + 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/loadings/load-queue.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadings/load-queue.ts src/lib/loadings/load-queue.test.ts
git commit -m "feat(loadings): pure queue decision for coding-question loads"
```

---

### Task 3: Database operations — enqueue, claim, cancel, position

**Files:**
- Modify: `src/lib/loadings/load-records.ts` — extend `LoadRecord`, replace `createLoadRecord`, add four functions, delete two
- Modify: `src/lib/loadings/load-records.test.ts` — drop the `concurrentLoadRefusal` tests
- Test: `src/lib/loadings/load-records.test.ts`

**Interfaces:**
- Consumes: `claimableFrom`, `queuePositionOf` from `./load-queue` (documentation only — the SQL is the transcription).
- Produces:
  - `LoadRecord` gains `queuedAt: Date | null`, `sourcePath: string | null`
  - `enqueueLoadRecord(args: { problemId: string | null; userId: string; source: LoadSource; remarks?: string | null; sourcePath?: string | null }): Promise<string>`
  - `claimNextQueuedLoad(): Promise<LoadRecord | null>`
  - `queuePositionForLoad(id: string): Promise<number | null>`
  - `cancelLoad(id: string): Promise<"cancelled" | "not-cancellable" | "missing">`
  - `liveLoadForProblem(problemId: string): Promise<LoadRecord | null>` (replaces `runningLoadForProblem`)
- Deleted: `anyRunningLoad`, `concurrentLoadRefusal`, `createLoadRecord`, `runningLoadForProblem`.

- [ ] **Step 1: Extend the `LoadRecord` interface**

In `src/lib/loadings/load-records.ts`, add to the interface (after `logs`):

```ts
  queuedAt: Date | null;
  sourcePath: string | null;
```

- [ ] **Step 2: Replace `createLoadRecord` with `enqueueLoadRecord`**

Replace the whole `createLoadRecord` function:

```ts
/**
 * Join the waiting line. The row is `queued`, not `running` — the queue
 * promotes exactly one row at a time (see `claimNextQueuedLoad`).
 *
 * `sourcePath` is remembered because the questions are NOT stored on the row:
 * a pipeline load re-reads its coding_questions.json from storage when it is
 * claimed, which may be minutes after the POST that enqueued it.
 */
export async function enqueueLoadRecord(args: {
  problemId: string | null;
  userId: string;
  source: LoadSource;
  remarks?: string | null;
  sourcePath?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(codingQuestionLoads)
    .values({
      problemId: args.problemId,
      userId: args.userId,
      source: args.source,
      remarks: args.remarks ?? null,
      sourcePath: args.sourcePath ?? null,
      status: "queued",
    })
    .returning({ id: codingQuestionLoads.id });
  return row.id;
}
```

- [ ] **Step 3: Add the claim, the position read and the cancel**

Add after `enqueueLoadRecord`. Keep `RUNNING_LOAD_STALE_MS` where it is and reuse it:

```ts
/**
 * Promote the oldest waiting load to `running`, or return null if one is
 * already live.
 *
 * ONE STATEMENT on purpose. Two drainers firing at the same instant both pick
 * the same oldest row; Postgres row-locks it, the loser re-evaluates this
 * WHERE against the committed row (EvalPlanQual under READ COMMITTED), now
 * sees a live `running` row, and updates nothing. That is why the guard lives
 * inside the statement instead of being a `select` followed by an `update` —
 * the latter is exactly the check-then-act race the old 423 gate carried, and
 * it is the one thing here that must not be racy.
 *
 * This is a transcription of `claimableFrom` in `./load-queue.ts`, which is
 * where the rule is stated and tested. THE TWO CHANGE TOGETHER.
 *
 * Not the only guard: `advanceLoadQueue` holds a Postgres advisory lock for
 * the whole drain (see Task 4), which is what stops two app instances from
 * both promoting a row when a stale `running` row satisfies the guard for
 * both. This statement is the inner belt; the lock is the braces.
 */
export async function claimNextQueuedLoad(): Promise<LoadRecord | null> {
  const staleSeconds = Math.floor(RUNNING_LOAD_STALE_MS / 1000);
  // Drizzle's update builder with a raw WHERE, NOT `db.execute`: `.returning()`
  // hands back typed rows in the same camelCase shape as every other query in
  // this file, so there is no snake_case row to hand-map and no cast to get
  // wrong. Nothing else in this repo uses `db.execute` with a `returning`, so
  // its row shape is unproven here — don't be the first.
  //
  // `now()` for started_at, not `new Date()`: the stale window below is
  // measured against the database clock, and one clock is the only way that
  // comparison stays honest.
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
    .select({ id: codingQuestionLoads.id, queuedAt: codingQuestionLoads.queuedAt })
    .from(codingQuestionLoads)
    .where(eq(codingQuestionLoads.status, "queued"))
    .orderBy(codingQuestionLoads.queuedAt);
  const index = rows.findIndex((r) => r.id === id);
  return index === -1 ? null : index + 1;
}

/**
 * Pull a load out of the line, or clear one wedged in `running`.
 *
 * Both cases in one function on purpose: a row stuck `running` after a crash
 * blocks the whole queue for the full 30-minute stale window, and "cancel it"
 * is the same operator gesture as pulling a waiting row. A genuinely live
 * `running` row is refused — cancelling it would leave an NKB task writing to
 * beta with nothing tracking it.
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
```

- [ ] **Step 4: Replace `runningLoadForProblem` with `liveLoadForProblem`**

Find `runningLoadForProblem` and replace it (the caller in the GET handler is updated in Task 6):

```ts
/**
 * This problem's load that hasn't finished — queued OR running. Both block a
 * second load of the same problem and both are worth re-attaching a log panel
 * to, so they are one query and one concept.
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
```

Add `inArray` to the `drizzle-orm` import at the top of the file. Remove `gt` if nothing else uses it.

- [ ] **Step 5: Delete the dead gate**

Delete `anyRunningLoad` and `concurrentLoadRefusal` entirely, plus their doc comments. Delete every `concurrentLoadRefusal` test from `src/lib/loadings/load-records.test.ts`.

- [ ] **Step 6: Run the suite**

Run: `npm run test:ts`
Expected: PASS. The route handler still references the deleted functions, so also run `npx tsc --noEmit` and expect errors ONLY in `src/app/api/loadings/coding-questions/route.ts` — Task 5 fixes them.

- [ ] **Step 7: Commit**

```bash
git add src/lib/loadings/load-records.ts src/lib/loadings/load-records.test.ts
git commit -m "feat(loadings): enqueue, atomic claim, cancel and queue position"
```

---

### Task 4: The driver

**Files:**
- Create: `src/lib/loadings/advance-load-queue.ts`
- Test: `src/lib/loadings/advance-load-queue.test.ts`

**Interfaces:**
- Consumes: `claimNextQueuedLoad`, `finishLoadRecord`, `appendLoadLog`, `formatLogLine` from `./load-records`; `loadCodingQuestions` from `./load-coding-questions`; `parseCodingQuestionsPayload` from `./coding-questions-json`; `regenerateQuestionIds` from `@/components/problems/../lib/loadings/regenerate-ids` (i.e. `./regenerate-ids`); `readStorageFile` from `@/lib/storage-sync`.
- Produces:
  - `interface AdvanceLoadDeps { claim; readQuestions; runLoad; finish; log }`
  - `advanceLoadQueue(deps?: Partial<AdvanceLoadDeps>): Promise<string[]>` — ids of the loads it ran, in order
  - `DEFAULT_SOURCE_PATH = "forJSONPreparation/coding_questions.json"` (moved here from the route)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/loadings/advance-load-queue.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

// This module's import graph reaches `@/lib/db`, which throws at module load
// if DATABASE_URL is unset, and `tsx --test` does not read .env.local. Same
// dummy-value + in-body-import arrangement as load-records.test.ts.
const load = async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  return import("./advance-load-queue");
};

interface FakeLoad {
  id: string;
  source: string;
  problemId: string | null;
  sourcePath: string | null;
  remarks: string | null;
}

const record = (id: string, over: Partial<FakeLoad> = {}): FakeLoad => ({
  id,
  source: "pipeline",
  problemId: `problem-${id}`,
  sourcePath: "forJSONPreparation/coding_questions.json",
  remarks: null,
  ...over,
});

test("advanceLoadQueue drains every queued load in order", async () => {
  const { advanceLoadQueue } = await load();
  const pending = [record("a"), record("b"), record("c")];
  const finished: { id: string; status: string }[] = [];
  const ran = await advanceLoadQueue({
    claim: async () => pending.shift() ?? null,
    readQuestions: async () => [{ question_id: "q" }],
    runLoad: async () => ({ success: true, batches: [], questionCount: 1 }),
    finish: async (id, args) => void finished.push({ id, status: args.status }),
    log: async () => {},
    withLock: async (_lane, fn) => fn(),
  });
  assert.deepEqual(ran, ["a", "b", "c"]);
  assert.deepEqual(finished, [
    { id: "a", status: "completed" },
    { id: "b", status: "completed" },
    { id: "c", status: "completed" },
  ]);
});

test("advanceLoadQueue keeps going after a failed load", async () => {
  const { advanceLoadQueue } = await load();
  const pending = [record("a"), record("b")];
  const finished: { id: string; status: string }[] = [];
  const ran = await advanceLoadQueue({
    claim: async () => pending.shift() ?? null,
    readQuestions: async () => [{ question_id: "q" }],
    runLoad: async (_q, opts) => ({
      success: opts.loadId !== "a",
      batches: [],
      questionCount: 1,
      error: opts.loadId === "a" ? "backend said FAILURE" : undefined,
    }),
    finish: async (id, args) => void finished.push({ id, status: args.status }),
    log: async () => {},
    withLock: async (_lane, fn) => fn(),
  });
  assert.deepEqual(ran, ["a", "b"]);
  assert.deepEqual(finished, [
    { id: "a", status: "failed" },
    { id: "b", status: "completed" },
  ]);
});

test("advanceLoadQueue does nothing when nothing is claimable", async () => {
  const { advanceLoadQueue } = await load();
  let runs = 0;
  const ran = await advanceLoadQueue({
    claim: async () => null,
    readQuestions: async () => [],
    runLoad: async () => {
      runs += 1;
      return { success: true, batches: [], questionCount: 0 };
    },
    finish: async () => {},
    log: async () => {},
    withLock: async (_lane, fn) => fn(),
  });
  assert.deepEqual(ran, []);
  assert.equal(runs, 0);
});

test("advanceLoadQueue fails a load whose questions cannot be read, and continues", async () => {
  const { advanceLoadQueue } = await load();
  const pending = [record("gone"), record("ok")];
  const finished: { id: string; status: string; error?: string | null }[] = [];
  const ran = await advanceLoadQueue({
    claim: async () => pending.shift() ?? null,
    readQuestions: async (rec) => {
      if (rec.id === "gone") throw new Error("Output file not found");
      return [{ question_id: "q" }];
    },
    runLoad: async () => ({ success: true, batches: [], questionCount: 1 }),
    finish: async (id, args) => void finished.push({ id, status: args.status, error: args.error }),
    log: async () => {},
    withLock: async (_lane, fn) => fn(),
  });
  assert.deepEqual(ran, ["gone", "ok"]);
  assert.equal(finished[0].status, "failed");
  assert.match(String(finished[0].error), /Output file not found/);
  assert.equal(finished[1].status, "completed");
});

test("advanceLoadQueue fails an upload-sourced row instead of running it", async () => {
  const { advanceLoadQueue } = await load();
  const pending = [record("up", { source: "upload", problemId: null, sourcePath: null })];
  const finished: { status: string; error?: string | null }[] = [];
  let runs = 0;
  await advanceLoadQueue({
    claim: async () => pending.shift() ?? null,
    readQuestions: async () => [{ question_id: "q" }],
    runLoad: async () => {
      runs += 1;
      return { success: true, batches: [], questionCount: 1 };
    },
    finish: async (_id, args) => void finished.push({ status: args.status, error: args.error }),
    log: async () => {},
    withLock: async (_lane, fn) => fn(),
  });
  assert.equal(runs, 0);
  assert.equal(finished[0].status, "failed");
  assert.match(String(finished[0].error), /upload/i);
});

test("the whole drain runs inside the cross-process lock", async () => {
  // The in-process chain only covers this Node process. Two instances against
  // one database is what spawned a pipeline step twice
  // (src/lib/pipeline/advance-queue.test.ts), so nothing may claim or run a
  // load outside the lock.
  const { advanceLoadQueue, BETA_LANE } = await load();
  const pending = [record("a")];
  const lanes: string[] = [];
  let held = false;
  await advanceLoadQueue({
    withLock: async (lane, fn) => {
      lanes.push(lane);
      held = true;
      try {
        return await fn();
      } finally {
        held = false;
      }
    },
    claim: async () => {
      assert.ok(held, "a load must never be claimed outside the lock");
      return pending.shift() ?? null;
    },
    readQuestions: async () => [{ question_id: "q" }],
    runLoad: async () => {
      assert.ok(held, "a load must never run outside the lock");
      return { success: true, batches: [], questionCount: 1 };
    },
    finish: async () => {},
    log: async () => {},
  });
  assert.deepEqual(lanes, [BETA_LANE], "one lane today, and the lock is keyed on it");
});

test("advanceLoadQueue stops after MAX_DRAIN_PER_PASS to bound one pass", async () => {
  const { advanceLoadQueue, MAX_DRAIN_PER_PASS } = await load();
  let n = 0;
  const ran = await advanceLoadQueue({
    claim: async () => record(`r${n++}`),
    readQuestions: async () => [{ question_id: "q" }],
    runLoad: async () => ({ success: true, batches: [], questionCount: 1 }),
    finish: async () => {},
    log: async () => {},
    withLock: async (_lane, fn) => fn(),
  });
  assert.equal(ran.length, MAX_DRAIN_PER_PASS);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/loadings/advance-load-queue.test.ts`
Expected: FAIL — `Cannot find module './advance-load-queue'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/loadings/advance-load-queue.ts`:

```ts
/**
 * Drain the coding-question load queue.
 *
 * Claim the oldest waiting load, run it, record the outcome, repeat until
 * nothing is claimable. Modelled on `src/lib/pipeline/advance-queue.ts`, which
 * does the same job for the pipeline's Run All — same dependency-injection
 * seam so the decision flow is testable without a database, same `ponytail:`
 * note about its single-process ceiling.
 *
 * There is no worker process. This is called from two places, both of which
 * already happen: the end of a load (drains the next), and the status GET the
 * log panel polls every two seconds (recovers a queue stranded by a restart).
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

/**
 * Loads run serially and each can take minutes, so one pass is bounded rather
 * than looping until the queue is empty. The next trigger — the log panel's
 * poll, two seconds later — picks up where this left off. Without a bound, a
 * queue someone keeps adding to would hold this call open indefinitely.
 */
export const MAX_DRAIN_PER_PASS = 25;

type ClaimedLoad = Pick<LoadRecord, "id" | "problemId" | "remarks" | "sourcePath"> & {
  source?: string;
};

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
 * Re-read a queued load's questions from storage. They are deliberately not
 * stored on the row (a coding_questions.json with testcases, per-language
 * solutions and an editorial runs to megabytes), so the row carries the path
 * and this reads it at claim time.
 */
async function readQuestions(record: ClaimedLoad): Promise<CodingQuestionRow[]> {
  if (!record.problemId) {
    throw new Error(
      "An upload-sourced load cannot be queued: its file exists only in the request that " +
        "uploaded it, so there is nothing to re-read. Uploads load immediately or not at all.",
    );
  }
  const raw = await readStorageFile(
    record.problemId,
    record.sourcePath || DEFAULT_SOURCE_PATH,
    "outputs",
  );
  const parsed = parseCodingQuestionsPayload(JSON.parse(raw));
  if (!parsed?.length) {
    throw new Error(
      `No questions in ${record.sourcePath || DEFAULT_SOURCE_PATH} — the file was readable but ` +
        "held no question array.",
    );
  }
  // Remarks mean "make a deliberate second copy", which is what regenerating
  // the ids achieves. Applied here rather than at enqueue time because the
  // questions themselves are only read now.
  return record.remarks ? regenerateQuestionIds(parsed) : parsed;
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
  withLock: withAdvisoryLock,
};

// Namespace half of the advisory-lock key so a `pg_advisory_lock` taken by any
// other feature (or by Drizzle Kit) cannot collide. `advance-queue.ts` uses
// 0x6370 ("cp") for the pipeline; this is a DIFFERENT namespace, because the
// two queues must never wait on each other.
const ADVISORY_LOCK_NAMESPACE = 0x6c64; // "ld"

/** One lane today: every load shares one question set, so all of them queue. */
export const BETA_LANE = "beta";

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
 * Hold the lane's lock IN POSTGRES for the whole drain, so two app instances
 * cannot both claim. Copied deliberately from `withAdvisoryLock` in
 * `src/lib/pipeline/advance-queue.ts:125`, which exists because in-process
 * chaining alone demonstrably failed there — one problem got two live
 * processes 300ms apart. Do not assume this app is single-instance.
 *
 * The transaction exists only to scope the lock: `_xact_` releases it on
 * commit OR rollback, so a throwing drain cannot strand it. The drain's own
 * reads and writes run on other pooled connections, so this tx takes no row
 * locks and cannot deadlock against them. `lock_timeout` bounds the wait — a
 * drain that cannot get in raises instead of holding a connection forever,
 * and the next trigger (a load close, or the log panel's poll two seconds
 * later) retries.
 *
 * 10 minutes, not 30 seconds: a load runs for minutes while holding this, and
 * a queued drain waiting behind it should wait, not give up.
 */
async function withAdvisoryLock<T>(lane: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10min'`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}::int4, ${advisoryLockKey(lane)}::int4)`,
    );
    return fn();
  });
}

/**
 * In-process queue kept IN FRONT of the advisory lock, not instead of it: two
 * triggers firing in the same process wait here without each holding a pooled
 * connection open to contend for the database lock. Same arrangement, and same
 * reasoning, as `advance-queue.ts:145`.
 */
let chain: Promise<unknown> = Promise.resolve();

export function advanceLoadQueue(overrides: Partial<AdvanceLoadDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps, ...overrides };
  const run = chain.then(
    () => deps.withLock(BETA_LANE, () => drain(deps)),
    () => deps.withLock(BETA_LANE, () => drain(deps)),
  );
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
        // Ids were just regenerated, so they cannot collide with beta.
        skipDuplicateCheck: Boolean(record.remarks),
      });
      const { batches } = result;
      // A load can split across several question sets and every one belongs in
      // the audit row — the registry sheet can legitimately list an id twice,
      // hence the de-dupe. Lifted from the route handler this replaces.
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
      // transient DB blip strands the row at `running` and blocks the queue
      // for the full stale window.
      deps
        .log(record.id, formatLogLine("error", message))
        .catch((err) => console.error("[Loadings] appendLoadLog failed:", (err as Error).message));
      await deps.finish(record.id, { status: "failed", error: message });
    }
    // A failure does NOT stop the queue — the operator's decision: a
    // walk-away batch should report "3 loaded, 1 failed", not leave three
    // problems never attempted.
  }

  return ran;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/loadings/advance-load-queue.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadings/advance-load-queue.ts src/lib/loadings/advance-load-queue.test.ts
git commit -m "feat(loadings): queue driver that claims, runs and drains loads"
```

---

### Task 5: POST handler — enqueue instead of refuse

**Files:**
- Modify: `src/app/api/loadings/coding-questions/route.ts` — imports, the `DEFAULT_PATH` constant, the gates block (currently lines ~222-246), and the whole fire-and-forget block (currently lines ~254-303)

**Interfaces:**
- Consumes: `enqueueLoadRecord`, `latestLoadForProblem` from `@/lib/loadings/load-records`; `advanceLoadQueue`, `DEFAULT_SOURCE_PATH` from `@/lib/loadings/advance-load-queue`; `findAlreadyLoadedQuestions`, `alreadyLoadedMessage` from `@/lib/loadings/question-set`.
- Produces: POST returns `202` with `{ loadId, queuePosition }` for a queued pipeline load, and keeps `200 { loadId }` for an immediate upload load. The `423` response is gone.

- [ ] **Step 1: Fix the imports and reuse the shared path constant**

Replace the `load-records` import block with:

```ts
import {
  appendLoadLog,
  enqueueLoadRecord,
  finishLoadRecord,
  formatLogLine,
  latestAttemptForProblem,
  latestLoadForProblem,
  liveLoadForProblem,
  queuePositionForLoad,
  type LoadSource,
} from "@/lib/loadings/load-records";
import { advanceLoadQueue, DEFAULT_SOURCE_PATH } from "@/lib/loadings/advance-load-queue";
import { alreadyLoadedMessage, findAlreadyLoadedQuestions } from "@/lib/loadings/question-set";
import { readQuestionId } from "@/lib/loadings/coding-questions-json";
```

Delete the local `const DEFAULT_PATH = "forJSONPreparation/coding_questions.json";` and replace its one use (`String(body.path ?? "").trim() || DEFAULT_PATH`) with `DEFAULT_SOURCE_PATH`. Keep `safePath` in a variable — Step 3 stores it on the row.

- [ ] **Step 2: Replace the 423 gate with the eager duplicate check**

Delete the entire `const refusal = concurrentLoadRefusal(...)` block and its comment, and put this in its place:

```ts
  // Two gates remain, and neither is about concurrency any more — a second
  // load no longer races the first, it queues behind it (see
  // `src/lib/loadings/advance-load-queue.ts`).
  //
  //   409 — this problem already has a COMPLETED load. Lifted by remarks,
  //         which is what regenerates the ids for a deliberate second copy.
  //   409 — this problem already has a load QUEUED or RUNNING. Not lifted by
  //         remarks: two loads of the same problem would put the same
  //         questions into beta twice, whatever their ids.
  const live = problemId ? await liveLoadForProblem(problemId) : null;
  if (live) {
    return NextResponse.json(
      {
        error:
          `This problem already has a load ${live.status === "queued" ? "waiting in the queue" : "running"} ` +
          `(id ${live.id}). Watch that one rather than starting a second.`,
        loadId: live.id,
      },
      { status: 409 },
    );
  }

  if (problemId && !remarks) {
    const last = await latestLoadForProblem(problemId);
    if (last) {
      return NextResponse.json(last, { status: 409 });
    }
  }

  // Fail fast on ids beta already holds, BEFORE queueing. `loadCodingQuestions`
  // runs this same check when the load is actually claimed — this earlier copy
  // exists so a duplicate is reported on the click rather than discovered
  // minutes later when the queue reaches it. A flaky scrape must not block a
  // legitimate load, so a failed lookup continues.
  if (!remarks) {
    try {
      const existing = await findAlreadyLoadedQuestions(
        questions.map(readQuestionId).filter(Boolean),
      );
      if (existing.length) {
        return NextResponse.json({ error: alreadyLoadedMessage(existing) }, { status: 409 });
      }
    } catch (err) {
      console.warn("[Loadings] pre-queue duplicate check failed:", (err as Error).message);
    }
  }
```

Note that `regenerateQuestionIds` is NO LONGER called here — the driver applies it at claim time, when it re-reads the questions. Delete the `if (remarks) { questions = regenerateQuestionIds(questions); }` block and its import.

- [ ] **Step 3: Replace the fire-and-forget block with an enqueue plus a kick**

Delete everything from `const loadId = await createLoadRecord(...)` to the final `return NextResponse.json({ loadId });`, and put this in its place:

```ts
  const loadId = await enqueueLoadRecord({
    problemId,
    userId,
    source,
    remarks,
    // Only a pipeline load is re-readable, so only it carries a path. An
    // upload's questions live in this request alone.
    sourcePath: isUpload ? null : sourcePath,
  });

  if (isUpload) {
    // Uploads do not queue: nothing can re-read the file later, so this one
    // runs inline in the background, exactly as it did before the queue.
    void (async () => {
      try {
        const result = await loadCodingQuestions(
          remarks ? regenerateQuestionIds(questions) : questions,
          {
            skipDuplicateCheck: Boolean(remarks),
            onLog: (phase, message) => {
              appendLoadLog(loadId, formatLogLine(phase, message)).catch((err) =>
                console.error("[Loadings] appendLoadLog failed:", (err as Error).message),
              );
            },
          },
        );
        const { batches } = result;
        const questionSetIds = [...new Set(batches.map((b) => b.questionSetId))];
        const orderRange = batches.length
          ? {
              start: Math.min(...batches.map((b) => b.orderStart)),
              end: Math.max(...batches.map((b) => b.orderStart + b.questionCount - 1)),
            }
          : null;
        await finishLoadRecord(loadId, {
          status: result.success ? "completed" : "failed",
          questionSetId: questionSetIds.join(", ") || null,
          questionIds: batches.flatMap((b) => b.questionIds),
          taskOutputUrl: batches[batches.length - 1]?.taskOutputUrl ?? null,
          error: result.error ?? null,
          orderRange,
        });
      } catch (e) {
        const message = (e as Error).message;
        appendLoadLog(loadId, formatLogLine("error", message)).catch((err) =>
          console.error("[Loadings] appendLoadLog failed:", (err as Error).message),
        );
        await finishLoadRecord(loadId, { status: "failed", error: message });
      }
    })().catch((err) => {
      console.error("[Loadings] background upload load failed:", (err as Error).message);
    });
    return NextResponse.json({ loadId });
  }

  const queuePosition = await queuePositionForLoad(loadId);

  // Kick the queue. Deliberately not awaited — a load runs for minutes and the
  // client polls GET .../[id]. The terminal .catch() is mandatory: an
  // unhandled rejection in a fire-and-forget promise kills the whole Node
  // process, not just this request (Node 15+ default).
  void advanceLoadQueue().catch((err) => {
    console.error("[Loadings] queue drain failed:", (err as Error).message);
  });

  return NextResponse.json({ loadId, queuePosition }, { status: 202 });
```

An upload's row is inserted `queued` by `enqueueLoadRecord` and then immediately driven by this inline runner, which `finishLoadRecord` moves to a terminal state. It is never claimed by the queue because `claimNextQueuedLoad` would only reach it after every earlier row, and the driver fails an upload row loudly if it ever does — that guard is the test in Task 4 Step 1.

> **Correction to make while you are here:** an upload row sitting `queued` for the moments before its inline runner starts WOULD be claimable by a concurrent drain. Set uploads to `running` on insert instead: add `status: "running"` and `startedAt: new Date()` to a second `enqueueLoadRecord` call signature, or simplest — pass `source: "upload"` and have `enqueueLoadRecord` insert `status: args.source === "upload" ? "running" : "queued"` with `startedAt` set in the upload case. Do the latter; it keeps one function and states the rule where the row is written.

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm run test:ts`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/loadings/coding-questions/route.ts src/lib/loadings/load-records.ts
git commit -m "feat(loadings): POST enqueues instead of refusing a concurrent load"
```

---

### Task 6: GET handlers — report queue state and drain opportunistically

**Files:**
- Modify: `src/app/api/loadings/coding-questions/route.ts` (the `GET` handler, ~lines 62-98)
- Modify: `src/app/api/loadings/coding-questions/[id]/route.ts` (add the drain kick and the queue position)

**Interfaces:**
- Consumes: `liveLoadForProblem`, `queuePositionForLoad` from `@/lib/loadings/load-records`; `advanceLoadQueue` from `@/lib/loadings/advance-load-queue`.
- Produces: the problem-scoped GET returns `liveLoad` (replacing `runningLoad`) plus `queuePosition`; the by-id GET returns the record plus `queuePosition`.

- [ ] **Step 1: Update the problem-scoped GET**

Replace the `runningLoad` lines and the response object:

```ts
  // A load in flight is invisible in both rows above (`lastLoad` is
  // completed-only, a queued/running attempt is neither completed nor failed),
  // which is what let a remounted panel read "never loaded" and start a second
  // one. Reporting it lets the UI refuse to start another AND re-attach its
  // log panel after a tab switch or a page reload.
  const liveLoad = await liveLoadForProblem(safeProblemId);
  return NextResponse.json({
    configured: missing.length === 0,
    missing,
    lastLoad,
    lastFailedLoad,
    liveLoad,
    queuePosition: liveLoad ? await queuePositionForLoad(liveLoad.id) : null,
  });
```

- [ ] **Step 2: Update the by-id GET**

In `src/app/api/loadings/coding-questions/[id]/route.ts`, replace the final `return NextResponse.json(record);` with:

```ts
  // The log panel polls this every two seconds, which makes it the cheapest
  // available queue heartbeat: if a deploy or crash stranded a queue with
  // nothing running, this is what restarts it. Not awaited — this request
  // answers with what it already read, and the terminal .catch() is mandatory
  // (an unhandled rejection here would kill the process).
  void advanceLoadQueue().catch((err) => {
    console.error("[Loadings] queue drain failed:", (err as Error).message);
  });

  return NextResponse.json({
    ...record,
    queuePosition: record.status === "queued" ? await queuePositionForLoad(record.id) : null,
  });
```

Add the two imports at the top of that file.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/components/problems/LoadToBeta.tsx` (it still reads `data.runningLoad`). Task 8 fixes them.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/loadings/coding-questions/route.ts src/app/api/loadings/coding-questions/\[id\]/route.ts
git commit -m "feat(loadings): expose queue position and drain the queue from the status poll"
```

---

### Task 7: Cancel endpoint

**Files:**
- Modify: `src/app/api/loadings/coding-questions/[id]/route.ts` — add a `DELETE` handler

**Interfaces:**
- Consumes: `cancelLoad`, `getLoadRecord` from `@/lib/loadings/load-records`; `requireProblemManageAccess` from `@/lib/auth/ownership`.
- Produces: `DELETE /api/loadings/coding-questions/[id]` → `200 { status: "cancelled" }`, `409` when not cancellable, `404` when missing or not the caller's.

- [ ] **Step 1: Add the handler**

Append to `src/app/api/loadings/coding-questions/[id]/route.ts`:

```ts
/**
 * Pull a load out of the queue, or clear one wedged in `running`.
 *
 * Authorised like a load START, not like a read: a problem-sourced load needs
 * MANAGE access (cancelling changes what reaches shared beta), and an
 * upload-sourced one is restricted to its owner or an admin. `GET` above
 * deliberately uses the weaker `requireProblemAccess` — do not copy it here.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const { id } = await params;
  let safeId: string;
  try {
    safeId = assertSafeProblemId(id);
  } catch {
    return notFound();
  }

  const record = await getLoadRecord(safeId);
  if (!record) return notFound();

  if (record.problemId) {
    const problemAuth = await requireProblemManageAccess(record.problemId);
    if (problemAuth.error) return problemAuth.error;
  } else {
    const isOwner = record.userId === auth.session.userId;
    const isAdmin = auth.session.profile.role === "admin";
    if (!isOwner && !isAdmin) return notFound();
  }

  const outcome = await cancelLoad(safeId);
  if (outcome === "missing") return notFound();
  if (outcome === "not-cancellable") {
    return NextResponse.json(
      {
        error:
          `This load is ${record.status} and cannot be cancelled. A running load is left alone ` +
          "on purpose: an NKB task is writing to beta and cancelling the row would only lose " +
          "track of it. It becomes cancellable once it has made no progress for 30 minutes.",
      },
      { status: 409 },
    );
  }

  // Cancelling a queued row frees the line immediately — drain rather than
  // waiting for the next poll.
  void advanceLoadQueue().catch((err) => {
    console.error("[Loadings] queue drain failed:", (err as Error).message);
  });

  return NextResponse.json({ status: "cancelled" });
}
```

Add `requireProblemManageAccess` and `cancelLoad` to that file's imports.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: same `LoadToBeta.tsx` errors as before, nothing new.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/loadings/coding-questions/\[id\]/route.ts
git commit -m "feat(loadings): cancel a queued or wedged load"
```

---

### Task 8: The load panel understands waiting

**Files:**
- Modify: `src/components/problems/LoadLogPanel.tsx` — `LoadRecord` type, the poll's terminal test, the status line, a cancel button
- Modify: `src/components/problems/LoadToBeta.tsx` — `runningLoad` → `liveLoad`, delete the 423 branch
- Modify: `src/components/problems/load-anyway.ts` — rename the `loadRunning` parameter's meaning in its doc comment
- Test: `src/components/problems/load-anyway.test.ts`

**Interfaces:**
- Consumes: the `202 { loadId, queuePosition }` and `409 { error, loadId }` shapes from Task 5; `liveLoad` / `queuePosition` from Task 6.
- Produces: no new exports. `LoadRecord.status` gains `"queued" | "cancelled"`; `LoadRecord` gains `queuePosition?: number | null`.

- [ ] **Step 1: Stop the poll from treating `queued` as terminal**

This is the bug that would otherwise ship silently: the panel stops polling the moment `status !== "running"`, so a queued load would report "Load failed" and never update.

In `src/components/problems/LoadLogPanel.tsx`, add to the type:

```ts
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  queuePosition?: number | null;
```

and replace the terminal test inside `poll`:

```ts
          setRecord(data);
          // `queued` is NOT terminal — it is the load waiting its turn. Only
          // stop polling once it can no longer change.
          if (data.status !== "running" && data.status !== "queued") {
            onDoneRef.current?.(data);
            return;
          }
```

- [ ] **Step 2: Say what waiting looks like, and offer the way out**

Replace the status paragraph:

```ts
      <p className="text-xs text-muted-foreground">
        {pollError
          ? pollError
          : status === "queued"
            ? record?.queuePosition && record.queuePosition > 1
              ? `Waiting in the queue — ${record.queuePosition - 1} load(s) ahead. Loads run one at a time.`
              : "Waiting in the queue — starts as soon as the load ahead finishes."
            : status === "running"
              ? "Loading… this can take several minutes."
              : status === "completed"
                ? "Load complete."
                : status === "cancelled"
                  ? "Load cancelled."
                  : "Load failed."}
      </p>

      {status === "queued" && (
        <Button
          size="sm"
          variant="outline"
          disabled={cancelling}
          onClick={async () => {
            setCancelling(true);
            try {
              const res = await fetch(
                `/api/loadings/coding-questions/${encodeURIComponent(loadId)}`,
                { method: "DELETE" },
              );
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setPollError(String(data.error || `Could not cancel (HTTP ${res.status}).`));
              }
            } finally {
              setCancelling(false);
            }
          }}
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </Button>
      )}
```

Add `const [cancelling, setCancelling] = useState(false);` alongside the other state, and import `Button` from `@/components/ui/button`. The next poll picks up the `cancelled` status and stops on its own — do not also set state optimistically.

- [ ] **Step 3: Rewire `LoadToBeta`**

In `src/components/problems/LoadToBeta.tsx`:

- Rename the state: `const [liveLoad, setLiveLoad] = useState<LoadRecord | null>(null);` and every read of `runningLoad`.
- In the mount effect, read `data.liveLoad` instead of `data.runningLoad`.
- Delete the whole `if (res.status === 423) { … }` block from `submit`.
- Extend the `409` branch: the body is either a prior `LoadRecord` (completed-duplicate) or `{ error, loadId }` (already queued/running). Replace it with:

```ts
      if (res.status === 409) {
        const loadId = (data.loadId as string | undefined) ?? null;
        if (loadId && data.error) {
          // Already queued or running for this problem — watch that one
          // rather than starting a rival.
          setActiveLoadId(loadId);
          setReattached(true);
          setSubmitError(String(data.error));
          return;
        }
        if (data.error) {
          // Already in beta, caught by the pre-queue duplicate check.
          setSubmitError(String(data.error));
          return;
        }
        // The body IS the prior LoadRecord: refresh the banner instead of
        // treating this as a generic error.
        setLastLoad(data as LoadRecord);
        setLastFailedLoad(null);
        setSubmitError(
          'A load already exists for this problem. Check "Load anyway", add remarks, and retry to load a new copy.',
        );
        return;
      }
```

- Update the two operator-facing strings that still promise immediacy:
  - the `reattached` line → `"A load for this problem is already in the queue or running — this is its log. Starting another is blocked until it finishes."`
  - the idle hint → replace `"A load for this problem is already running — wait for it to finish."` with `"A load for this problem is already queued or running — wait for it to finish."`, and append to the long hint: `" Loads run one at a time, so this may wait behind others before it starts."`

- [ ] **Step 4: Update `canSubmitLoad`'s documentation and test names**

The function body does not change — `loadRunning` already means "do not start another". Only its meaning widens from running to queued-or-running. In `src/components/problems/load-anyway.ts`, rename the parameter to `loadLive` and update the doc comment's "the server refuses the same case with 423" to "the server refuses the same case with 409". Update `src/components/problems/load-anyway.test.ts` to match the new parameter name.

- [ ] **Step 5: Typecheck, lint and run the suite**

Run: `npx tsc --noEmit && npm run lint && npm run test:ts`
Expected: all PASS, zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/problems/LoadLogPanel.tsx src/components/problems/LoadToBeta.tsx src/components/problems/load-anyway.ts src/components/problems/load-anyway.test.ts
git commit -m "feat(loadings): show queue position and offer cancel in the load panel"
```

---

### Task 9: Load several problems from the list

**Files:**
- Modify: `src/app/problems/page.tsx` — a checkbox column and a "Load N to beta" button

**Interfaces:**
- Consumes: `POST /api/loadings/coding-questions?problemId=…` returning `202 { loadId, queuePosition }`.
- Produces: no new exports.

This task contains no orchestration, and that is the point: the queue already sequences the loads, so the button is N independent POSTs. Do not add a batch endpoint, a combined progress tracker, or client-side sequencing.

- [ ] **Step 1: Add selection state and the loadable predicate**

In `ProblemsPage`, alongside the existing `showAll` state:

```ts
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState(false);
  const [queueResult, setQueueResult] = useState<string>("");

  // Only a problem that finished its pipeline has a coding_questions.json to
  // load. Offering the checkbox on a draft would just queue a load that fails
  // its file read minutes later.
  const isLoadable = (status: string) => status === "completed" || status === "partial";

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
```

- [ ] **Step 2: Add the button above the table**

Render it immediately before the table's wrapper `div`, so it is visible without scrolling:

```tsx
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border bg-card px-4 py-3">
          <Button
            size="sm"
            disabled={queueing}
            onClick={async () => {
              setQueueing(true);
              setQueueResult("");
              const ids = [...selected];
              const results = await Promise.all(
                ids.map(async (id) => {
                  try {
                    const res = await fetch(
                      `/api/loadings/coding-questions?problemId=${encodeURIComponent(id)}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}",
                      },
                    );
                    return res.ok;
                  } catch {
                    return false;
                  }
                }),
              );
              const ok = results.filter(Boolean).length;
              setQueueResult(
                `${ok} of ${ids.length} queued. Loads run one at a time — open a problem to watch its log.` +
                  (ok < ids.length
                    ? " The rest were rejected: already loaded, already queued, or nothing prepared to load."
                    : ""),
              );
              setSelected(new Set());
              setQueueing(false);
              refresh();
            }}
          >
            {queueing ? "Queueing…" : `Load ${selected.size} to beta`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <p className="text-xs text-muted-foreground">
            Queued loads run one after another, so a batch of four takes several minutes.
          </p>
        </div>
      )}

      {queueResult && (
        <p className="mb-3 rounded-md border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          {queueResult}
        </p>
      )}
```

- [ ] **Step 3: Add the checkbox column**

Add a header cell as the FIRST `<th>`:

```tsx
                  <th className="w-8 px-4 py-3" />
```

and as the first `<td>` of each row:

```tsx
                      <td className="px-4 py-3">
                        {isLoadable(p.status) && (
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={() => toggle(p.id)}
                            aria-label={`Select ${p.name} for loading`}
                          />
                        )}
                      </td>
```

Import `Checkbox` from `@/components/ui/checkbox`.

- [ ] **Step 4: Verify in the running app**

Run: `npm run dev`
Then: open `http://localhost:5001/problems`, tick two completed problems, click "Load 2 to beta". Expected: the banner reports `2 of 2 queued`; opening the first problem shows its log panel running; opening the second shows "Waiting in the queue — 1 load(s) ahead" with a Cancel button.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/app/problems/page.tsx
git commit -m "feat(problems): select several problems and queue them all to beta"
```

---

## Task 10: Verify the claim under a real race — by hand

**Files:** none. This is the check the test suite structurally cannot perform.

- [ ] **Step 1: Point a scratch database at the app**

```bash
DRIZZLE_DATABASE_URL=postgres://…scratch… npm run db:push
```

`DRIZZLE_DATABASE_URL` is the ONLY variable that overrides `.env.local` here — `drizzle.config.ts` loads `.env.local` with `override: true`, so prefixing `DATABASE_URL=` is silently ignored and would push to production.

- [ ] **Step 2: Insert three queued rows and claim concurrently**

Write a throwaway script under the scratchpad that inserts three `queued` rows, then fires five `claimNextQueuedLoad()` calls with `Promise.all`, and prints how many returned non-null.

Expected: exactly **1** non-null. Then run it again: expected 1 again (the second-oldest row), because the first claim left a live `running` row — no, it will return 0, since the row claimed in the first pass is still `running` and within the stale window. Confirm 0, then set that row's `status` to `completed` and confirm the next pass claims exactly 1.

- [ ] **Step 3: Record the result**

Add the observed counts as a comment above `claimNextQueuedLoad` in `src/lib/loadings/load-records.ts`, dated, in the same style as the `LINK_FILE_JSON_LOADING` comment that records its three beta runs. That comment is the only durable evidence this was verified.

- [ ] **Step 4: Delete the script and commit the comment**

```bash
git add src/lib/loadings/load-records.ts
git commit -m "docs(loadings): record the verified claim behaviour under concurrent drains"
```

---

## Self-Review

**Coverage.** Every decision in the Design Decisions table maps to a task: statuses and columns → 1; the FIFO rule → 2; claim/cancel/position → 3; re-reading questions, regeneration timing and continue-on-failure → 4; enqueue, the eager duplicate check, uploads staying inline → 5; queue visibility and restart recovery → 6; cancel surface → 7; the queued-is-not-terminal poll fix → 8; multi-select → 9; the untestable claim → 10.

**Known gaps, stated rather than hidden.**
1. There is one lane, named but not stored. `BETA_LANE` is a constant and `claimNextQueuedLoad` has no `lane` filter, because today every load shares one question set. When the upload lane or parallel loading arrives, the column is added, the claim grows a `where lane = …`, and `advanceLoadQueue` takes the lane as an argument — the advisory lock is already keyed on it. Nothing else in this plan changes. That is the whole reason the lane is a named constant instead of an implicit assumption.
2. Task 5 Step 3 carries a correction inline (uploads must insert as `running`, not `queued`). Apply the correction; do not implement the first version and then fix it.
3. `LoadLogPanel`'s cancel button appears only for `queued`. A wedged `running` row is cancellable by the API after 30 minutes but has no button. Deliberate: the button would be disabled and confusing for the 30 minutes that matter. Revisit if wedged rows turn out to be common.
4. The queue amplifies the planner's admin scrapes. `planQuestionSetBatches` walks the registry and now calls `questionSetExists` as well as `lookupQuestionSetQuestions` per row until it finds room (`practice-set-db.ts:144-176`), and it runs once per load. With ~50 pre-created slots and most of them full, a late load costs ~50 scrapes, and a queue of ten costs ~500. Nothing breaks — it is slow, and it is slow serially, which is the queue's whole shape. If a batch starts feeling glacial, cache the registry sweep for the duration of one drain pass; that is a change to the driver, not to anything in Tasks 1-3.
5. No test covers the two GET handlers or the DELETE handler — this project has no route-handler test harness, and adding one is out of scope. Task 9 Step 4's manual walkthrough is what exercises them.

**Type consistency.** `liveLoadForProblem` (not `runningLoadForProblem`) is used in Tasks 3, 5, 6. `enqueueLoadRecord` (not `createLoadRecord`) in Tasks 3, 5. `advanceLoadQueue` in Tasks 4, 5, 6, 7. `DEFAULT_SOURCE_PATH` is defined in Task 4 and consumed in Task 5. `queuePositionForLoad` (DB, Task 3) is distinct from `queuePositionOf` (pure, Task 2) — both exist on purpose and the names differ so a reader cannot confuse them.
