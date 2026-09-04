# Server-side "Run all steps" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Run all steps" survive a page refresh, a closed tab, or a sleeping laptop, by moving the queue and the decision to advance it out of the browser and onto the server.

**Architecture:** Persist the queue on `pipeline_states`. Reuse the EXISTING pure decision helpers unchanged. Advance the queue from the `proc.on("close")` handler that already marks a step finished server-side. Reduce the client to an observer.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM over Postgres, TypeScript strict, Node's built-in test runner (`npm run test:ts`).

**Spec:** `docs/superpowers/specs/2026-09-04-server-side-run-all-design.md`

## Global Constraints

- **Reuse the existing pure helpers; do NOT reimplement them.** `isStepReadyForRunAll` and `getIncompletePrerequisites` (`src/lib/pipeline-prerequisites.ts`), `getWorkflowSteps` / `getPipelineUiWorkflowSteps` / `getStepConfig` (`src/lib/pipeline-config.ts`), `isQuestionPhaseComplete` (`src/lib/pipeline-question.ts`), `packagingTitleResolvable` / `titleGatedSteps` (`src/lib/pipeline-title.ts`). They are already pure and server-importable.
- **Five behaviours from `pipeline-context.tsx:2116-2192` must be preserved exactly.** Each was arrived at by fixing a real bug and the file carries comments saying so:
  1. Independent siblings launch CONCURRENTLY, not one at a time.
  2. A queued step is dropped only when a prerequisite terminally failed AND is not itself queued/launching/running — a prerequisite still on the queue counts as "being retried".
  3. Non-blocking steps are DROPPED on failure, never retried, so the queue drains.
  4. Title-gated steps are marked `skipped` with a reason, never silently dropped.
  5. No double-launch across the async gap between deciding and observing `running`.
- Sub-step runs are persisted in `pipeline_runs` as `parent__child` step ids (`generate_question__titles`, `split_code__cpp`). This is the only server-side source of sub-step state.
- Next.js 16: route handler `params` is a Promise (`await` it); `cookies()`/`headers()` are async; middleware is `src/proxy.ts`.
- Auth: reuse `requireProblemAccess` / `requireProblemManageAccess` / `requireAuthApi`. Never re-implement an auth check. The in-process orchestrator runs with no session and must NOT call its own HTTP endpoints.
- Import alias `@/*` → `./src/*`. Tests live beside the code, run under `npm run test:ts`.
- `npm run db:push` targets whatever `.env.local` points at, which is production. Use `DRIZZLE_DATABASE_URL=… npm run db:push` for anything else. Ask before pushing.
- Do not change what any individual step does, or the Python pipeline.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/pipeline/step-states-from-runs.ts` (create) | Project `pipeline_runs` rows into the `Map<StepId, StepState>` the helpers expect |
| `src/lib/pipeline/run-all-queue.ts` (create) | The pure decision: given a queue + step states, what launches now, what stays, what drops |
| `src/lib/db/schema.ts` (modify) | Add `runAllQueue` to `pipelineStates` |
| `src/lib/pipeline/queue-store.ts` (create) | Read/write the persisted queue |
| `src/app/api/pipeline/run/start-step.ts` (create) | The spawn, extracted so the route AND the orchestrator can call it in-process |
| `src/app/api/pipeline/run/route.ts` (modify) | Use the extracted launcher; advance the queue on close |
| `src/lib/pipeline/advance-queue.ts` (create) | Orchestrator: on step close, decide and launch |
| `src/lib/pipeline/reconcile-runs.ts` (create) | Mark `running` rows whose pid is dead as failed, then advance |
| `src/app/api/pipeline/run-all/route.ts` (create) | POST start a queue; GET its state |
| `src/lib/pipeline-context.tsx` (modify) | Drop the client queue and its effect; observe the server |

---

### Task 1: Project pipeline_runs into StepStates

**Files:**
- Create: `src/lib/pipeline/step-states-from-runs.ts`
- Test: `src/lib/pipeline/step-states-from-runs.test.ts`

**Interfaces:**
- Consumes: `StepState`, `StepId` from `@/types/pipeline`
- Produces: `stepStatesFromRuns(rows: RunRow[]): Map<StepId, StepState>`, `type RunRow`

The decision helpers take `Map<StepId, StepState>`. The server has `pipeline_runs` rows. This builds one from the other. `logs` is not needed for a readiness decision, so it is always `[]`.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { stepStatesFromRuns } from "./step-states-from-runs";

const row = (stepId: string, status: string, finishedAt: string | null = null) => ({
  stepId, status, exitCode: status === "completed" ? 0 : null,
  startedAt: new Date("2026-09-04T10:00:00Z"),
  finishedAt: finishedAt ? new Date(finishedAt) : null,
});

test("keeps only the newest run per step id", () => {
  const states = stepStatesFromRuns([
    { ...row("generate_question", "failed"), startedAt: new Date("2026-09-04T09:00:00Z") },
    { ...row("generate_question", "completed"), startedAt: new Date("2026-09-04T11:00:00Z") },
  ]);
  assert.equal(states.get("generate_question")?.status, "completed");
});

test("routes a parent__child row into the parent's subStepRuns", () => {
  const states = stepStatesFromRuns([
    row("generate_question", "running"),
    row("generate_question__titles", "completed"),
  ]);
  const gq = states.get("generate_question");
  assert.equal(gq?.status, "running");
  assert.equal(gq?.subStepRuns?.titles?.status, "completed");
});

test("routes a language sub-run into languageSubRuns", () => {
  const states = stepStatesFromRuns([
    row("split_code", "running"),
    row("split_code__python", "completed"),
  ]);
  assert.equal(states.get("split_code")?.languageSubRuns?.python?.status, "completed");
});

test("a step with no run row is absent, not invented", () => {
  const states = stepStatesFromRuns([row("generate_question", "completed")]);
  assert.equal(states.has("generate_testcases"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/pipeline/step-states-from-runs.test.ts`
Expected: FAIL — cannot find module `./step-states-from-runs`

- [ ] **Step 3: Read how the client builds StepStates today, then implement**

BEFORE writing: read `src/lib/pipeline-context.tsx` around line 924 (`/api/pipeline/run/status?problemId=`) to see how the CLIENT turns run rows into step states today, and mirror its rules — particularly which `status` strings it uses and how it decides `subStepRuns` keys. Your projection must agree with the client's, or the server and the browser will disagree about what is complete. Record in your report where the client does this and any rule you had to copy.

Split a `step_id` on `__`: no separator means a top-level step; a separator means the suffix is a sub-step key on the parent. Whether a suffix is a language or a question sub-step is decided by the parent's config — check `getStepConfig(parent)` rather than guessing from the suffix text.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/pipeline/step-states-from-runs.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/step-states-from-runs.ts src/lib/pipeline/step-states-from-runs.test.ts
git commit -m "feat(pipeline): project run rows into step states"
```

---

### Task 2: The queue decision, as a pure function

**Files:**
- Create: `src/lib/pipeline/run-all-queue.ts`
- Test: `src/lib/pipeline/run-all-queue.test.ts`

**Interfaces:**
- Consumes: Task 1's `stepStatesFromRuns`; the existing pure helpers
- Produces: `decideQueue(input: QueueInput): QueueDecision` where `QueueDecision = { launch: StepId[]; remaining: StepId[]; skip: Array<{ id: StepId; reason: string }> }`

This is the port of `pipeline-context.tsx:2116-2192`. **Read that effect in full before writing.** It is the heart of this plan; every one of the five Global Constraint behaviours lives in it.

`launchingStepsRef` has no server equivalent — the server's "already launching" set is passed in by the caller (Task 5), which knows what it just spawned.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { decideQueue } from "./run-all-queue";
import type { StepId, StepState } from "@/types/pipeline";

const states = (entries: Array<[string, string]>): Map<StepId, StepState> =>
  new Map(entries.map(([id, status]) => [id as StepId, {
    id: id as StepId, status, logs: [], exitCode: null, startTime: null, endTime: null,
    enabledSubSteps: [], enabledLanguages: [], testcaseCount: 0,
  } as StepState]));

test("launches every ready step at once, not one at a time", () => {
  const d = decideQueue({
    queue: ["generate_editorial", "prepare_platform_json"] as StepId[],
    stepStates: states([["generate_question", "completed"], ["generate_editorial", "pending"], ["prepare_platform_json", "pending"]]),
    questionType: "function", mode: "practice", launching: new Set(),
  });
  assert.equal(d.launch.length, 2, "independent siblings must launch together");
});

test("keeps a step whose failed prerequisite is still queued (being retried)", () => {
  const d = decideQueue({
    queue: ["generate_question", "generate_testcases"] as StepId[],
    stepStates: states([["generate_question", "failed"], ["generate_testcases", "pending"]]),
    questionType: "function", mode: "practice", launching: new Set(),
  });
  assert.ok(d.remaining.includes("generate_testcases" as StepId),
    "must not drop a step whose failed prerequisite is queued for retry");
});

test("drops a step whose prerequisite failed and is NOT queued", () => {
  const d = decideQueue({
    queue: ["generate_testcases"] as StepId[],
    stepStates: states([["generate_question", "failed"], ["generate_testcases", "pending"]]),
    questionType: "function", mode: "practice", launching: new Set(),
  });
  assert.equal(d.remaining.includes("generate_testcases" as StepId), false);
  assert.equal(d.launch.includes("generate_testcases" as StepId), false);
});

test("never launches a step already marked launching", () => {
  const d = decideQueue({
    queue: ["generate_question"] as StepId[],
    stepStates: states([["generate_question", "pending"]]),
    questionType: "function", mode: "practice",
    launching: new Set(["generate_question"] as StepId[]),
  });
  assert.equal(d.launch.length, 0);
  assert.ok(d.remaining.includes("generate_question" as StepId));
});

test("drops a failed non-blocking step instead of retrying it", () => {
  // Pick a step whose getStepConfig(...).nonBlocking is true; assert it is
  // neither launched nor kept. Look one up rather than assuming an id.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/pipeline/run-all-queue.test.ts`
Expected: FAIL — cannot find module `./run-all-queue`

- [ ] **Step 3: Fill in the non-blocking test**

Find a step with `nonBlocking: true` via `getStepConfig` in `src/lib/pipeline-config.ts` and complete the fifth test with that real id. If NO step is currently non-blocking, say so in your report and assert the branch another way — do not delete the case.

- [ ] **Step 4: Implement by porting the effect**

Port `pipeline-context.tsx:2116-2192` verbatim in behaviour, substituting: `runAllQueue` → `input.queue`, `stepStates` → `input.stepStates`, `launchingStepsRef.current` → `input.launching`, and returning `{launch, remaining, skip}` instead of calling `setRunAllQueue` / `runStep`. Call the existing helpers; do not reimplement prerequisite logic.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/lib/pipeline/run-all-queue.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/run-all-queue.ts src/lib/pipeline/run-all-queue.test.ts
git commit -m "feat(pipeline): pure run-all queue decision"
```

---

### Task 3: Persist the queue

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/pipeline/queue-store.ts`
- Test: `src/lib/pipeline/queue-store.test.ts`

**Interfaces:**
- Produces: `readQueue(problemId) => Promise<StoredQueue | null>`, `writeQueue(problemId, q: StoredQueue) => Promise<void>`, `clearQueue(problemId) => Promise<void>`, `type StoredQueue = { steps: StepId[]; questionType: QuestionType; mode: PipelineMode; startedAt: string }`

- [ ] **Step 1: Add the column**

In `src/lib/db/schema.ts`, on `pipelineStates`:

```ts
  // Ordered StepIds still to run for an in-flight "Run all", plus the context
  // the decision needs. Null when no run-all is active.
  runAllQueue: jsonb("run_all_queue"),
```

- [ ] **Step 2: Write the failing test**

Test `formatting/parsing only` — do not test Drizzle itself. Pin that a stored queue round-trips through whatever narrowing `queue-store` does, and that a malformed stored value (a string, a number, `{}`) yields `null` rather than throwing, so one corrupt row cannot break the pipeline page.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseStoredQueue } from "./queue-store";

test("parses a well-formed stored queue", () => {
  const q = parseStoredQueue({ steps: ["generate_question"], questionType: "function", mode: "practice", startedAt: "2026-09-04T10:00:00Z" });
  assert.equal(q?.steps.length, 1);
});

test("returns null for malformed stored values rather than throwing", () => {
  for (const bad of [null, undefined, "queue", 42, {}, { steps: "nope" }]) {
    assert.equal(parseStoredQueue(bad), null);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test src/lib/pipeline/queue-store.test.ts`
Expected: FAIL — cannot find module `./queue-store`

- [ ] **Step 4: Implement**

Note `src/lib/db/index.ts` throws at module load without `DATABASE_URL`, and `tsx --test` does not read `.env.local`. Keep `parseStoredQueue` in a module the test can import WITHOUT pulling in `@/lib/db` — either put the DB calls behind a separate module, or have the test set a dummy `DATABASE_URL` and import dynamically inside the test body (see `src/lib/loadings/load-records.test.ts` for the working pattern; top-level `await` fails under tsx's CJS transform).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/lib/pipeline/queue-store.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Push the schema — ASK FIRST**

`npm run db:push` targets production. Get explicit approval before running it. Note the config now carries `tablesFilter` excluding the `pg_stat_statements` views; without it the push aborts partway and leaves later statements unapplied.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/db/schema.ts src/lib/pipeline/queue-store.ts src/lib/pipeline/queue-store.test.ts
git commit -m "feat(pipeline): persist the run-all queue"
```

---

### Task 4: Make step launching callable in-process

**Files:**
- Create: `src/app/api/pipeline/run/start-step.ts`
- Modify: `src/app/api/pipeline/run/route.ts`

**Interfaces:**
- Produces: `startStep(args: StartStepArgs): Promise<{ runId: string; pid: number | null }>`

The orchestrator must launch steps WITHOUT making an HTTP request to its own server — it has no session cookie and self-calls are fragile.

- [ ] **Step 1: Read the route end to end first**

`src/app/api/pipeline/run/route.ts` is 560 lines. Read ALL of it before moving anything, and list in your report: every side effect the spawn path performs (DB writes, env construction, usage tracking, the `proc.on("close")` handler, `detached`/`unref`), and which are HTTP concerns versus launch concerns.

- [ ] **Step 2: Extract without behaviour change**

Move the launch — argument building, env construction, `spawn`, the run row insert, and the `close` handler — into `start-step.ts`. `route.ts` keeps auth, validation and the response, and calls `startStep`.

**This step changes no behaviour.** Do not "improve" the env stripping (`LLM keys`), the one-second slack before spawn, `detached: true`, `proc.unref()`, or the stop/`exitCode === -1` handling — each is deliberate and commented.

- [ ] **Step 3: Verify the extraction changed nothing**

Run: `npx tsc --noEmit && npm run lint && npm run test:ts`
Then run ONE real pipeline step from the UI and confirm it behaves exactly as before: logs stream, the run row gets `pid`, and it reaches `completed`. Capture what you observed. A refactor of the spawn path that is not exercised against a real step has not been verified.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pipeline/run/start-step.ts src/app/api/pipeline/run/route.ts
git commit -m "refactor(pipeline): make step launching callable in-process"
```

---

### Task 5: Advance the queue when a step closes

**Files:**
- Create: `src/lib/pipeline/advance-queue.ts`
- Modify: `src/app/api/pipeline/run/start-step.ts`
- Test: `src/lib/pipeline/advance-queue.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4
- Produces: `advanceQueue(problemId: string): Promise<{ launched: StepId[]; remaining: StepId[] }>`

- [ ] **Step 1: Write the failing test**

Test `advanceQueue` with its DB reads and `startStep` INJECTED, so the test needs no database and no spawning. Cover: an empty/absent queue is a no-op; a ready step is launched and removed from the persisted queue; a step that is not ready stays; when the queue empties it is cleared rather than left as `[]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/pipeline/advance-queue.test.ts`
Expected: FAIL — cannot find module `./advance-queue`

- [ ] **Step 3: Implement**

Read the queue; read `pipeline_runs` for the problem; `stepStatesFromRuns`; `decideQueue`; persist `remaining`; apply `skip` decisions as `skipped` rows with their reason; launch `launch` via `startStep`.

**Guard against double-launch.** Two steps finishing at the same moment both call `advanceQueue`. Use a per-problem in-process lock (a `Map<problemId, Promise>` chain) so the read-decide-write cycle is serialised, and pass the ids you are about to launch as `launching` into `decideQueue`. Explain your choice in the report. Note an in-process lock does not survive multiple server instances — say so rather than implying it does.

- [ ] **Step 4: Call it from the close handler**

In `start-step.ts`, after the `close` handler writes the terminal status, call `advanceQueue(problemId)`. It MUST NOT throw into the handler — an unhandled rejection here kills the Node process (Node 15+). Attach a terminal `.catch()` that logs.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/lib/pipeline/advance-queue.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/advance-queue.ts src/app/api/pipeline/run/start-step.ts src/lib/pipeline/advance-queue.test.ts
git commit -m "feat(pipeline): advance the run-all queue when a step closes"
```

---

### Task 6: Reconcile orphaned runs

**Files:**
- Create: `src/lib/pipeline/reconcile-runs.ts`
- Modify: `src/app/api/pipeline/run/status/route.ts`
- Test: `src/lib/pipeline/reconcile-runs.test.ts`

**Interfaces:**
- Produces: `reconcileRunningRows(rows: RunRow[], isAlive: (pid: number) => boolean, now: Date): StepId[]` — the ids to mark failed

`proc.on("close")` only fires while the Node server that spawned the child is alive. A dev restart or deploy loses it: the row stays `running` forever and the queue stalls. Without this task, "the queue is durable" is a promise the system cannot keep.

- [ ] **Step 1: Write the failing test**

Cover: a `running` row whose pid is alive is left alone; a `running` row whose pid is dead is returned; a row with a NULL pid older than a generous threshold is returned; a freshly-started row with a NULL pid is left alone (the pid may not be written yet — a race this must not lose).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/pipeline/reconcile-runs.test.ts`
Expected: FAIL — cannot find module `./reconcile-runs`

- [ ] **Step 3: Implement the pure decision**

Keep the liveness check injected (`isAlive`). The real one uses `process.kill(pid, 0)` in a try/catch — a signal of 0 tests existence without signalling. Note it cannot tell you the pid was not RECYCLED by a different process; say so in a comment and use it only alongside the age threshold.

- [ ] **Step 4: Wire it in**

Call it from the status route the client already polls, then `advanceQueue`. Reconciliation must never make the status request fail — wrap it.

- [ ] **Step 5: Run test to verify it passes, then commit**

```bash
npx tsx --test src/lib/pipeline/reconcile-runs.test.ts
git add src/lib/pipeline/reconcile-runs.ts src/app/api/pipeline/run/status/route.ts src/lib/pipeline/reconcile-runs.test.ts
git commit -m "feat(pipeline): reconcile runs orphaned by a server restart"
```

---

### Task 7: The run-all endpoint

**Files:**
- Create: `src/app/api/pipeline/run-all/route.ts`

**Interfaces:**
- Produces: `POST /api/pipeline/run-all` → `{ queued: StepId[] }`; `GET /api/pipeline/run-all?problemId=…` → `{ active: boolean; steps: StepId[] }`

- [ ] **Step 1: Implement POST**

Authorise with `requireProblemManageAccess(problemId)` BEFORE reading the body. Build the initial queue exactly as `runAll()` does today in `pipeline-context.tsx:1975` — including the title-gating that marks steps `skipped` rather than dropping them. Persist it, then call `advanceQueue` once to start. Return the queued ids.

Refuse with 409 if a queue is already active for this problem, so a double click cannot start two.

- [ ] **Step 2: Implement GET**

Authorise with `requireProblemAccess`. Return the stored queue, or `{ active: false, steps: [] }`.

- [ ] **Step 3: Typecheck, lint, manual check**

Run: `npx tsc --noEmit && npm run lint`
Then: POST with a bogus problemId → 400/404 not a crash; POST unauthenticated → rejected; POST twice quickly → the second is 409.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pipeline/run-all
git commit -m "feat(pipeline): run-all start and status endpoints"
```

---

### Task 8: The client becomes an observer

**Files:**
- Modify: `src/lib/pipeline-context.tsx`

**Interfaces:**
- Consumes: Task 7's endpoints

This touches the most-used screen in the app. `pipeline-context.tsx` is 2,246 lines. Change only what this task names.

- [ ] **Step 1: Replace `runAll`**

`runAll()` POSTs `/api/pipeline/run-all` and returns. Delete the client-side queue construction at `pipeline-context.tsx:1975` — the server now owns it.

- [ ] **Step 2: Delete the auto-run effect**

Remove `runAllQueue`, `setRunAllQueue` and the effect at `pipeline-context.tsx:2116-2192`. Its logic now lives in `run-all-queue.ts` and must NOT exist in two places — two copies WILL diverge, and the client copy would fight the server for control.

- [ ] **Step 3: Derive `isRunAllActive` from the server**

Fold the run-all state into the polling the context already does (`/api/pipeline/run/status?problemId=` at line 924) rather than adding a second independent poller.

- [ ] **Step 4: Verify in the browser — including the bug this plan exists to fix**

`npm run dev`, then:
1. Click Run all. Confirm steps advance as before.
2. **Refresh the page mid-run.** Confirm the sequence CONTINUES after the in-flight step finishes. This is the whole point of the plan.
3. Close the tab entirely mid-run, reopen it, confirm the same.
4. Confirm a failed step still stops its dependents, and that non-blocking failures still let the queue drain.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline-context.tsx
git commit -m "feat(pipeline): observe the server-owned run-all queue"
```

---

### Task 9: Full-suite verification

**Files:** none

- [ ] **Step 1: Run everything**

Run: `npx tsc --noEmit && npm run lint && npm run test:ts && npm run test:json`
Expected: 0 type errors, 0 lint errors, all tests pass.

- [ ] **Step 2: Run a complete pipeline end to end**

On a real problem, Run all from empty to finished, refreshing at least twice at different points. Confirm every step completes and nothing is run twice.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "test(pipeline): verified run-all survives refresh"
```

---

## Notes for the implementer

- The five preserved behaviours in Global Constraints are not style preferences. Each is a bug someone already fixed once; the comments in `pipeline-context.tsx:2116-2192` name them.
- The riskiest task is 8, because it deletes the only working implementation. Do not start it until Tasks 1-7 are reviewed and their tests pass.
- An in-process lock does not survive multiple server instances. If this app is ever run with more than one Node process against the same database, the guard in Task 5 needs to become a database-level one — a `SELECT … FOR UPDATE` on the `pipeline_states` row, or an advisory lock.
