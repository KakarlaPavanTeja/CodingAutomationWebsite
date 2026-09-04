import test from "node:test";
import assert from "node:assert/strict";
import {
  alreadyLoadedMessage,
  capacityFromLookup,
  findAlreadyLoadedQuestions,
  parseQuestionSetQuestionRows,
} from "./question-set";
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

test("the sheet path refuses to load when the planner derived no placement", () => {
  // An existing-but-empty registry set (its questions deleted in beta admin)
  // reaches the sheet path with no title, order or parent. Skipping G3/H3/B2
  // does NOT blank them: the sheet is a copy of a template that ships sample
  // rows, so SHEET_LOADING would submit the TEMPLATE's parent and title and
  // drop an untitled unit somewhere in the real beta course tree. Refusing is
  // the only safe answer, and the message has to tell the operator what to do.
  assert.throws(
    () =>
      buildSheetCellUpdates({
        questionSetId: SET,
        unitId: "unit-1",
        batch: { unitTitle: undefined, childOrder: undefined, parentResource: undefined },
      }),
    (err: Error) => {
      assert.match(err.message, /Refusing to load/);
      assert.match(err.message, /registry/);
      assert.ok(err.message.includes(SET), "names the question set");
      return true;
    },
  );
});

test("the sheet path refuses a placement that is only half derived", () => {
  // A title with no child order (or an order with no title) is still the
  // template's own placement for whichever cell goes unwritten.
  for (const batch of [
    { unitTitle: "Coding Testing 11", childOrder: undefined, parentResource: "parent-resource-id" },
    { unitTitle: undefined, childOrder: 11, parentResource: "parent-resource-id" },
    { unitTitle: "   ", childOrder: 11, parentResource: "parent-resource-id" },
  ]) {
    assert.throws(
      () => buildSheetCellUpdates({ questionSetId: SET, unitId: "unit-1", batch }),
      /Refusing to load/,
      JSON.stringify(batch),
    );
  }
});

test("a fully derived placement still produces every documented cell value", () => {
  const cells = Object.fromEntries(
    buildSheetCellUpdates({ questionSetId: SET, unitId: "unit-1", batch: MINTED }).map((u) => [
      u.range,
      u.values[0][0],
    ]),
  );
  assert.deepEqual(cells, {
    "ResourcesData!A2": SET,
    "ResourcesData!G3": "11",
    "ResourcesData!H3": "parent-resource-id",
    "ResourcesData!I2": "TRUE",
    "Units!A2": SET,
    "Units!B2": "unit-1",
    "QuestionSet!A2": SET,
    "QuestionSet!B2": "Coding Testing 11",
  });
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

test("a question-id search reports the set that holds it (live-admin row shape)", () => {
  // Verified against the beta admin: searching the changelist by QUESTION id
  // returns that question's row, and the parser — matching the cell equal to
  // the search term — reports the row's other uuid, the question set.
  const html = changelist([`<tr><td>${SET}</td><td>${Q1}</td><td>26</td><td>True</td></tr>`]);
  assert.deepEqual(parseQuestionSetQuestionRows(html, Q1), [
    { questionSetId: Q1, questionId: SET, order: 26 },
  ]);
});

test("findAlreadyLoadedQuestions reports only the ids the admin knows, de-duped", async () => {
  const asked: string[] = [];
  const existing = await findAlreadyLoadedQuestions([Q1, " ", Q2, Q1, ""], async (id) => {
    asked.push(id);
    return id === Q1 ? [SET, OTHER_SET] : [];
  });
  assert.deepEqual(asked, [Q1, Q2]);
  assert.deepEqual(existing, [{ questionId: Q1, questionSetIds: [SET, OTHER_SET] }]);
});

test("findAlreadyLoadedQuestions returns nothing when no id is in beta", async () => {
  assert.deepEqual(await findAlreadyLoadedQuestions([Q1, Q2], async () => []), []);
});

test("findAlreadyLoadedQuestions propagates a failed lookup so the caller can proceed", async () => {
  await assert.rejects(
    () => findAlreadyLoadedQuestions([Q1], async () => { throw new Error("admin 502"); }),
    /admin 502/,
  );
});

test("alreadyLoadedMessage names the ids, their sets and the way out", () => {
  const message = alreadyLoadedMessage([{ questionId: Q1, questionSetIds: [SET] }]);
  assert.match(message, new RegExp(Q1));
  assert.match(message, new RegExp(SET));
  assert.match(message, /Load anyway \(regenerate ids\)/);
});
