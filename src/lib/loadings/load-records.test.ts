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

test("capLogText leaves a log that fits the cap untouched", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { capLogText } = await import("./load-records");
  const log = "[a] one\n[b] two\n";
  assert.equal(capLogText(log, 64), log);
});

test("capLogText keeps the newest lines, marks the drop and never exceeds the cap", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { capLogText, LOG_TRUNCATION_MARKER } = await import("./load-records");
  const log = Array.from({ length: 400 }, (_, i) => `[line ${i}] ${"x".repeat(40)}`).join("\n") + "\n";
  const capped = capLogText(log, 1000);

  assert.equal(capped.length, 1000);
  assert.equal(capped.startsWith(`${LOG_TRUNCATION_MARKER}\n`), true);
  assert.equal(capped.endsWith("[line 399] " + "x".repeat(40) + "\n"), true);
  assert.equal(capped.includes("[line 0]"), false);
});

test("buildCompletionSummary reports success, the set id, the count and an order range", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { buildCompletionSummary } = await import("./load-records");
  const instant = new Date(Date.UTC(2026, 8, 4, 9, 32, 18)); // 2026-09-04 15:02:18 IST
  const line = buildCompletionSummary(
    {
      questionSetId: "9339f11e",
      questionIds: ["q1", "q2", "q3"],
      orderRange: { start: 25, end: 27 },
    },
    instant,
  );
  assert.equal(
    line,
    "[2026-09-04 15:02:18 IST] [summary] succeeded: loaded 3 question(s) into set 9339f11e (order 25-27)",
  );
});

test("buildCompletionSummary omits the order range when none is available", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { buildCompletionSummary } = await import("./load-records");
  const instant = new Date(Date.UTC(2026, 8, 4, 9, 32, 18));
  const line = buildCompletionSummary(
    { questionSetId: "abc123", questionIds: ["q1"] },
    instant,
  );
  assert.equal(
    line,
    "[2026-09-04 15:02:18 IST] [summary] succeeded: loaded 1 question(s) into set abc123",
  );
});

test("buildCompletionSummary falls back to a placeholder when there is no set id", async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { buildCompletionSummary } = await import("./load-records");
  const line = buildCompletionSummary({ questionSetId: null, questionIds: [] });
  assert.match(line, /\[summary\] succeeded: loaded 0 question\(s\) into set \(none\)$/);
});
