import test from "node:test";
import assert from "node:assert/strict";
import { withSetLock } from "./set-lock";

test("serialises two calls for the same set", async () => {
  const events: string[] = [];
  const slow = async (tag: string) => {
    events.push(`${tag}:start`);
    await new Promise((r) => setTimeout(r, 20));
    events.push(`${tag}:end`);
  };
  await Promise.all([withSetLock("s1", () => slow("a")), withSetLock("s1", () => slow("b"))]);
  // Whichever runs first must FINISH before the other starts.
  assert.ok(
    events.join(",") === "a:start,a:end,b:start,b:end" ||
      events.join(",") === "b:start,b:end,a:start,a:end",
    `interleaved: ${events.join(",")}`,
  );
});

test("allows different sets to run concurrently", async () => {
  const events: string[] = [];
  const slow = async (tag: string) => {
    events.push(`${tag}:start`);
    await new Promise((r) => setTimeout(r, 20));
    events.push(`${tag}:end`);
  };
  await Promise.all([withSetLock("s1", () => slow("a")), withSetLock("s2", () => slow("b"))]);
  assert.equal(events[0].endsWith(":start"), true);
  assert.equal(events[1].endsWith(":start"), true, "different sets must overlap");
});

test("a throwing body releases the lock", async () => {
  await assert.rejects(() => withSetLock("s1", async () => { throw new Error("boom"); }), /boom/);
  const ran = await withSetLock("s1", async () => "ok");
  assert.equal(ran, "ok", "lock must not be held after a failure");
});

test("returns the body's value", async () => {
  assert.equal(await withSetLock("s1", async () => 42), 42);
});
