import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExamJsonFromQuestions,
  moveQuestion,
  parseQuestionInput,
  parseQuestionsInput,
  readDifficulty,
  readShortText,
} from "./exam-json-scale";

const question = (n: number) => ({
  short_text: `q${n}`,
  total_score: 10,
  test_cases: [{ weightage: 3 }, { weightage: 7 }],
});

/** Shape produced by the Python pipeline: human fields nested under `question`. */
const platformQuestion = (difficulty: unknown) => ({
  total_score: 10,
  test_cases: [{ weightage: 3 }, { weightage: 7 }],
  question: { difficulty, short_text: "Two Sum", content: "..." },
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

test("readDifficulty reads the nested pipeline shape, normalised", () => {
  assert.equal(readDifficulty(platformQuestion("medium")), "MEDIUM");
  assert.equal(readDifficulty(platformQuestion(" Hard ")), "HARD");
  assert.equal(readShortText(platformQuestion("EASY")), "Two Sum");
});

test("readDifficulty falls back to a flat shape and reports absence", () => {
  assert.equal(readDifficulty({ difficulty: "EASY", test_cases: [] }), "EASY");
  assert.equal(readDifficulty(platformQuestion("")), null);
  assert.equal(readDifficulty(platformQuestion(3)), null);
  assert.equal(readDifficulty({ test_cases: [] }), null);
  assert.equal(readShortText({ test_cases: [] }), null);
});

test("moveQuestion reorders and leaves out-of-range moves alone", () => {
  assert.deepEqual(moveQuestion(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveQuestion(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveQuestion(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveQuestion(["a", "b", "c"], 2, 3), ["a", "b", "c"]);
  assert.deepEqual(moveQuestion(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
});

test("row order drives the order of the generated exam JSON", () => {
  const parsed = parseQuestionsInput(JSON.stringify([question(1), question(2), question(3)]));
  const rows = parsed.map((q, i) => ({ question: q, marks: 30 + i * 5, fileName: `f${i}` }));
  const reordered = moveQuestion(rows, 2, 0);
  const { examJson } = buildExamJsonFromQuestions(reordered, 105);
  assert.deepEqual(
    examJson.map((e) => e.short_text),
    ["q3", "q1", "q2"],
  );
  // Marks travel with their question, they are not positional.
  assert.deepEqual(
    examJson.map((e) => e.total_score),
    [40, 30, 35],
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
