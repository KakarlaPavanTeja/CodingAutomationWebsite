import assert from "node:assert/strict";
import test from "node:test";

import {
  pipelineStateCacheGet,
  pipelineStateCacheSet,
  pipelineStateCacheInvalidate,
  pipelineStateCacheClear,
} from "./pipeline-state-cache";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

// The module holds a singleton Map; each test must start from a known state.
test.beforeEach(() => {
  pipelineStateCacheClear();
});

test("get returns undefined when nothing is cached", () => {
  assert.equal(pipelineStateCacheGet(P1), undefined);
});

test("set then get round-trips data", () => {
  const data = { stepStatuses: { generate_question: "completed" } };
  pipelineStateCacheSet(P1, data);
  assert.deepEqual(pipelineStateCacheGet(P1), data);
});

test("different problem ids are independent", () => {
  pipelineStateCacheSet(P1, { x: 1 });
  pipelineStateCacheSet(P2, { y: 2 });
  assert.deepEqual(pipelineStateCacheGet(P1), { x: 1 });
  assert.deepEqual(pipelineStateCacheGet(P2), { y: 2 });
});

test("invalidate removes a single entry but leaves others", () => {
  pipelineStateCacheSet(P1, { a: 1 });
  pipelineStateCacheSet(P2, { b: 2 });
  pipelineStateCacheInvalidate(P1);
  assert.equal(pipelineStateCacheGet(P1), undefined);
  assert.deepEqual(pipelineStateCacheGet(P2), { b: 2 });
});

test("clear purges everything", () => {
  pipelineStateCacheSet(P1, { a: 1 });
  pipelineStateCacheSet(P2, { b: 2 });
  pipelineStateCacheClear();
  assert.equal(pipelineStateCacheGet(P1), undefined);
  assert.equal(pipelineStateCacheGet(P2), undefined);
});

test("entry expires after TTL", async () => {
  // Use a 1 ms TTL so the entry is dead by the time we check.
  pipelineStateCacheSet(P1, { fresh: true }, 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pipelineStateCacheGet(P1), undefined);
});

test("entry lives within its TTL", () => {
  pipelineStateCacheSet(P1, { alive: true }, 60_000);
  assert.deepEqual(pipelineStateCacheGet(P1), { alive: true });
});

test("custom TTL is honoured per entry", async () => {
  pipelineStateCacheSet(P1, { short: true }, 1);
  pipelineStateCacheSet(P2, { long: true }, 60_000);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pipelineStateCacheGet(P1), undefined);
  assert.deepEqual(pipelineStateCacheGet(P2), { long: true });
});

test("overwriting a key replaces the entry", () => {
  pipelineStateCacheSet(P1, { v: 1 });
  pipelineStateCacheSet(P1, { v: 2 });
  assert.deepEqual(pipelineStateCacheGet(P1), { v: 2 });
});

test("get returns the stored reference — mutating the returned value poisons the cache", () => {
  // This is documenting current behaviour, not a guarantee. Every caller
  // today passes the value straight to NextResponse.json (read-only), so
  // it's harmless. If a future caller needs a snapshot, defensive-copy
  // inside pipelineStateCacheGet before returning.
  pipelineStateCacheSet(P1, { count: 1 });
  const ref = pipelineStateCacheGet<{ count: number }>(P1);
  assert.deepEqual(ref, { count: 1 });
  ref!.count = 999;
  const fresh = pipelineStateCacheGet<{ count: number }>(P1);
  assert.deepEqual(fresh, { count: 999 });
});