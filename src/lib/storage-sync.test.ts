import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Force the local-filesystem backend and keep the module's db import inert:
// postgres.js builds its client lazily, so nothing here opens a connection.
// All of this must happen before storage-sync is imported.
process.env.DATABASE_URL ??= "postgres://user:pass@127.0.0.1:5432/unused";
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_REGION;
delete process.env.AWS_BUCKET_NAME;
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const ROOT = mkdtempSync(path.join(tmpdir(), "storage-sync-test-"));
process.env.LOCAL_OBJECT_STORAGE_ROOT = ROOT;

// Imported lazily: these files build as CJS, so there is no top-level await.
let mod: typeof import("./storage-sync") | undefined;
const load = async () => (mod ??= await import("./storage-sync"));

const PROBLEM = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

/** A log big enough that re-uploading it on every sync tick would hurt. */
const bigLog = () =>
  Array.from({ length: 80_000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");

test("log keys keep the layout uploadLog and the archival script agree on", async () => {
  const { stepLogKey, runLogKey } = await load();
  assert.equal(stepLogKey(PROBLEM, "execute_tests"), `${PROBLEM}/logs/execute_tests.log`);
  assert.equal(
    runLogKey(PROBLEM, "execute_tests", RUN),
    `${PROBLEM}/logs/runs/execute_tests/${RUN}.log`,
  );
});

test("a live sync writes the log to storage, not the database", async () => {
  const { syncLogToStorage, getLogContent, runLogKey } = await load();
  await syncLogToStorage(PROBLEM, "step_live", RUN, "line one\nline two\n");

  const onDisk = await readFile(path.join(ROOT, runLogKey(PROBLEM, "step_live", RUN)), "utf-8");
  assert.equal(onDisk, "line one\nline two\n");
  assert.equal(await getLogContent(PROBLEM, "step_live", RUN), "line one\nline two\n");
});

test("a running step publishes a bounded tail however large the log grows", async () => {
  const { syncLogToStorage, getLogContent } = await load();
  const huge = bigLog();
  assert.ok(huge.length > 4_000_000, "fixture should dwarf the tail cap");

  await syncLogToStorage(PROBLEM, "step_big", RUN, huge);
  const stored = (await getLogContent(PROBLEM, "step_big", RUN))!;

  assert.ok(stored.length < 300 * 1024, `tail should stay bounded, got ${stored.length} bytes`);
  assert.match(stored, /^\[log truncated while running/);
  // The tail is what matters to someone watching a run: it must reach the end.
  assert.ok(stored.endsWith(huge.slice(-100)), "tail should end where the log ends");
  // ...and resume on a clean line rather than mid-line.
  assert.doesNotMatch(stored.split("\n")[1] ?? "", /^x+$/);
});

test("finishing a step replaces the tail with the complete log", async () => {
  const { syncLogToStorage, uploadLog, getLogContent } = await load();
  const full = bigLog();
  await syncLogToStorage(PROBLEM, "step_done", RUN, full);
  await uploadLog(PROBLEM, "step_done", RUN, full);

  assert.equal(await getLogContent(PROBLEM, "step_done", RUN), full);
});

// Not covered here: getLogContent() without a runId, which first queries
// pipeline_runs for an in-flight run and so needs a live database. Run
// metadata staying in Postgres is the intent — only log content moved out.
