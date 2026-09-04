import test from "node:test";
import assert from "node:assert/strict";
import { capacityFromLookup, parseQuestionSetQuestionRows } from "./question-set";
import { buildSheetCellUpdates, loadCodingQuestions } from "./load-coding-questions";

const SET = "11111111-1111-4111-8111-111111111111";
const Q1 = "22222222-2222-4222-8222-222222222222";
const Q2 = "33333333-3333-4333-8333-333333333333";
const OTHER_SET = "44444444-4444-4444-8444-444444444444";

function changelist(rows: string[]): string {
  return `<table id="result_list"><tbody>${rows.join("")}</tbody></table>`;
}

test("parseQuestionSetQuestionRows reads set id, question id and order", () => {
  const html = changelist([
    `<tr><td>${SET}</td><td>${Q1}</td><td>3</td><td>True</td></tr>`,
    `<tr><td>${SET}</td><td>${Q2}</td><td>4</td><td>False</td></tr>`,
  ]);
  assert.deepEqual(parseQuestionSetQuestionRows(html, SET), [
    { questionSetId: SET, questionId: Q1, order: 3 },
    { questionSetId: SET, questionId: Q2, order: 4 },
  ]);
});

test("parseQuestionSetQuestionRows drops rows belonging to another set", () => {
  const html = changelist([
    `<tr><td>${OTHER_SET}</td><td>${Q1}</td><td>1</td></tr>`,
    `<tr><td>${SET}</td><td>${Q2}</td><td>2</td></tr>`,
  ]);
  assert.deepEqual(parseQuestionSetQuestionRows(html, SET), [
    { questionSetId: SET, questionId: Q2, order: 2 },
  ]);
});

test("parseQuestionSetQuestionRows ignores the empty changelist row", () => {
  const html = changelist([`<tr><td colspan="4">There are no question set questions.</td></tr>`]);
  assert.deepEqual(parseQuestionSetQuestionRows(html, SET), []);
});

test("capacityFromLookup reports room and the next order", () => {
  assert.deepEqual(capacityFromLookup({ count: 48, maxOrder: 48, questionIds: [] }), {
    room: 2,
    nextOrder: 49,
    full: false,
  });
  assert.deepEqual(capacityFromLookup({ count: 50, maxOrder: 50, questionIds: [] }), {
    room: 0,
    nextOrder: 51,
    full: true,
  });
  // Empty set: orders start at 1, not 0.
  assert.equal(capacityFromLookup({ count: 0, maxOrder: 0, questionIds: [] }).nextOrder, 1);
});

test("buildSheetCellUpdates maps the documented cells and skips blanks", () => {
  const updates = buildSheetCellUpdates({
    questionSetId: SET,
    unitId: "unit-1",
    form: {
      sheetName: "sheet",
      childOrder: "5",
      parentResource: "parent",
      autoUnlock: "TRUE",
      title: "My unit",
      durationInSec: "",
    },
  });
  assert.deepEqual(
    updates.map((u) => u.range),
    [
      "ResourcesData!A2",
      "ResourcesData!G3",
      "ResourcesData!H3",
      "ResourcesData!I2",
      "Units!A2",
      "Units!B2",
      "QuestionSet!A2",
      "QuestionSet!B2",
    ],
  );
});

test("buildSheetCellUpdates turns MM:SS into a seconds formula", () => {
  const withDuration = (durationInSec: string) =>
    buildSheetCellUpdates({
      questionSetId: SET,
      unitId: "unit-1",
      form: {
        sheetName: "s",
        childOrder: "1",
        parentResource: "p",
        autoUnlock: "TRUE",
        title: "t",
        durationInSec,
      },
    }).find((u) => u.range === "Units!D2")?.values[0][0];

  assert.equal(withDuration("47:01"), "=47*60+01");
  assert.equal(withDuration("120"), "120");
  assert.equal(withDuration(""), undefined);
});

test("loadCodingQuestions reports missing config through onLog", async () => {
  const seen: string[] = [];
  const prev = process.env.NKB_LOAD_DATA_PASSWORD;
  delete process.env.NKB_LOAD_DATA_PASSWORD;

  const result = await loadCodingQuestions(
    [{ question_id: "q1" }],
    { sheetName: "s", title: "t", childOrder: "1", parentResource: "p", autoUnlock: "TRUE" },
    { onLog: (phase, msg) => seen.push(`${phase}:${msg}`) },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Missing/);
  assert.ok(seen.some((l) => l.startsWith("config:")));
  if (prev) process.env.NKB_LOAD_DATA_PASSWORD = prev;
});
