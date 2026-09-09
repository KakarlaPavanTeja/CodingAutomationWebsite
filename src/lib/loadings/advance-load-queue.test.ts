import test from "node:test";
import assert from "node:assert/strict";

// This module's import graph reaches `@/lib/db`, which throws at module load if
// DATABASE_URL is unset, and tsx --test does not read .env.local. Same
// dummy-value + in-body-import arrangement as load-records.test.ts.
const load = async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  return import("./advance-load-queue");
};

type Claimed = {
  id: string;
  problemId: string | null;
  sourcePath: string | null;
  remarks: string | null;
};

const record = (id: string, over: Partial<Claimed> = {}): Claimed => ({
  id,
  problemId: `problem-${id}`,
  sourcePath: "forJSONPreparation/coding_questions.json",
  remarks: null,
  ...over,
});

const ok = { success: true, batches: [], questionCount: 1 };
const passthrough = async <T,>(_lane: string, fn: () => Promise<T>) => fn();

test("advanceLoadQueue drains every queued load in order", async () => {
  const { advanceLoadQueue } = await load();
  const pending = [record("a"), record("b"), record("c")];
  const finished: { id: string; status: string }[] = [];
  const ran = await advanceLoadQueue({
    withLock: passthrough,
    claim: async () => pending.shift() ?? null,
    readQuestions: async () => [{ question_id: "q" }],
    runLoad: async () => ok,
    finish: async (id, args) => void finished.push({ id, status: args.status }),
    log: async () => {},
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
    withLock: passthrough,
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
  });
  assert.deepEqual(ran, ["a", "b"], "the load behind a failure must still be attempted");
  assert.deepEqual(finished, [
    { id: "a", status: "failed" },
    { id: "b", status: "completed" },
  ]);
});

test("advanceLoadQueue does nothing when nothing is claimable", async () => {
  const { advanceLoadQueue } = await load();
  let runs = 0;
  const ran = await advanceLoadQueue({
    withLock: passthrough,
    claim: async () => null,
    readQuestions: async () => [],
    runLoad: async () => {
      runs += 1;
      return ok;
    },
    finish: async () => {},
    log: async () => {},
  });
  assert.deepEqual(ran, []);
  assert.equal(runs, 0);
});

test("advanceLoadQueue fails a load whose questions cannot be read, and continues", async () => {
  const { advanceLoadQueue } = await load();
  const pending = [record("gone"), record("ok")];
  const finished: { id: string; status: string; error?: string | null }[] = [];
  const ran = await advanceLoadQueue({
    withLock: passthrough,
    claim: async () => pending.shift() ?? null,
    readQuestions: async (rec) => {
      if (rec.id === "gone") throw new Error("Output file not found");
      return [{ question_id: "q" }];
    },
    runLoad: async () => ok,
    finish: async (id, args) => void finished.push({ id, status: args.status, error: args.error }),
    log: async () => {},
  });
  assert.deepEqual(ran, ["gone", "ok"]);
  assert.equal(finished[0].status, "failed");
  assert.match(String(finished[0].error), /Output file not found/);
  assert.equal(finished[1].status, "completed");
});

test("a claimed load with no problemId is failed, never run", async () => {
  // Uploads are inserted `running` and driven inline, so the queue should never
  // see one. If it ever does, the questions are unreachable — fail loudly
  // rather than load nothing and report success.
  const { advanceLoadQueue } = await load();
  const pending = [record("up", { problemId: null, sourcePath: null })];
  const finished: { status: string; error?: string | null }[] = [];
  let runs = 0;
  await advanceLoadQueue({
    withLock: passthrough,
    claim: async () => pending.shift() ?? null,
    runLoad: async () => {
      runs += 1;
      return ok;
    },
    finish: async (_id, args) => void finished.push({ status: args.status, error: args.error }),
    log: async () => {},
  });
  assert.equal(runs, 0);
  assert.equal(finished[0].status, "failed");
  assert.match(String(finished[0].error), /upload/i);
});

test("the whole drain runs inside the cross-process lock", async () => {
  // The in-process chain only covers this Node process. Two instances against
  // one database is what spawned a pipeline step twice (see
  // src/lib/pipeline/advance-queue.test.ts), so nothing may claim or run a load
  // outside the lock.
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
      return ok;
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
    withLock: passthrough,
    claim: async () => record(`r${n++}`),
    readQuestions: async () => [{ question_id: "q" }],
    runLoad: async () => ok,
    finish: async () => {},
    log: async () => {},
  });
  assert.equal(ran.length, MAX_DRAIN_PER_PASS);
});
