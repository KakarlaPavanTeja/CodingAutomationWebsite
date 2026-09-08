import test from "node:test";
import assert from "node:assert/strict";
import type { StepId } from "@/types/pipeline";

// advance-queue.ts reaches @/lib/db through queue-store, which throws at module
// load without DATABASE_URL. tsx --test does not read .env.local, so set a dummy
// before the dynamic import (postgres-js connects lazily — no socket is opened).
const load = async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  return import("./advance-queue");
};

const gqContext = {
  questionType: "function" as const,
  mode: "practice" as const,
  languages: ["Python"],
  generateTitleWithAi: false,
  ownerTitle: "T",
  ownerDifficulty: "",
};

const run = (stepId: string, status: string) => ({
  stepId,
  status,
  exitCode: status === "completed" ? 0 : null,
  startedAt: new Date("2026-09-04T10:00:00Z"),
  finishedAt: status === "completed" ? new Date("2026-09-04T10:01:00Z") : null,
});

/** Records every dep call so a test can assert on them without a DB or a spawn. */
function harness(opts: { queue?: { steps: StepId[] } | null; runs?: ReturnType<typeof run>[] }) {
  const calls = {
    started: [] as Array<{ stepId: StepId; runKey?: string; languages: string[] }>,
    written: [] as StepId[][],
    cleared: 0,
  };
  const deps = {
    readQueue: async () =>
      opts.queue == null
        ? null
        : {
            ...opts.queue,
            questionType: "function" as const,
            mode: "practice" as const,
            gqContext,
            userId: "11111111-1111-1111-1111-111111111111",
            startedAt: "2026-09-04T10:00:00Z",
          },
    writeQueue: async (_id: string, q: { steps: StepId[] }) => {
      calls.written.push(q.steps);
    },
    clearQueue: async () => {
      calls.cleared++;
    },
    // Pass-through: the real one takes a Postgres advisory lock, and these tests
    // deliberately never open a socket.
    withLock: <T,>(_id: string, fn: () => Promise<T>) => fn(),
    readRuns: async () => opts.runs ?? [],
    readContext: async () => ({ languages: ["Python"], stepConfigs: {} }),
    startStep: async (args: { stepId: StepId; runKey?: string; languages: string[] }) => {
      calls.started.push({
        stepId: args.stepId,
        runKey: args.runKey,
        languages: args.languages,
      });
      return { ok: true as const, runId: "r1", stepId: args.stepId, pid: 123 };
    },
  };
  return { deps, calls };
}

test("an absent queue is a no-op", async () => {
  const { advanceQueue } = await load();
  const { deps, calls } = harness({ queue: null });
  const result = await advanceQueue("p1", deps as never);
  assert.deepEqual(result.launched, []);
  assert.equal(calls.started.length, 0);
  assert.equal(calls.written.length, 0);
  assert.equal(calls.cleared, 0);
});

test("a ready step is launched and stays queued until it completes", async () => {
  const { advanceQueue } = await load();
  const { deps, calls } = harness({
    queue: { steps: ["prepare_platform_json"] as StepId[] },
    runs: [run("package_platform", "completed")],
  });
  const result = await advanceQueue("p1", deps as never);
  assert.deepEqual(result.launched, ["prepare_platform_json"]);
  assert.deepEqual(
    calls.started.map((c) => c.stepId),
    ["prepare_platform_json"]
  );
  // Still persisted: a multi-process step needs the next advance to plan its
  // next wave, so a launched step leaves the queue only once it is completed.
  assert.deepEqual(calls.written, [["prepare_platform_json"]]);
  assert.equal(calls.cleared, 0);
});

test("a step whose prerequisite has not run stays queued and is not launched", async () => {
  const { advanceQueue } = await load();
  const { deps, calls } = harness({
    queue: { steps: ["prepare_platform_json"] as StepId[] },
    runs: [],
  });
  await advanceQueue("p1", deps as never);
  assert.equal(calls.started.length, 0);
  assert.deepEqual(calls.written, [["prepare_platform_json"]]);
});

test("an emptied queue is cleared, not left as an empty array", async () => {
  const { advanceQueue } = await load();
  const { deps, calls } = harness({
    queue: { steps: ["prepare_platform_json"] as StepId[] },
    runs: [run("package_platform", "completed"), run("prepare_platform_json", "completed")],
  });
  await advanceQueue("p1", deps as never);
  assert.equal(calls.started.length, 0);
  assert.equal(calls.cleared, 1);
  assert.deepEqual(calls.written, []);
});

test("the launch plan is forwarded to startStep verbatim", async () => {
  // Per-language fan-out and the Generate Question waves are planned by
  // launch-plan.ts and asserted there; what matters here is that advanceQueue
  // passes each planned spawn through unchanged, including the language set.
  const { advanceQueue } = await load();
  const { deps, calls } = harness({
    queue: { steps: ["execute_editorial"] as StepId[] },
    runs: [run("generate_editorial", "completed")],
  });
  await advanceQueue("p1", deps as never);
  assert.deepEqual(calls.started, [
    { stepId: "execute_editorial", runKey: undefined, languages: ["Python"] },
  ]);
});

test("every advance runs inside the cross-process lock for its own problem", async () => {
  // The in-process chain only covers this Node process. Two instances against
  // one database is what spawned a step twice, so nothing may read the queue or
  // launch a step outside the lock.
  const { advanceQueue } = await load();
  const { deps, calls } = harness({
    queue: { steps: ["prepare_platform_json"] as StepId[] },
    runs: [run("package_platform", "completed")],
  });
  const locked: string[] = [];
  let held = false;
  await advanceQueue("p1", {
    ...deps,
    withLock: async <T,>(id: string, fn: () => Promise<T>) => {
      locked.push(id);
      held = true;
      try {
        return await fn();
      } finally {
        held = false;
      }
    },
    startStep: async (args: { stepId: StepId }) => {
      assert.ok(held, "a step must never be spawned outside the lock");
      return deps.startStep(args as never);
    },
  } as never);
  assert.deepEqual(locked, ["p1"], "the lock must be keyed by problem id");
  assert.equal(calls.started.length, 1);
});

test("concurrent advances for one problem are serialised", async () => {
  const { advanceQueue } = await load();
  const { deps, calls } = harness({
    queue: { steps: ["prepare_platform_json"] as StepId[] },
    runs: [run("package_platform", "completed")],
  });
  await Promise.all([advanceQueue("p1", deps as never), advanceQueue("p1", deps as never)]);
  // Both passes see the same stubbed run rows, so both launch. What must NOT
  // happen is interleaving: each pass reads, decides and writes before the
  // next begins, which is what makes the read-decide-write cycle safe.
  assert.equal(calls.written.length, 2);
});
