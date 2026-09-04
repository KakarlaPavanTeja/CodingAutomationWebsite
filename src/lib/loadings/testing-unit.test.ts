import test from "node:test";
import assert from "node:assert/strict";
import { nextChildOrder, nextTestingUnitTitle } from "./testing-unit";

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
