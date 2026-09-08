import assert from "node:assert/strict";
import test from "node:test";

import { NKB_SHEET_READER_EMAIL, sheetShareTargets } from "./google-sheets";

// The NKB reader has to be on every copy — a sheet it cannot open fails
// SHEET_LOADING with no reason, which is what this list exists to prevent.
test("sheetShareTargets always includes the NKB reader", () => {
  delete process.env.GOOGLE_SHEET_SHARE_EMAILS;
  assert.deepEqual(sheetShareTargets(), [NKB_SHEET_READER_EMAIL]);

  process.env.GOOGLE_SHEET_SHARE_EMAILS = " a@x.com , ,b@x.com ";
  assert.deepEqual(sheetShareTargets(), [NKB_SHEET_READER_EMAIL, "a@x.com", "b@x.com"]);

  // Explicit emails override the env list but never drop the reader, and the
  // reader is not duplicated when a caller names it too.
  assert.deepEqual(sheetShareTargets(["c@x.com", NKB_SHEET_READER_EMAIL]), [
    NKB_SHEET_READER_EMAIL,
    "c@x.com",
  ]);
  delete process.env.GOOGLE_SHEET_SHARE_EMAILS;
});
