import test from "node:test";
import assert from "node:assert/strict";

// load-queue.ts imports RUNNING_LOAD_STALE_MS from load-records.ts, which
// imports `@/lib/db` and throws at module load if DATABASE_URL is unset. tsx
// --test does not read .env.local, so set a dummy first. postgres-js connects
// lazily, so no socket is opened.
const load = async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  return import("./load-queue");
};

const at = (iso: string) => new Date(iso);
const NOW = at("2026-09-09T12:00:00Z");

type Row = { id: string; status: string; queuedAt: Date | null; startedAt: Date | null };

const queued = (id: string, iso: string): Row => ({
  id,
  status: "queued",
  queuedAt: at(iso),
  startedAt: null,
});

test("claimableFrom takes the oldest queued row when nothing is running", async () => {
  const { claimableFrom } = await load();
  const rows = [queued("b", "2026-09-09T11:05:00Z"), queued("a", "2026-09-09T11:00:00Z")];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("claimableFrom refuses while a load is genuinely running", async () => {
  const { claimableFrom } = await load();
  const rows: Row[] = [
    { id: "r", status: "running", queuedAt: at("2026-09-09T11:50:00Z"), startedAt: at("2026-09-09T11:55:00Z") },
    queued("a", "2026-09-09T11:00:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW), null);
});

test("claimableFrom ignores a running row stale past the 30 minute window", async () => {
  const { claimableFrom } = await load();
  // Started 11:00, checked at 12:00 — presumed dead, or nothing would ever run
  // again after a crash mid-load.
  const rows: Row[] = [
    { id: "dead", status: "running", queuedAt: at("2026-09-09T10:55:00Z"), startedAt: at("2026-09-09T11:00:00Z") },
    queued("a", "2026-09-09T11:10:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("claimableFrom treats a running row with no started_at as dead", async () => {
  const { claimableFrom } = await load();
  const rows: Row[] = [
    { id: "odd", status: "running", queuedAt: at("2026-09-09T11:00:00Z"), startedAt: null },
    queued("a", "2026-09-09T11:10:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("claimableFrom returns null when nothing is queued", async () => {
  const { claimableFrom } = await load();
  const rows: Row[] = [
    { id: "done", status: "completed", queuedAt: at("2026-09-09T11:00:00Z"), startedAt: at("2026-09-09T11:01:00Z") },
  ];
  assert.equal(claimableFrom(rows, NOW), null);
});

test("claimableFrom skips cancelled and failed rows", async () => {
  const { claimableFrom } = await load();
  const rows: Row[] = [
    { id: "x", status: "cancelled", queuedAt: at("2026-09-09T10:00:00Z"), startedAt: null },
    { id: "y", status: "failed", queuedAt: at("2026-09-09T10:30:00Z"), startedAt: at("2026-09-09T10:31:00Z") },
    queued("a", "2026-09-09T11:00:00Z"),
  ];
  assert.equal(claimableFrom(rows, NOW)?.id, "a");
});

test("claimableFrom does not mutate the caller's array", async () => {
  const { claimableFrom } = await load();
  // It sorts to find the oldest; sorting the caller's array in place would
  // silently reorder whatever the caller reads next.
  const rows = [queued("b", "2026-09-09T11:05:00Z"), queued("a", "2026-09-09T11:00:00Z")];
  claimableFrom(rows, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
});

test("queuePositionOf counts from 1 in queued_at order", async () => {
  const { queuePositionOf } = await load();
  const rows = [
    queued("a", "2026-09-09T11:00:00Z"),
    queued("b", "2026-09-09T11:05:00Z"),
    queued("c", "2026-09-09T11:10:00Z"),
  ];
  assert.equal(queuePositionOf(rows, "a"), 1);
  assert.equal(queuePositionOf(rows, "c"), 3);
});

test("queuePositionOf ignores non-queued rows when numbering", async () => {
  const { queuePositionOf } = await load();
  const rows: Row[] = [
    { id: "r", status: "running", queuedAt: at("2026-09-09T10:00:00Z"), startedAt: at("2026-09-09T11:59:00Z") },
    queued("a", "2026-09-09T11:00:00Z"),
  ];
  assert.equal(queuePositionOf(rows, "a"), 1);
});

test("queuePositionOf returns null for a row that is not waiting", async () => {
  const { queuePositionOf } = await load();
  assert.equal(queuePositionOf([queued("a", "2026-09-09T11:00:00Z")], "nope"), null);
});

test("isLiveLoad covers queued and running only", async () => {
  const { isLiveLoad } = await load();
  assert.equal(isLiveLoad("queued"), true);
  assert.equal(isLiveLoad("running"), true);
  assert.equal(isLiveLoad("completed"), false);
  assert.equal(isLiveLoad("failed"), false);
  assert.equal(isLiveLoad("cancelled"), false);
});
