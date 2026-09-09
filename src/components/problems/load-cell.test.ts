import test from "node:test";
import assert from "node:assert/strict";
import { deriveLoadCell, type LoadSummary } from "./load-cell";

const TRACKING_START = "2026-08-01T00:00:00Z";
const load = (over: Partial<LoadSummary> = {}): LoadSummary => ({
  id: "L", status: "completed", questionIds: ["q1"], queuedAt: "2026-09-01T00:00:00Z", ...over,
});
const cell = (loads: LoadSummary[], createdAt = "2026-09-01T00:00:00Z") =>
  deriveLoadCell({ loads, problemCreatedAt: createdAt, trackingStartedAt: TRACKING_START });

test("a running load outranks any history", () => {
  const c = cell([load({ id: "old" }), load({ id: "now", status: "running" })]);
  assert.equal(c.kind, "running");
  assert.equal(c.label, "Loading…");
  assert.equal(c.load?.id, "now");
});

test("a queued load reports how many are ahead of it", () => {
  assert.equal(cell([load({ status: "queued", queuePosition: 3 })]).label, "Queued · 2 ahead");
  assert.equal(cell([load({ status: "queued", queuePosition: 1 })]).label, "Queued · next");
  // No position from the server is not a reason to say "2 ahead".
  assert.equal(cell([load({ status: "queued" })]).label, "Queued · next");
});

test("Loaded uses the NEWEST completed load, not the newest attempt", () => {
  // "Load anyway" regenerates ids, so an older completed load links to a
  // superseded copy in beta. Picking the wrong one hands out dead links.
  const c = cell([
    load({ id: "old", questionIds: ["stale"], queuedAt: "2026-09-01T00:00:00Z" }),
    load({ id: "new", questionIds: ["live"], queuedAt: "2026-09-05T00:00:00Z" }),
    load({ id: "later-fail", status: "failed", queuedAt: "2026-09-06T00:00:00Z" }),
  ]);
  assert.equal(c.kind, "loaded");
  assert.deepEqual(c.load?.questionIds, ["live"]);
});

test("a failed attempt shows only when nothing ever completed", () => {
  assert.equal(cell([load({ status: "failed" })]).kind, "failed");
  assert.equal(cell([load({ status: "failed" }), load({ status: "completed" })]).kind, "loaded");
});

test("a problem older than tracking, with no record, is reported as untracked", () => {
  const c = cell([], "2026-07-01T00:00:00Z");
  assert.equal(c.kind, "untracked");
  assert.equal(c.label, "Loaded earlier · not tracked");
  assert.equal(c.expandable, false);
});

test("a problem newer than tracking, with no record, was simply never loaded", () => {
  assert.equal(cell([], "2026-09-01T00:00:00Z").kind, "none");
});

test("with nothing ever tracked, no problem is called untracked", () => {
  // trackingStartedAt null means the loads table is empty; claiming every
  // problem was "loaded earlier" would be a guess with no evidence at all.
  const c = deriveLoadCell({
    loads: [], problemCreatedAt: "2020-01-01T00:00:00Z", trackingStartedAt: null,
  });
  assert.equal(c.kind, "none");
});

test("a cancelled-only history is not a statement about beta", () => {
  // Cancelling says nothing about whether the question is in beta, so the
  // untracked/never-loaded decision still applies.
  assert.equal(cell([load({ status: "cancelled" })], "2026-07-01T00:00:00Z").kind, "untracked");
  assert.equal(cell([load({ status: "cancelled" })], "2026-09-01T00:00:00Z").kind, "none");
});
