import test from "node:test";
import assert from "node:assert/strict";

// load-records.ts imports `@/lib/db`, which throws at module load if
// DATABASE_URL is unset. tsx --test does not read .env.local, so set a
// dummy value before the dynamic import below pulls the module in.
// postgres-js connects lazily, so no socket is opened. The import happens
// inside each test body (not at module top level) because tsx transforms
// this file as CJS here, which does not support top-level await.

test("formatLogLine prefixes a sortable IST timestamp and the phase", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { formatLogLine } = await import("./load-records");
  const line = formatLogLine("plan", "reusing set 9339f11e at order 25");
  assert.match(
    line,
    /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} IST\] \[plan\] reusing set 9339f11e at order 25$/,
  );
});

test("formatLogLine stamps a fixed instant in IST regardless of process timezone", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { formatLogLine } = await import("./load-records");
  // 2026-09-04T09:32:18Z is 2026-09-04 15:02:18 in Asia/Kolkata (UTC+5:30).
  const instant = new Date(Date.UTC(2026, 8, 4, 9, 32, 18));
  const line = formatLogLine("plan", "checkpoint", instant);
  assert.equal(line, "[2026-09-04 15:02:18 IST] [plan] checkpoint");
});

test("formatLogLine keeps multi-line messages on one entry", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { formatLogLine } = await import("./load-records");
  const line = formatLogLine("task", "line one\nline two");
  assert.ok(line.includes("line one line two"));
  assert.equal(line.split("\n").length, 1);
});
