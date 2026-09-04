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

test("a soft-orphaned run still reads as running, as it does on the client", () => {
  const states = stepStatesFromRuns([
    { ...row("generate_testcases", "failed"), exitCode: -2 },
  ]);
  assert.equal(states.get("generate_testcases")?.status, "running");
});
