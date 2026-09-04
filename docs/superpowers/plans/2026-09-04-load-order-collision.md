# Load Order Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop two concurrent loads claiming the same order in the same question set, which makes the NKB backend reject the second with no reason given.

**Architecture:** Serialise loads per QUESTION SET rather than per problem, and re-read the order immediately before the zip is built instead of trusting a value computed minutes earlier.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM over Postgres, TypeScript strict, Node's built-in test runner (`npm run test:ts`).

**Spec:** this document (the incident below is the specification).

## The incident this fixes

Observed on 2026-09-04 against live beta:

```
15:16:38.609  problem 65ea1c72…  ->  completed
15:16:50.007  problem 6769ad77…  ->  FAILED     (started 11s later, overlapping)
15:17:49.723  65ea1c72 finished
15:17:51.515  6769ad77 finished
```

Both planners read the question set's `maxOrder` before either had written
anything, so both computed **order 29**. The first landed there; the second
collided on `(question_set_id, order)` and the backend returned `FAILURE` with
**no message at all** — so the operator saw only "JSON_LOADING failed".

Proven by re-running the SECOND load later, unchanged, with the same ids: it
took order 30 and succeeded. The payload was never at fault
(120 test cases, orders 1-120 unique, weightages summing to `total_score`,
all four language solutions present).

## Why the existing guard did not catch it

`route.ts` already refuses a concurrent load with **423** — but that guard is
keyed on `problemId`:

```ts
if (problemId) { const running = await runningLoadForProblem(problemId); … }
```

Two DIFFERENT problems loading at once both pass it. They then contend for the
same shared resource: the order sequence inside one question set. An upload
(`problemId: null`) is not gated at all.

The order itself is allocated at plan time in `practice-set-db.ts:164`:

```ts
orderStart: capacity.nextOrder,   // capacityFromLookup: maxOrder + 1
```

and the value is used minutes later, after a registry sweep, a zip build and
an S3 upload. The window between read and use is the whole load.

## Global Constraints

- **Never touch:** the `JSON_LOADING` link filename `question_sets_questions.json` (plural, `LINK_FILE_JSON_LOADING`), the `SHEET_LOADING` singular `LINK_FILE_SHEET_LOADING`, `confirmLinked` or how it gates `result.success` on both paths, or the polling intervals. Each encodes a failure that cost real debugging time.
- Preserve: the 409 completed-duplicate gate keyed on a COMPLETED prior load; the existing per-problem 423; `regenerateQuestionIds` running exactly when `remarks` are present; the pre-flight duplicate check AND its fail-open-on-scrape-failure behaviour; `requireAuthApi()` first in GET; auth before body reading in POST.
- The rollover path must keep working: a minted set carries `unitTitle`/`childOrder`/`commonUnitId`, and `buildSheetCellUpdates` throws when a sheet-path batch lacks placement.
- Import alias `@/*` → `./src/*`. Tests beside the code, `npm run test:ts`.
- `npm run db:push` targets production. Ask before running it.
- Beta only. Loading is never automatic.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/loadings/set-lock.ts` (create) | Serialise work per question set id |
| `src/lib/loadings/load-coding-questions.ts` (modify) | Re-read the order inside the lock, just before building the zip |
| `src/app/api/loadings/coding-questions/route.ts` (modify) | Widen the concurrency refusal beyond one problem |

---

### Task 1: Serialise per question set

**Files:**
- Create: `src/lib/loadings/set-lock.ts`
- Test: `src/lib/loadings/set-lock.test.ts`

**Interfaces:**
- Produces: `withSetLock<T>(questionSetId: string, fn: () => Promise<T>): Promise<T>`

Two loads targeting the SAME set must not interleave their read-order →
build-zip → run-task sequence. Two loads targeting DIFFERENT sets must still
run concurrently — serialising everything would make a batch split across sets
needlessly slow.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { withSetLock } from "./set-lock";

test("serialises two calls for the same set", async () => {
  const events: string[] = [];
  const slow = async (tag: string) => {
    events.push(`${tag}:start`);
    await new Promise((r) => setTimeout(r, 20));
    events.push(`${tag}:end`);
  };
  await Promise.all([withSetLock("s1", () => slow("a")), withSetLock("s1", () => slow("b"))]);
  // Whichever runs first must FINISH before the other starts.
  assert.ok(
    events.join(",") === "a:start,a:end,b:start,b:end" ||
      events.join(",") === "b:start,b:end,a:start,a:end",
    `interleaved: ${events.join(",")}`,
  );
});

test("allows different sets to run concurrently", async () => {
  const events: string[] = [];
  const slow = async (tag: string) => {
    events.push(`${tag}:start`);
    await new Promise((r) => setTimeout(r, 20));
    events.push(`${tag}:end`);
  };
  await Promise.all([withSetLock("s1", () => slow("a")), withSetLock("s2", () => slow("b"))]);
  assert.equal(events[0].endsWith(":start"), true);
  assert.equal(events[1].endsWith(":start"), true, "different sets must overlap");
});

test("a throwing body releases the lock", async () => {
  await assert.rejects(() => withSetLock("s1", async () => { throw new Error("boom"); }), /boom/);
  const ran = await withSetLock("s1", async () => "ok");
  assert.equal(ran, "ok", "lock must not be held after a failure");
});

test("returns the body's value", async () => {
  assert.equal(await withSetLock("s1", async () => 42), 42);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/set-lock.test.ts`
Expected: FAIL — cannot find module `./set-lock`

- [ ] **Step 3: Implement**

```ts
/**
 * Serialise work per question set.
 *
 * Two loads that target the same set must not interleave their
 * read-order -> build-zip -> run-task sequence: both would read the same
 * `maxOrder` and the second would collide on (question_set_id, order), which
 * the NKB backend rejects with FAILURE and no message. Different sets are
 * independent and still run concurrently.
 *
 * ponytail: in-process only — it does not serialise across multiple Node
 * instances. Upgrade to a Postgres advisory lock keyed on the set id if this
 * app is ever run with more than one server process.
 */
const chains = new Map<string, Promise<unknown>>();

export function withSetLock<T>(questionSetId: string, fn: () => Promise<T>): Promise<T> {
  const key = String(questionSetId || "").trim() || "__unkeyed__";
  const prior = chains.get(key) ?? Promise.resolve();
  // Swallow the predecessor's rejection so one failed load cannot poison the
  // chain for every later load of the same set.
  const run = prior.then(fn, fn);
  // Keep the chain alive but never let it reject unhandled.
  chains.set(key, run.then(() => undefined, () => undefined));
  return run;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/set-lock.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadings/set-lock.ts src/lib/loadings/set-lock.test.ts
git commit -m "feat(loadings): serialise work per question set"
```

---

### Task 2: Allocate the order late, inside the lock

**Files:**
- Modify: `src/lib/loadings/load-coding-questions.ts` (`runBatch`)
- Test: `src/lib/loadings/question-set.test.ts` (extend)

**Interfaces:**
- Consumes: `withSetLock` (Task 1); `lookupQuestionSetQuestions`, `capacityFromLookup` from `./question-set`

`planQuestionSetBatches` computes `orderStart` from a lookup taken before the
registry sweep, the zip build and the S3 upload. By the time the task runs, it
can be stale. Re-read it inside the lock, immediately before the zip is built,
so the value used is the value that was true a moment ago.

- [ ] **Step 1: Read `runBatch` fully before changing it**

Read `src/lib/loadings/load-coding-questions.ts` `runBatch` end to end and
record in your report: where `batch.orderStart` is consumed
(`prepareQuestionsForAdminZip`), and everything else that depends on ordering.

- [ ] **Step 2: Write the failing test**

The re-read is an integration concern; make the DECISION testable as a pure
function instead, and pin that:

```ts
import { resolveOrderStart } from "./load-coding-questions";

test("prefers a freshly-read order over a stale planned one", () => {
  assert.equal(resolveOrderStart({ planned: 29, fresh: 30 }), 30);
});

test("keeps the planned order when the fresh read is not higher", () => {
  // A set that lost questions must not rewind the order and overwrite rows.
  assert.equal(resolveOrderStart({ planned: 30, fresh: 28 }), 30);
});

test("keeps the planned order when the fresh read is unavailable", () => {
  // The admin scrape can fail; a stale order beats refusing to load.
  assert.equal(resolveOrderStart({ planned: 29, fresh: null }), 29);
});

test("a new set starts at its planned order", () => {
  assert.equal(resolveOrderStart({ planned: 1, fresh: null }), 1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/question-set.test.ts`
Expected: FAIL — `resolveOrderStart` is not exported

- [ ] **Step 4: Implement**

Export `resolveOrderStart({ planned, fresh }: { planned: number; fresh: number | null }): number`
returning `fresh != null && fresh > planned ? fresh : planned`, then wrap the
body of `runBatch` in `withSetLock(batch.questionSetId, …)` and, for a
`loadVia === "json"` batch, re-read the set with
`capacityFromLookup(await lookupQuestionSetQuestions(batch.questionSetId))`
and pass `resolveOrderStart(...)` into `prepareQuestionsForAdminZip` instead
of `batch.orderStart`.

**Only the `json` path.** A `sheet` batch creates the set, so there is nothing
to re-read and the planner's value is authoritative.

If the re-read throws, log a warning through `onLog` and continue with the
planned order — a flaky admin scrape must not block a legitimate load, matching
how the pre-flight duplicate check already fails open.

Emit the resolved order in the existing `zip` log line so a future incident can
be diagnosed from the row alone.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/question-set.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npm run test:ts && npm run test:json`

- [ ] **Step 7: Commit**

```bash
git add src/lib/loadings/load-coding-questions.ts src/lib/loadings/question-set.test.ts
git commit -m "fix(loadings): allocate the question order inside a per-set lock"
```

---

### Task 3: Refuse a concurrent load beyond one problem

**Files:**
- Modify: `src/app/api/loadings/coding-questions/route.ts`
- Test: `src/lib/loadings/load-records.test.ts` (extend)

**Interfaces:**
- Produces: `anyRunningLoad() => Promise<LoadRecord | null>`

The existing 423 is keyed on `problemId`, so two different problems — and any
upload, which has no `problemId` — sail past it. Tasks 1 and 2 make a collision
survivable; this makes it rare, and gives the operator a clear message instead
of a queue of loads racing.

- [ ] **Step 1: Write the failing test**

Pin the DECISION as a pure function so no database is needed:

```ts
import { concurrentLoadRefusal } from "./load-records";

test("refuses when another load is running, whatever its problem", () => {
  const r = concurrentLoadRefusal({ id: "L1", problemId: "p-other" }, "p-mine");
  assert.ok(r, "a load running for another problem must still refuse");
  assert.match(r!.message, /already running/i);
});

test("refuses when an upload is running", () => {
  assert.ok(concurrentLoadRefusal({ id: "L1", problemId: null }, "p-mine"));
});

test("allows when nothing is running", () => {
  assert.equal(concurrentLoadRefusal(null, "p-mine"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/load-records.test.ts`
Expected: FAIL — `concurrentLoadRefusal` is not exported

- [ ] **Step 3: Implement**

Add `anyRunningLoad()` beside `runningLoadForProblem` — same staleness window
as the existing query, so a crashed process cannot block loading forever. Do
NOT change `latestLoadForProblem`: the 409 gate depends on its completed-only
semantics.

The message must say WHICH load is running and that waiting avoids a collision,
e.g. "Another coding-question load is running. Wait for it to finish — two
loads into the same question set can claim the same order, and the backend
rejects the loser without saying why."

- [ ] **Step 4: Wire it into POST**

Replace the problem-scoped check with the global one, keeping the 423 status
and keeping it distinct from the 409. It must NOT be liftable by `remarks`.

- [ ] **Step 5: Run test to verify it passes, typecheck, lint**

Run: `npx tsx --test src/lib/loadings/load-records.test.ts && npx tsc --noEmit && npm run lint`

- [ ] **Step 6: Manual check, no beta load**

`npm run dev`; start one load; while it runs, attempt a second on a DIFFERENT
problem and confirm a 423 with the new message rather than a second load.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/loadings/coding-questions/route.ts src/lib/loadings/load-records.ts src/lib/loadings/load-records.test.ts
git commit -m "fix(loadings): refuse any concurrent load, not just same-problem"
```

---

### Task 4: End-to-end verification

**Files:** none

- [ ] **Step 1: Full suite**

Run: `npx tsc --noEmit && npm run lint && npm run test:ts && npm run test:json`

- [ ] **Step 2: Reproduce the original race — ASK FIRST**

This writes to shared beta. Get explicit approval and agree which two problems
to use. Start a load, and while it is running start a second on another
problem. Expected: the second is refused with 423, not silently queued into a
collision. If approval is withheld, say so and rely on the unit tests.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "test(loadings): verified concurrent loads cannot collide on order"
```

---

## Notes for the implementer

- The failure mode is silent: the backend returns `FAILURE` with no message and
  the task output stops at the ECS spawn, so a collision looks identical to a
  malformed payload. That is why Task 2 logs the resolved order — without it,
  the next incident costs the same investigation again.
- `withSetLock` is in-process only. It does not help if this app ever runs as
  more than one Node process; a Postgres advisory lock keyed on the set id is
  the upgrade, and Task 1's comment says so.
- Tasks 1 and 2 make a collision survivable; Task 3 makes it rare. Do not skip
  1 and 2 in favour of 3 alone — a global refusal still leaves the stale-order
  window open for a load that starts after another finishes but reads a value
  cached from before.
