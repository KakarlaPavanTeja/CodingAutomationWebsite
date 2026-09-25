import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getSharedPostgresClient } from "./connect-postgres";

// postgres-js connects lazily, so no server is needed here.
const URL = "postgres://user:pass@127.0.0.1:1/none";

afterEach(async () => {
  await globalThis.__pgClient?.end({ timeout: 0 });
  globalThis.__pgClient = undefined;
});

test("reuses one pool across calls, including in production", () => {
  const prev = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    const a = getSharedPostgresClient(URL);
    const b = getSharedPostgresClient(URL);
    assert.equal(a, b);
    assert.equal(globalThis.__pgClient, a);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  }
});
