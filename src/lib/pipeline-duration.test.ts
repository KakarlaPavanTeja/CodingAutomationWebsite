import { test } from "node:test";
import assert from "node:assert/strict";
import {
  durationFromRunState,
  mergeRunProgress,
  mergeSubStepCompletion,
  plainStepBoundsFromRuns,
  startTimeFromRun,
} from "./pipeline-duration";

const RUN_1_START = Date.parse("2026-08-21T08:31:01.000Z");
const RUN_2_START = Date.parse("2026-08-21T09:12:29.000Z");
const RUN_2_END = Date.parse("2026-08-21T09:13:10.000Z");

test("a re-run is measured from its own start, not the previous run's", () => {
  // State left behind by run #1, 41 minutes earlier.
  const stale = { status: "completed" as const, logs: [], exitCode: 0, startTime: RUN_1_START, endTime: null };
  const adopted = mergeRunProgress(stale, {
    status: "running",
    exitCode: null,
    startedAtIso: "2026-08-21T09:12:29.000Z",
  });
  assert.equal(adopted.startTime, RUN_2_START);

  const done = mergeSubStepCompletion(adopted, {
    status: "completed",
    exitCode: 0,
    endTime: RUN_2_END,
    startedAtIso: "2026-08-21T09:12:29.000Z",
  });
  assert.equal(durationFromRunState(done, "completed"), 41);
});

test("startTimeFromRun keeps the fallback only when the row has no start", () => {
  assert.equal(startTimeFromRun(null, RUN_1_START), RUN_1_START);
  assert.equal(startTimeFromRun("not a date", RUN_1_START), RUN_1_START);
  assert.equal(startTimeFromRun("2026-08-21T09:12:29.000Z", RUN_1_START), RUN_2_START);
  assert.equal(startTimeFromRun(null, null), null);
});

test("a running step still ticks from the run's start", () => {
  const run = mergeRunProgress(
    { status: "pending" as const, logs: [], exitCode: null, startTime: null, endTime: null },
    { status: "running", startedAtIso: "2026-08-21T09:12:29.000Z" }
  );
  assert.equal(durationFromRunState(run, "running", RUN_2_START + 5000), 5);
});

test("plainStepBoundsFromRuns takes the newest run per step", () => {
  const bounds = plainStepBoundsFromRuns([
    // newest first, as the API returns them
    { step_id: "generate_wrong_solutions", status: "completed", started_at: "2026-08-21T09:12:29.000Z", finished_at: "2026-08-21T09:13:10.000Z" },
    { step_id: "generate_wrong_solutions", status: "completed", started_at: "2026-08-21T08:31:01.000Z", finished_at: "2026-08-21T08:31:39.000Z" },
  ]);
  const b = bounds.get("generate_wrong_solutions")!;
  assert.equal((b.endTime - b.startTime) / 1000, 41);
});

test("per-language and in-flight runs are left to their own state", () => {
  const bounds = plainStepBoundsFromRuns([
    { step_id: "split_code__java", status: "completed", started_at: "2026-08-21T09:24:51.000Z", finished_at: "2026-08-21T09:25:44.000Z" },
    { step_id: "generate_question__naming", status: "completed", started_at: "2026-08-21T07:34:30.000Z", finished_at: "2026-08-21T07:35:13.000Z" },
    { step_id: "select_testcases", status: "running", started_at: "2026-08-21T09:13:43.000Z", finished_at: null },
  ]);
  assert.equal(bounds.size, 0);
});

test("a row with no finish, or a finish before its start, is ignored", () => {
  const bounds = plainStepBoundsFromRuns([
    { step_id: "package_platform", status: "completed", started_at: "2026-08-21T09:26:14.000Z", finished_at: null },
    { step_id: "prepare_platform_json", status: "completed", started_at: "2026-08-21T09:26:31.000Z", finished_at: "2026-08-21T09:26:30.000Z" },
  ]);
  assert.equal(bounds.size, 0);
});
