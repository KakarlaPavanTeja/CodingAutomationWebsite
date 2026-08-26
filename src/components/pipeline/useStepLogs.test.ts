import assert from "node:assert/strict";
import test from "node:test";
import { scheduleLogPolls } from "./useStepLogs";

const visible = () => false;

test("a terminal step fetches its log once and never polls again", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;

  const stop = scheduleLogPolls(false, () => fetches++, visible);
  assert.equal(fetches, 1);

  t.mock.timers.tick(60_000);
  assert.equal(fetches, 1, "a finished step's log never changes — stop polling");
  stop();
});

test("a running step keeps polling every 6s", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;

  const stop = scheduleLogPolls(true, () => fetches++, visible);
  assert.equal(fetches, 1);

  t.mock.timers.tick(18_000);
  assert.equal(fetches, 4);
  stop();
});

test("running -> completed does exactly one final fetch, then stops", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;
  const bump = () => fetches++;

  const stopRunning = scheduleLogPolls(true, bump, visible);
  t.mock.timers.tick(6_000);
  assert.equal(fetches, 2);
  stopRunning();

  // The step finished: the effect re-runs with isRunning === false.
  const stopDone = scheduleLogPolls(false, bump, visible);
  assert.equal(fetches, 3, "the completed step must refetch the full final log");

  t.mock.timers.tick(120_000);
  assert.equal(fetches, 3, "...and then go quiet");
  stopDone();
});

test("a terminal step hidden at transition still lands its one fetch on return", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;
  let hidden = true;

  const stop = scheduleLogPolls(false, () => fetches++, () => hidden);
  assert.equal(fetches, 0);

  t.mock.timers.tick(24_000);
  assert.equal(fetches, 0, "hidden tab: no requests");

  hidden = false;
  t.mock.timers.tick(12_000);
  assert.equal(fetches, 1);

  t.mock.timers.tick(120_000);
  assert.equal(fetches, 1, "one fetch is all a finished step ever needs");
  stop();
});

test("re-running a finished step resumes polling", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;
  const bump = () => fetches++;

  // Step finished earlier: one fetch, then silent.
  const stopDone = scheduleLogPolls(false, bump, visible);
  t.mock.timers.tick(60_000);
  assert.equal(fetches, 1);
  stopDone();

  // User hits Run again. isRunning flips back to true and the run id changes,
  // so the effect re-subscribes and the 6s cadence must come back.
  const stopRerun = scheduleLogPolls(true, bump, visible);
  assert.equal(fetches, 2, "a re-run must fetch immediately");
  t.mock.timers.tick(18_000);
  assert.equal(fetches, 5, "a re-run must poll again, not stay stopped");
  stopRerun();
});
