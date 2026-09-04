import test from "node:test";
import assert from "node:assert/strict";
import { registryUpsertForBatch } from "./practice-set-db";

const BASE = {
  startIndex: 0,
  count: 1,
  orderStart: 1,
  existingCount: 0,
  loadVia: "sheet" as const,
  isNewSet: true,
};

test("an ordinary set is never renamed in the registry", () => {
  // The operator's form.title used to be written here. With registry rows
  // named "Coding Testing 1".."Coding Testing 10", renaming row 10 to
  // "Arrays practice" makes the next rollover count max 9 and mint a SECOND
  // "Coding Testing 10".
  assert.equal(
    registryUpsertForBatch({ questionSetId: "set-10", unitTitle: undefined }),
    null,
  );
});

test("a rollover-minted set is registered under its derived title", () => {
  assert.deepEqual(registryUpsertForBatch({ questionSetId: "set-11", unitTitle: "Coding Testing 11" }), {
    questionSetId: "set-11",
    unitName: "Coding Testing 11",
  });
});

test("a blank minted title is treated as no name rather than clearing the row", () => {
  assert.equal(registryUpsertForBatch({ ...BASE, questionSetId: "set-12", unitTitle: "   " }), null);
});
