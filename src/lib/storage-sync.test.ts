import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

// ---------------------------------------------------------------------------
// Selective output upload.
//
// Every pipeline step runs in its own temp workspace hydrated with a FULL copy of
// the problem's Outputs, then uploads on exit. An unrestricted upload re-sends the
// files the step never opened, so when two steps run in parallel the one finishing
// last REVERTS the other's work: `naming` rewrote generatedFullCode/PYTHON.py while
// `titles`/`difficulty`/`topics` each held the pre-naming copy, and whichever
// finished last put the stale one back. The signature JSON survived (no sibling had
// that file), leaving a signature naming `findPairs` beside code with the old name —
// and the stdin/checker gates had passed on code that was then discarded.
//
// These exercise the real uploadOutputsFromDir against the storage backend.
// ---------------------------------------------------------------------------

/** Build a workspace the way createTempWorkspace does, then return the spawn bound. */
async function hydrateWorkspace(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "ws-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  // The route captures Date.now() - 1s just before spawn. Wait past that bound so
  // hydrated files are unambiguously older than it, as they are in production
  // (the hydration downloads all finish before the process starts).
  await new Promise((r) => setTimeout(r, 1_100));
  return { dir, runStartedAtMs: Date.now() - 1_000 };
}

const HYDRATED = {
  "generated_description.md": "the statement",
  "problem_flags.json": '{"open_ended": false}',
  "io_contract.json": '{"verified": true}',
  "generated_titles.txt": "A Title",
  "generatedFullCode/PYTHON.py": "PRE-NAMING",
};

test("a step publishes only the files it wrote, not its whole hydrated workspace", async () => {
  const { uploadOutputsFromDir } = await load();
  const P = "33333333-3333-4333-8333-333333333333";
  const { dir, runStartedAtMs } = await hydrateWorkspace(HYDRATED);

  // Seed storage with the pre-naming state, as the description step would have.
  await uploadOutputsFromDir(P, dir);

  // Now `naming` runs: it rewrites PYTHON.py and adds the signature. Nothing else.
  await new Promise((r) => setTimeout(r, 1_100));
  await writeFile(path.join(dir, "generatedFullCode/PYTHON.py"), "NORMALIZED");
  await writeFile(path.join(dir, "description_signature.json"), '{"function_name":"x"}');

  const count = await uploadOutputsFromDir(P, dir, runStartedAtMs);

  assert.equal(count, 2, "only the two written files should be published");
  assert.equal(
    await readFile(path.join(ROOT, `${P}/outputs/generatedFullCode/PYTHON.py`), "utf-8"),
    "NORMALIZED",
  );
});

test("a sibling step that touched nothing cannot revert another step's work", async () => {
  const { uploadOutputsFromDir } = await load();
  const P = "44444444-4444-4444-8444-444444444444";
  const key = path.join(ROOT, `${P}/outputs/generatedFullCode/PYTHON.py`);

  // `naming` finishes first and publishes the normalized reference.
  const naming = await hydrateWorkspace(HYDRATED);
  await writeFile(path.join(naming.dir, "generatedFullCode/PYTHON.py"), "NORMALIZED");
  await uploadOutputsFromDir(P, naming.dir, naming.runStartedAtMs);
  assert.equal(await readFile(key, "utf-8"), "NORMALIZED");

  // `topics` started earlier, holds the PRE-NAMING copy, and finishes last. It wrote
  // only generated_topics.json. This is the exact race that reverted the rename.
  const topics = await hydrateWorkspace(HYDRATED);
  await new Promise((r) => setTimeout(r, 1_100));
  await writeFile(path.join(topics.dir, "generated_topics.json"), '["graphs"]');
  const count = await uploadOutputsFromDir(P, topics.dir, topics.runStartedAtMs);

  assert.equal(count, 1, "topics wrote one file and must publish exactly one");
  assert.equal(
    await readFile(key, "utf-8"),
    "NORMALIZED",
    "the normalized reference must survive a sibling finishing after it",
  );
});

test("omitting the bound uploads everything — the old, unsafe behaviour", async () => {
  // Pinned deliberately: uploadDirToStorage is also used for one-shot sweeps of a
  // directory nobody else is writing, where publishing everything is correct. This
  // documents that the guard is opt-in, so a pipeline caller that forgets it is a bug
  // in the CALLER, and makes the contrast with the two tests above explicit.
  const { uploadOutputsFromDir } = await load();
  const P = "55555555-5555-4555-8555-555555555555";
  const { dir } = await hydrateWorkspace(HYDRATED);

  const count = await uploadOutputsFromDir(P, dir);
  assert.equal(count, Object.keys(HYDRATED).length);
});

test("the periodic sync's first tick does not republish hydrated files", async () => {
  // `knownFiles` starts empty, so without the bound the first tick treats every
  // hydrated file as changed and republishes the whole workspace mid-run — the same
  // clobber as above, but arriving within 30s instead of at exit.
  const { startPeriodicSync } = await load();
  const P = "66666666-6666-4666-8666-666666666666";
  const { dir, runStartedAtMs } = await hydrateWorkspace(HYDRATED);

  await new Promise((r) => setTimeout(r, 1_100));
  await writeFile(path.join(dir, "generated_titles.txt"), "FRESH TITLE");

  // A long interval so only the final sync inside stop() runs.
  const sync = startPeriodicSync(P, dir, 3_600_000, runStartedAtMs);
  await sync.stop();

  assert.equal(
    await readFile(path.join(ROOT, `${P}/outputs/generated_titles.txt`), "utf-8"),
    "FRESH TITLE",
  );
  await assert.rejects(
    () => readFile(path.join(ROOT, `${P}/outputs/generatedFullCode/PYTHON.py`), "utf-8"),
    "an untouched hydrated file must not be republished by the first tick",
  );
});
