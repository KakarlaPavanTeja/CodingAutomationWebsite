import test from "node:test";
import assert from "node:assert/strict";
import { planLaunches } from "./launch-plan";
import { stepStatesFromRuns, deriveParentStatuses } from "./step-states-from-runs";

const LANGS = ["python", "cpp", "java", "nodejs"];
const ctx = {
  questionType: "function" as const, mode: "practice" as const, languages: LANGS,
  generateTitleWithAi: true, ownerTitle: "", ownerDifficulty: "easy",
};
const opts = { questionType: "function" as const, gqContext: ctx, languages: LANGS };

const row = (stepId: string, status: string) => ({
  stepId, status, exitCode: status === "completed" ? 0 : null,
  startedAt: new Date("2026-09-04T10:00:00Z"),
  finishedAt: status === "completed" ? new Date("2026-09-04T10:05:00Z") : null,
});
const build = (rows: ReturnType<typeof row>[]) =>
  deriveParentStatuses(stepStatesFromRuns(rows), opts);

test("a fresh generate_question starts only the description wave", () => {
  const plan = planLaunches("generate_question", build([]), opts);
  assert.deepEqual(plan.map((p) => p.subSteps[0]), ["description"]);
});

test("naming runs alone — no sibling may start beside it", () => {
  const plan = planLaunches("generate_question", build([
    row("generate_question__description", "completed"),
  ]), opts);
  assert.deepEqual(plan.map((p) => p.subSteps[0]), ["naming"]);
});

test("the metadata wave starts together once naming is done", () => {
  const plan = planLaunches("generate_question", build([
    row("generate_question__description", "completed"),
    row("generate_question__naming", "completed"),
  ]), opts);
  assert.deepEqual(plan.map((p) => p.subSteps[0]).sort(), ["difficulty", "titles", "topics"]);
});

test("brute force starts alongside the translation wave, not before it", () => {
  const done = ["description", "naming", "titles", "difficulty", "topics"];
  const plan = planLaunches("generate_question", build(
    done.map((s) => row(`generate_question__${s}`, "completed"))
  ), opts);
  assert.ok(plan.some((p) => p.stepId === "generate_brute_force"));
  assert.equal(plan.filter((p) => p.subSteps[0]?.startsWith("translate_")).length, 3);
});

test("a sub-step already running is never launched twice", () => {
  const plan = planLaunches("generate_question", build([
    row("generate_question__description", "running"),
  ]), opts);
  assert.deepEqual(plan, []);
});

test("a language step fans out one process per un-run language", () => {
  const plan = planLaunches("split_code", build([
    row("split_code__python", "completed"),
    row("split_code__cpp", "running"),
  ]), opts);
  assert.deepEqual(plan.map((p) => p.runKey), ["split_code__java", "split_code__nodejs"]);
});

test("a plain step is one process with the whole language set", () => {
  const plan = planLaunches("generate_testcases", build([]), opts);
  assert.deepEqual(plan, [{ stepId: "generate_testcases", subSteps: [], languages: LANGS }]);
});

test("enrichment carries its default sub-steps", () => {
  const plan = planLaunches("generate_enrichment", build([]), opts);
  assert.deepEqual(plan[0].subSteps, ["reallife", "hints", "followups"]);
});

test("titles is settled without a run when the AI title toggle is off", () => {
  const off = { ...opts, gqContext: { ...ctx, generateTitleWithAi: false, ownerTitle: "Manual" } };
  const states = deriveParentStatuses(stepStatesFromRuns([
    row("generate_question__description", "completed"),
    row("generate_question__naming", "completed"),
  ]), off);
  const plan = planLaunches("generate_question", states, off);
  assert.deepEqual(plan.map((p) => p.subSteps[0]).sort(), ["difficulty", "topics"]);
});
