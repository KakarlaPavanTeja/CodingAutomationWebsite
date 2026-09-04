import test from "node:test";
import assert from "node:assert/strict";
import { canSubmitLoad, mayForceLoad, type PriorLoadStatus } from "./load-anyway";

const STATUSES: PriorLoadStatus[] = ["none", "failed", "completed"];

test("mayForceLoad is always true, regardless of prior status", () => {
  for (const status of STATUSES) {
    assert.equal(mayForceLoad(status), true, status);
  }
});

test("canSubmitLoad: bare submit is fine with no prior load", () => {
  assert.equal(canSubmitLoad("none", false, "", false), true);
});

test("canSubmitLoad: bare submit is fine after a failed prior load (retry must not be a dead end)", () => {
  assert.equal(canSubmitLoad("failed", false, "", false), true);
});

test("canSubmitLoad: bare submit is blocked once a completed load exists (server would 409 it)", () => {
  assert.equal(canSubmitLoad("completed", false, "", false), false);
});

test("canSubmitLoad: forcing works after a failed prior load given real remarks", () => {
  assert.equal(canSubmitLoad("failed", true, "beta already had this question", false), true);
});

test("canSubmitLoad: forcing works with no prior load row at all", () => {
  assert.equal(canSubmitLoad("none", true, "pre-dates this table", false), true);
});

test("canSubmitLoad: forcing works after a completed load given real remarks", () => {
  assert.equal(canSubmitLoad("completed", true, "reload with new ids", false), true);
});

test("canSubmitLoad: empty remarks block a forced submit", () => {
  for (const status of STATUSES) {
    assert.equal(canSubmitLoad(status, true, "", false), false, status);
  }
});

test("canSubmitLoad: whitespace-only remarks block a forced submit", () => {
  for (const status of STATUSES) {
    assert.equal(canSubmitLoad(status, true, "   \n\t ", false), false, status);
  }
});

test("canSubmitLoad: a running load blocks a bare submit, whatever came before", () => {
  for (const status of STATUSES) {
    assert.equal(canSubmitLoad(status, false, "", true), false, status);
  }
});

test("canSubmitLoad: a running load blocks a FORCED submit too, remarks or not", () => {
  // This is the one that matters: the operator remounts the panel mid-load,
  // sees the "already loaded" banner, ticks "Load anyway" and types remarks —
  // and would otherwise start a second concurrent load into shared beta.
  for (const status of STATUSES) {
    assert.equal(canSubmitLoad(status, true, "reload with new ids", true), false, status);
  }
});

test("canSubmitLoad: the same states submit fine once nothing is running", () => {
  assert.equal(canSubmitLoad("none", false, "", false), true);
  assert.equal(canSubmitLoad("completed", true, "reload with new ids", false), true);
});
