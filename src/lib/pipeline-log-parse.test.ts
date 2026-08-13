import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPipelineLogContent,
  parsePipelineLogContent,
  withoutRunLogs,
} from "./pipeline-log-parse";
import type { LogLine, SubStepRunState } from "@/types/pipeline";

const run = (over: Partial<SubStepRunState> = {}): SubStepRunState => ({
  status: "completed",
  logs: [{ stream: "stdout", line: "hello", ts: 1_760_000_000_000 }],
  exitCode: 0,
  startTime: 1_760_000_000_000,
  endTime: 1_760_000_060_000,
  activeRunId: "22222222-2222-4222-8222-222222222222",
  ...over,
});

test("withoutRunLogs empties logs and keeps every other field", () => {
  const stripped = withoutRunLogs({ cpp: run(), java: run({ status: "failed", exitCode: 1 }) })!;

  assert.deepEqual(stripped.cpp.logs, []);
  assert.deepEqual(stripped.java.logs, []);
  assert.equal(stripped.cpp.status, "completed");
  assert.equal(stripped.cpp.exitCode, 0);
  assert.equal(stripped.cpp.startTime, 1_760_000_000_000);
  assert.equal(stripped.cpp.endTime, 1_760_000_060_000);
  assert.equal(stripped.cpp.activeRunId, "22222222-2222-4222-8222-222222222222");
  assert.equal(stripped.java.exitCode, 1);
});

test("withoutRunLogs does not mutate the source and passes undefined through", () => {
  const source = { cpp: run() };
  withoutRunLogs(source);
  assert.equal(source.cpp.logs.length, 1);
  assert.equal(withoutRunLogs(undefined), undefined);
});

test("withoutRunLogs skips undefined entries (Partial sub-step maps)", () => {
  const stripped = withoutRunLogs({ description: run(), naming: undefined })!;
  assert.deepEqual(Object.keys(stripped), ["description"]);
});

// The migration script re-uploads persisted log lines to object storage, where
// the UI reads them back with parsePipelineLogContent — so the two must round-trip.
test("formatPipelineLogContent round-trips through parsePipelineLogContent", () => {
  const logs: LogLine[] = [
    { stream: "stdout", line: "Loaded 12 cases", ts: 1_760_000_000_000 },
    { stream: "stderr", line: "Traceback (most recent call last):", ts: 1_760_000_001_000 },
    { stream: "stdout", line: "Process exited with code 0", ts: 1_760_000_002_000 },
  ];

  assert.deepEqual(parsePipelineLogContent(formatPipelineLogContent(logs)), logs);
});
