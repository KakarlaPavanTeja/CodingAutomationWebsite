import test from "node:test";
import assert from "node:assert/strict";
import { capacityFromLookup, parseQuestionSetQuestionRows } from "./question-set";
import { buildSheetCellUpdates, deriveSheetName, loadCodingQuestions } from "./load-coding-questions";

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

const MINTED = {
  unitTitle: "Coding Testing 11",
  childOrder: 11,
  parentResource: "parent-resource-id",
};

test("buildSheetCellUpdates maps the documented cells for a minted unit", () => {
  const updates = buildSheetCellUpdates({ questionSetId: SET, unitId: "unit-1", batch: MINTED });
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

test("the derived sheet carries the configured parent and auto-unlocks", () => {
  // H3 decides where the unit lands in the real beta course tree, and the
  // operator used to type it. It must now be exactly the parent the planner
  // derived `childOrder` against, and auto-unlock is fixed by spec §3 step 2.
  const cell = (range: string) =>
    buildSheetCellUpdates({ questionSetId: SET, unitId: "unit-1", batch: MINTED }).find(
      (u) => u.range === range,
    )?.values[0][0];

  assert.equal(cell("ResourcesData!H3"), "parent-resource-id");
  assert.equal(cell("ResourcesData!G3"), "11");
  assert.equal(cell("ResourcesData!I2"), "TRUE");
  assert.equal(cell("QuestionSet!B2"), "Coding Testing 11");
});

test("an existing unit is never re-placed in the course tree", () => {
  // No childOrder means the planner did not mint this unit: it already sits
  // somewhere under some parent at an order nothing here computed. Writing
  // G3/H3 would move it.
  const ranges = buildSheetCellUpdates({
    questionSetId: SET,
    unitId: "unit-1",
    batch: { unitTitle: undefined, childOrder: undefined, parentResource: undefined },
  }).map((u) => u.range);

  assert.ok(!ranges.includes("ResourcesData!G3"));
  assert.ok(!ranges.includes("ResourcesData!H3"));
  assert.ok(ranges.includes("ResourcesData!I2"));
});

test("a minted unit with no parent resource fails loudly instead of going unparented", () => {
  assert.throws(
    () =>
      buildSheetCellUpdates({
        questionSetId: SET,
        unitId: "unit-1",
        batch: { unitTitle: "Coding Testing 11", childOrder: 11, parentResource: "" },
      }),
    /NKB_TESTING_PARENT_RESOURCE/,
  );
});

test("deriveSheetName names the unit and stamps the time", () => {
  const at = new Date("2026-09-04T10:15:30.000Z");
  assert.equal(
    deriveSheetName({ questionSetId: SET, unitTitle: "Coding Testing 11" }, at),
    "Coding Testing 11 2026-09-04 10:15:30",
  );
  // No derived title (an existing set) still gets something findable in Drive.
  assert.equal(
    deriveSheetName({ questionSetId: SET, unitTitle: undefined }, at),
    `Question set ${SET} 2026-09-04 10:15:30`,
  );
});

test("loadCodingQuestions reports missing config through onLog", async () => {
  const seen: string[] = [];
  const prev = process.env.NKB_LOAD_DATA_PASSWORD;
  delete process.env.NKB_LOAD_DATA_PASSWORD;

  const result = await loadCodingQuestions([{ question_id: "q1" }], {
    onLog: (phase, msg) => seen.push(`${phase}:${msg}`),
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Missing/);
  assert.ok(seen.some((l) => l.startsWith("config:")));
  if (prev) process.env.NKB_LOAD_DATA_PASSWORD = prev;
});

test("loadCodingQuestions swallows a throwing onLog instead of failing the call", async () => {
  const prev = process.env.NKB_LOAD_DATA_PASSWORD;
  delete process.env.NKB_LOAD_DATA_PASSWORD;

  const result = await loadCodingQuestions([{ question_id: "q1" }], {
    onLog: () => {
      throw new Error("db write failed");
    },
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Missing/);
  if (prev) process.env.NKB_LOAD_DATA_PASSWORD = prev;
});
