import assert from "node:assert/strict";
import test from "node:test";
import { accountForKeyFingerprint, openRouterKeyFingerprint } from "./openrouter";

const NEW_KEY = "sk-or-v1-test-new-key";
const OLD_KEY = "sk-or-v1-test-old-key";

function withKeys(fn: () => void) {
  const before = [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_OLD];
  process.env.OPENROUTER_API_KEY = NEW_KEY;
  process.env.OPENROUTER_API_KEY_OLD = OLD_KEY;
  try {
    fn();
  } finally {
    process.env.OPENROUTER_API_KEY = before[0];
    process.env.OPENROUTER_API_KEY_OLD = before[1];
  }
}

test("a fingerprint names the key that was actually billed", () => {
  withKeys(() => {
    assert.equal(accountForKeyFingerprint(openRouterKeyFingerprint(NEW_KEY)), "new");
    assert.equal(accountForKeyFingerprint(openRouterKeyFingerprint(OLD_KEY)), "old");
  });
});

test("an unknown, empty or missing fingerprint resolves to null so the caller falls back", () => {
  withKeys(() => {
    for (const fp of ["deadbeefcafe", "", null, undefined]) {
      assert.equal(accountForKeyFingerprint(fp), null, `fp=${String(fp)}`);
    }
  });
});

test("the fingerprint leaks nothing usable: short, hex, and not a slice of the key", () => {
  const fp = openRouterKeyFingerprint(NEW_KEY);
  assert.match(fp, /^[0-9a-f]{12}$/);
  assert.ok(!NEW_KEY.includes(fp), "a slice of the key would be a partial credential");
});

test("surrounding whitespace in a configured key does not break attribution", () => {
  const before = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = `  ${NEW_KEY}\n`;
  try {
    assert.equal(accountForKeyFingerprint(openRouterKeyFingerprint(NEW_KEY)), "new");
  } finally {
    process.env.OPENROUTER_API_KEY = before;
  }
});

test("two different keys never share a fingerprint", () => {
  assert.notEqual(openRouterKeyFingerprint(NEW_KEY), openRouterKeyFingerprint(OLD_KEY));
});
