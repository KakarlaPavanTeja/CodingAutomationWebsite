import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_TRUSTWORTHY_FROM,
  NEW_KEY_START,
  accountForUsageRow,
  hasApproximateAccounts,
  usageRowAccount,
} from "./openrouter-usage-account";

/** An instant `ms` after `d`, as the ISO string the API hands the dashboard. */
function at(d: Date, ms: number): string {
  return new Date(d.getTime() + ms).toISOString();
}

test("single-key-era rows are the old key, whatever the column default says", () => {
  // These rows carry account="new" only because that is the column's DB default.
  // One key existed then, and it is the one now configured as _OLD.
  const row = { account: "new", created_at: at(NEW_KEY_START, -1) };
  assert.deepEqual(usageRowAccount(row), {
    account: "old",
    confidence: "single-key-era",
  });
});

test("a row exactly at the new key's go-live is no longer single-key-era", () => {
  const row = { account: "new", created_at: at(NEW_KEY_START, 0) };
  assert.equal(usageRowAccount(row).confidence, "approximate");
});

test("after the fingerprint fix the recorded account wins, including 'old'", () => {
  // The whole point: an admin can switch the active key back to "old" at any
  // time. The old date-only heuristic called every recent row "new".
  const row = { account: "old", created_at: at(ACCOUNT_TRUSTWORTHY_FROM, 60_000) };
  assert.deepEqual(usageRowAccount(row), {
    account: "old",
    confidence: "recorded",
  });
});

test("after the fingerprint fix a recorded 'new' is also trusted", () => {
  const row = { account: "new", created_at: at(ACCOUNT_TRUSTWORTHY_FROM, 60_000) };
  assert.deepEqual(usageRowAccount(row), {
    account: "new",
    confidence: "recorded",
  });
});

test("between go-live and the fix, the column is used but flagged approximate", () => {
  // ~$37.70 of old-key spend in this window was tagged "new" and never
  // backfilled, so the value is the best signal available, not the truth.
  const row = { account: "new", created_at: at(NEW_KEY_START, 60_000) };
  assert.deepEqual(usageRowAccount(row), {
    account: "new",
    confidence: "approximate",
  });
});

test("a missing or unrecognised account does not drop the row from totals", () => {
  const created = at(ACCOUNT_TRUSTWORTHY_FROM, 60_000);
  for (const account of [null, undefined, "", "NEW", "legacy"]) {
    const resolved = usageRowAccount({ account, created_at: created });
    assert.equal(resolved.account, "new", `account=${String(account)}`);
    assert.equal(
      resolved.confidence,
      "approximate",
      "a guessed value must not claim to be recorded",
    );
  }
});

test("an unparseable timestamp falls back to the recorded account", () => {
  assert.deepEqual(usageRowAccount({ account: "old", created_at: "not a date" }), {
    account: "old",
    confidence: "approximate",
  });
});

test("a Date is accepted as well as an ISO string", () => {
  const asDate = usageRowAccount({
    account: "old",
    created_at: new Date(ACCOUNT_TRUSTWORTHY_FROM.getTime() + 60_000),
  });
  assert.deepEqual(asDate, { account: "old", confidence: "recorded" });
});

test("accountForUsageRow is the account alone, for filtering", () => {
  assert.equal(
    accountForUsageRow({ account: "old", created_at: at(ACCOUNT_TRUSTWORTHY_FROM, 1) }),
    "old",
  );
  assert.equal(accountForUsageRow({ account: "new", created_at: at(NEW_KEY_START, -1) }), "old");
});

test("hasApproximateAccounts spots a set that cannot be reported exactly", () => {
  const recorded = { account: "old", created_at: at(ACCOUNT_TRUSTWORTHY_FROM, 1) };
  const singleKey = { account: "new", created_at: at(NEW_KEY_START, -1) };
  const approximate = { account: "new", created_at: at(NEW_KEY_START, 1) };

  assert.equal(hasApproximateAccounts([recorded, singleKey]), false);
  assert.equal(hasApproximateAccounts([recorded, approximate]), true);
  assert.equal(hasApproximateAccounts([]), false);
});
