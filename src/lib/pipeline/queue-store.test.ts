import test from "node:test";
import assert from "node:assert/strict";

// queue-store.ts imports `@/lib/db`, which throws at module load if
// DATABASE_URL is unset. tsx --test does not read .env.local, so set a dummy
// value before the dynamic import (postgres-js connects lazily, so no socket
// is opened). The import sits inside each test body because tsx transforms
// this file as CJS, which has no top-level await.
const load = async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  return import("./queue-store");
};

const good = {
  steps: ["generate_question"],
  questionType: "function",
  mode: "practice",
  gqContext: {
    questionType: "function", mode: "practice", languages: ["Python"],
    generateTitleWithAi: false, ownerTitle: "T", ownerDifficulty: "",
  },
  startedAt: "2026-09-04T10:00:00Z",
};

test("parses a well-formed stored queue", async () => {
  const { parseStoredQueue } = await load();
  const q = parseStoredQueue(good);
  assert.equal(q?.steps.length, 1);
  assert.equal(q?.gqContext.ownerTitle, "T");
});

test("returns null for malformed stored values rather than throwing", async () => {
  const { parseStoredQueue } = await load();
  for (const bad of [null, undefined, "queue", 42, {}, { steps: "nope" }, { ...good, steps: [1] }]) {
    assert.equal(parseStoredQueue(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("an empty queue is not active", async () => {
  const { parseStoredQueue } = await load();
  assert.equal(parseStoredQueue({ ...good, steps: [] }), null);
});
