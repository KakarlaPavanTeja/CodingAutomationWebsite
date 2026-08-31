import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedStatus } from "./status";

test("blocked statuses cannot sign in or browse", () => {
  assert.equal(isBlockedStatus("deactivated"), true);
  assert.equal(isBlockedStatus("left"), true);
});

test("active and pending_approval are not blocked here", () => {
  // pending_approval is routed to /pending-approval by the proxy, not blocked.
  assert.equal(isBlockedStatus("active"), false);
  assert.equal(isBlockedStatus("pending_approval"), false);
  assert.equal(isBlockedStatus(null), false);
  assert.equal(isBlockedStatus(undefined), false);
});
