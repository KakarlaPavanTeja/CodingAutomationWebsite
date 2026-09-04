/**
 * Serialise work per question set.
 *
 * Two loads that target the same set must not interleave their
 * read-order -> build-zip -> run-task sequence: both would read the same
 * `maxOrder` and the second would collide on (question_set_id, order), which
 * the NKB backend rejects with FAILURE and no message. Different sets are
 * independent and still run concurrently.
 *
 * ponytail: in-process only — it does not serialise across multiple Node
 * instances. Upgrade to a Postgres advisory lock keyed on the set id if this
 * app is ever run with more than one server process.
 */
const chains = new Map<string, Promise<unknown>>();

export function withSetLock<T>(questionSetId: string, fn: () => Promise<T>): Promise<T> {
  const key = String(questionSetId || "").trim() || "__unkeyed__";
  const prior = chains.get(key) ?? Promise.resolve();
  // Swallow the predecessor's rejection so one failed load cannot poison the
  // chain for every later load of the same set.
  const run = prior.then(fn, fn);
  // Keep the chain alive but never let it reject unhandled.
  chains.set(key, run.then(() => undefined, () => undefined));
  return run;
}
