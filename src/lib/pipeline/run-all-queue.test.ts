import test from "node:test";
import assert from "node:assert/strict";
import { decideQueue } from "./run-all-queue";
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

test("a queued step with no run row yet is pending, not dropped", () => {
  const d = decideQueue({ ...base, queue: ["generate_question"] as StepId[], stepStates: states([]) });
  assert.deepEqual(d.launch, ["generate_question"]);
});
