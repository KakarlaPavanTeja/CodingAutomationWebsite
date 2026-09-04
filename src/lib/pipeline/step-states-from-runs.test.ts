import test from "node:test";
import assert from "node:assert/strict";
import { stepStatesFromRuns, deriveParentStatuses } from "./step-states-from-runs";

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

const ctx = {
  questionType: "function" as const, mode: "practice" as const,
  languages: ["python", "cpp", "java", "nodejs"],
  generateTitleWithAi: false, ownerTitle: "Some Title", ownerDifficulty: "easy",
};
const derive = (states: ReturnType<typeof stepStatesFromRuns>) =>
  deriveParentStatuses(states, { questionType: "function", gqContext: ctx, languages: ctx.languages });

test("generate_question reads running while its sub-steps are mid-flight", () => {
  const states = derive(stepStatesFromRuns([
    row("generate_question__description", "completed"),
    row("generate_question__naming", "running"),
  ]));
  assert.equal(states.get("generate_question")?.status, "running");
});

test("generate_question reads completed once every required sub-step is done", () => {
  const states = derive(stepStatesFromRuns([
    ...["description", "naming", "difficulty", "topics",
        "translate_cpp", "translate_java", "translate_nodejs"]
      .map((s) => row(`generate_question__${s}`, "completed", "2026-09-04T10:05:00Z")),
  ]));
  assert.equal(states.get("generate_question")?.status, "completed");
});

test("a language step is running until every enabled language finishes", () => {
  const partial = derive(stepStatesFromRuns([
    row("split_code__python", "completed", "2026-09-04T10:05:00Z"),
    row("split_code__cpp", "running"),
  ]));
  assert.equal(partial.get("split_code")?.status, "running");

  const all = derive(stepStatesFromRuns(
    ctx.languages.map((l) => row(`split_code__${l}`, "completed", "2026-09-04T10:05:00Z"))
  ));
  assert.equal(all.get("split_code")?.status, "completed");
});
