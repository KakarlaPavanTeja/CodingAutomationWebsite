import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExamJsonFromQuestions,
  parseQuestionInput,
  parseQuestionsInput,
} from "./exam-json-scale";

const question = (n: number) => ({
  short_text: `q${n}`,
  total_score: 10,
  test_cases: [{ weightage: 3 }, { weightage: 7 }],
});

test("parseQuestionsInput reads every question in a multi-question file", () => {
  const parsed = parseQuestionsInput(JSON.stringify([question(1), question(2), question(3)]));
  assert.deepEqual(
    parsed.map((q) => q.short_text),
    ["q1", "q2", "q3"],
  );
});

test("parseQuestionsInput accepts a bare question object", () => {
  assert.equal(parseQuestionsInput(JSON.stringify(question(1))).length, 1);
});

test("parseQuestionsInput rejects empty arrays and non-object entries", () => {
  assert.throws(() => parseQuestionsInput("[]"), /empty/);
  assert.throws(() => parseQuestionsInput(JSON.stringify([question(1), 5])), /Entry 2/);
  assert.throws(() => parseQuestionsInput("not json"), /Invalid JSON/);
});

test("parseQuestionInput still returns the first question", () => {
  const first = parseQuestionInput(JSON.stringify([question(1), question(2)]));
  assert.equal(first.short_text, "q1");
});

test("buildExamJsonFromQuestions scales each question's weightage to its marks", () => {
  const parsed = parseQuestionsInput(JSON.stringify([question(1), question(2), question(3)]));
  const { examJson, meta } = buildExamJsonFromQuestions(
    parsed.map((q, i) => ({ question: q, marks: [50, 30, 20][i], fileName: `f [${i + 1}]` })),
    100,
  );
  assert.deepEqual(
    examJson.map((e) => e.total_score),
    [50, 30, 20],
  );
  assert.deepEqual(
    examJson.map((e) => e.test_cases!.map((tc) => tc.weightage)),
    [
      [15, 35],
      [9, 21],
      [6, 14],
    ],
  );
  assert.deepEqual(
    meta.map((m) => m.originalTotalScore),
    [10, 10, 10],
  );
});

test("buildExamJsonFromQuestions rejects marks that miss the exam total", () => {
  const parsed = parseQuestionsInput(JSON.stringify([question(1), question(2)]));
  assert.throws(
    () =>
      buildExamJsonFromQuestions(
        parsed.map((q) => ({ question: q, marks: 40, fileName: "f" })),
        100,
      ),
    /sum to 80/,
  );
});
