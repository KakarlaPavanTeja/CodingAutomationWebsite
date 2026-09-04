import test from "node:test";
import assert from "node:assert/strict";
import { nextChildOrder, nextTestingUnitTitle, createNextTestingUnit } from "./testing-unit";

const HEADER = ["unit_id", "unit_name", "topic_order", "unit_order"];

test("nextChildOrder returns max unit_order + 1", () => {
  const rows = [HEADER, ["u1", "Coding Testing 1", "3", "7"], ["u2", "Coding Testing 2", "3", "12"]];
  assert.equal(nextChildOrder(rows), 13);
});

test("nextChildOrder starts at 1 when the parent has no units", () => {
  assert.equal(nextChildOrder([HEADER]), 1);
  assert.equal(nextChildOrder([]), 1);
});

test("nextChildOrder ignores non-numeric orders rather than producing NaN", () => {
  const rows = [HEADER, ["u1", "x", "3", ""], ["u2", "y", "3", "not-a-number"], ["u3", "z", "3", "4"]];
  assert.equal(nextChildOrder(rows), 5);
});

test("nextTestingUnitTitle continues the numbering", () => {
  assert.equal(nextTestingUnitTitle(["Coding Testing 1", "Coding Testing 9"]), "Coding Testing 10");
  assert.equal(nextTestingUnitTitle([]), "Coding Testing 1");
  assert.equal(nextTestingUnitTitle(["Unrelated unit"]), "Coding Testing 1");
});

test("createNextTestingUnit refuses to run without a configured parent", async () => {
  const prev = process.env.NKB_TESTING_PARENT_RESOURCE;
  delete process.env.NKB_TESTING_PARENT_RESOURCE;
  await assert.rejects(() => createNextTestingUnit({}), /NKB_TESTING_PARENT_RESOURCE/);
  if (prev) process.env.NKB_TESTING_PARENT_RESOURCE = prev;
});

test("createNextTestingUnit advances title and child order across two mints in one run", async () => {
  const prev = process.env.NKB_TESTING_PARENT_RESOURCE;
  process.env.NKB_TESTING_PARENT_RESOURCE = "test-parent";
  const stubRows = async () => [
    ["unit_id", "parent_resource_id", "unit_order"],
    ["u1", "test-parent", "9"],
  ];
  try {
    const first = await createNextTestingUnit({
      existingUnitNames: ["Coding Testing 9"],
      fetchRows: stubRows,
    });
    // Simulate the planner loop: fold the first mint's title into the names
    // for the second call, and bump the offset — nothing here touches beta.
    const second = await createNextTestingUnit({
      existingUnitNames: ["Coding Testing 9", first.title],
      childOrderOffset: 1,
      fetchRows: stubRows,
    });

    assert.equal(first.title, "Coding Testing 10");
    assert.equal(first.childOrder, 10);
    assert.equal(second.title, "Coding Testing 11");
    assert.equal(second.childOrder, 11);
    assert.notEqual(first.title, second.title);
    assert.notEqual(first.childOrder, second.childOrder);
  } finally {
    if (prev) process.env.NKB_TESTING_PARENT_RESOURCE = prev;
    else delete process.env.NKB_TESTING_PARENT_RESOURCE;
  }
});

test("createNextTestingUnit refuses to mint when the admin scrape finds no children", async () => {
  const prev = process.env.NKB_TESTING_PARENT_RESOURCE;
  process.env.NKB_TESTING_PARENT_RESOURCE = "test-parent";
  // Header row only: the testing parent always has children, so this means the
  // scrape broke. Minting anyway would put the unit at child order 1 in the
  // live course tree.
  const emptyRows = async () => [["unit_id", "parent_resource_id", "unit_order"]];
  try {
    await assert.rejects(
      () => createNextTestingUnit({ existingUnitNames: ["Coding Testing 9"], fetchRows: emptyRows }),
      /No child units found/,
    );
  } finally {
    if (prev) process.env.NKB_TESTING_PARENT_RESOURCE = prev;
    else delete process.env.NKB_TESTING_PARENT_RESOURCE;
  }
});
