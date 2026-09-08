import test from "node:test";
import assert from "node:assert/strict";
import { decideQueue, MAX_STEP_ATTEMPTS } from "./run-all-queue";
import { STEP_CONFIGS, getStepConfig } from "@/lib/pipeline-config";
import type { StepId, StepState } from "@/types/pipeline";

const states = (entries: Array<[string, string]>): Map<StepId, StepState> =>
  new Map(entries.map(([id, status]) => [id as StepId, {
    id: id as StepId, status, logs: [], exitCode: null, startTime: null, endTime: null,
    enabledSubSteps: [], enabledLanguages: [], testcaseCount: 0,
  } as StepState]));

const base = { questionType: "function", mode: "practice", launching: new Set<StepId>() } as const;

test("launches every ready step at once, not one at a time", () => {
  const d = decideQueue({
    ...base,
    queue: ["generate_editorial", "prepare_platform_json"] as StepId[],
    stepStates: states([["package_platform", "completed"]]),
  });
  assert.equal(d.launch.length, 2, "independent siblings must launch together");
});

test("keeps a step whose failed prerequisite is still queued (being retried)", () => {
  const d = decideQueue({
    ...base,
    queue: ["package_platform", "prepare_platform_json"] as StepId[],
    stepStates: states([["package_platform", "failed"]]),
  });
  assert.ok(d.remaining.includes("prepare_platform_json" as StepId),
    "must not drop a step whose failed prerequisite is queued for retry");
});

test("drops a step whose prerequisite failed and is NOT queued", () => {
  const d = decideQueue({
    ...base,
    queue: ["prepare_platform_json"] as StepId[],
    stepStates: states([["package_platform", "failed"]]),
  });
  assert.equal(d.remaining.includes("prepare_platform_json" as StepId), false);
  assert.equal(d.launch.includes("prepare_platform_json" as StepId), false);
});

test("never launches a step already marked launching", () => {
  const d = decideQueue({
    ...base,
    queue: ["prepare_platform_json"] as StepId[],
    stepStates: states([["package_platform", "completed"]]),
    launching: new Set(["prepare_platform_json"] as StepId[]),
  });
  assert.equal(d.launch.length, 0);
  assert.ok(d.remaining.includes("prepare_platform_json" as StepId));
});

test("drops a failed non-blocking step instead of retrying it", () => {
  // No step ships with nonBlocking today (execute_editorial is *described* as
  // informational but carries no flag), so the branch is driven through the
  // injected config resolver rather than being left untested.
  assert.equal(STEP_CONFIGS.some((c) => c.nonBlocking), false,
    "if a step becomes non-blocking, drive this test off the real config");

  const d = decideQueue({
    ...base,
    queue: ["execute_editorial"] as StepId[],
    stepStates: states([["generate_editorial", "completed"], ["execute_editorial", "failed"]]),
    stepConfig: (id) =>
      id === "execute_editorial" ? { ...getStepConfig(id), nonBlocking: true } : getStepConfig(id),
  });
  assert.equal(d.launch.length, 0);
  assert.equal(d.remaining.length, 0, "a failed non-blocking step must drain, not retry");
});

test("a completed step is dropped, unless it was explicitly re-queued", () => {
  const args = {
    ...base,
    queue: ["prepare_platform_json"] as StepId[],
    stepStates: states([
      ["package_platform", "completed"],
      ["prepare_platform_json", "completed"],
    ]),
  };
  // Plain Run All: already done, nothing to do.
  assert.deepEqual(decideQueue(args).launch, []);
  assert.deepEqual(decideQueue(args).remaining, []);

  // "Re-run affected" named it: the completion on record is the stale one the
  // user is replacing, so it must run again.
  const forced = decideQueue({ ...args, force: new Set(["prepare_platform_json"] as StepId[]) });
  assert.deepEqual(forced.launch, ["prepare_platform_json"]);
});

test("retries a failed blocking step while it still has attempts left", () => {
  const d = decideQueue({
    ...base,
    queue: ["prepare_platform_json"] as StepId[],
    stepStates: states([
      ["package_platform", "completed"],
      ["prepare_platform_json", "failed"],
    ]),
    attempts: new Map([["prepare_platform_json" as StepId, MAX_STEP_ATTEMPTS - 1]]),
  });
  assert.deepEqual(d.launch, ["prepare_platform_json"]);
});

test("stops retrying a blocking step once it is out of attempts, and drains its dependents", () => {
  // Same shape as "keeps a step whose failed prerequisite is still queued",
  // except the prerequisite has now burned its whole allowance. It must be
  // given up on, and `prepare_platform_json` must not sit queued forever
  // waiting on a retry that will never come — that loop is what re-launched
  // generate_testcases every advance at ~$0.85 a lap.
  const d = decideQueue({
    ...base,
    queue: ["package_platform", "prepare_platform_json"] as StepId[],
    stepStates: states([["package_platform", "failed"]]),
    attempts: new Map([["package_platform" as StepId, MAX_STEP_ATTEMPTS]]),
  });
  assert.deepEqual(d.launch, [], "an out-of-attempts step must not relaunch");
  assert.deepEqual(d.remaining, [], "the queue must drain, not loop");
});

test("a queued step with no run row yet is pending, not dropped", () => {
  const d = decideQueue({ ...base, queue: ["generate_question"] as StepId[], stepStates: states([]) });
  assert.deepEqual(d.launch, ["generate_question"]);
});

test("keeps a running step queued so its remaining waves can still launch", () => {
  const d = decideQueue({
    ...base,
    queue: ["generate_question"] as StepId[],
    stepStates: states([["generate_question", "running"]]),
  });
  assert.equal(d.launch.length, 0);
  assert.deepEqual(d.remaining, ["generate_question"]);
});
