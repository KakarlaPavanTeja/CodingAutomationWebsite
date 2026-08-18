import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getQuestionSubStepWaves, getQuestionSubStepsForType } from "./pipeline-question";
import type { QuestionSubStepId } from "@/types/pipeline";

const ALL_FUNCTION = getQuestionSubStepsForType("function") as string[];
const ALL_NONFUNCTION = getQuestionSubStepsForType("nonfunction") as string[];

const waves = (type: "function" | "nonfunction", enabled: string[] = []) =>
  getQuestionSubStepWaves(
    type,
    enabled.length ? enabled : type === "function" ? ALL_FUNCTION : ALL_NONFUNCTION,
  );

// ---------------------------------------------------------------------------
// Wave layout.
//
// Every sub-step runs as a SEPARATE request with its own temp workspace, hydrated with
// a full copy of the problem's Outputs. `naming` is the only sub-step that rewrites
// generatedFullCode/PYTHON.py, so any sibling running beside it holds the pre-naming
// copy and republishes it — reverting the normalization. The signature JSON survives
// (no sibling has that file), leaving a signature naming `findPairs` beside code with
// the old name, and the stdin/checker gates having passed on code then discarded.
//
// The selective upload in storage-sync is the other half of that fix; this pins the
// half that keeps naming from having concurrent siblings at all.
// ---------------------------------------------------------------------------

test("naming runs alone in its wave, never beside a sibling", () => {
  const w = waves("function");
  const namingWave = w.find((ids) => ids.includes("naming" as QuestionSubStepId));
  assert.ok(namingWave, "naming must appear in some wave");
  assert.deepEqual(
    namingWave,
    ["naming"],
    "a sibling in naming's wave republishes the pre-naming PYTHON.py and reverts it",
  );
});

test("the function waves run description, then naming, then metadata, then translations", () => {
  assert.deepEqual(waves("function"), [
    ["description"],
    ["naming"],
    ["titles", "difficulty", "topics"],
    ["translate_cpp", "translate_java", "translate_nodejs"],
  ]);
});

test("naming stays alone when only some metadata sub-steps are enabled", () => {
  // The wave list is built by filtering, so a partial selection must not merge waves.
  const w = waves("function", ["description", "naming", "translate_cpp"]);
  assert.deepEqual(w, [["description"], ["naming"], ["translate_cpp"]]);
});

test("naming alone in a wave still holds when it is the only enabled sub-step", () => {
  assert.deepEqual(waves("function", ["naming"]), [["naming"]]);
});

test("non-function problems have no naming wave at all", () => {
  const w = waves("nonfunction");
  assert.ok(
    !w.some((ids) => (ids as string[]).includes("naming")),
    "naming is function-only; a nonfunction run must not schedule it",
  );
  assert.deepEqual(w, [
    ["description"],
    ["titles", "difficulty", "topics"],
    ["translate_cpp", "translate_java", "translate_nodejs"],
  ]);
});

test("description is always the first wave and always alone", () => {
  for (const type of ["function", "nonfunction"] as const) {
    assert.deepEqual(waves(type)[0], ["description"], `${type}: description runs first`);
  }
});

test("every applicable sub-step appears exactly once across the waves", () => {
  for (const type of ["function", "nonfunction"] as const) {
    const flat = waves(type).flat();
    assert.equal(new Set(flat).size, flat.length, `${type}: a sub-step is scheduled twice`);
    const expected = type === "function" ? ALL_FUNCTION : ALL_NONFUNCTION;
    assert.deepEqual([...flat].sort(), [...expected].sort(), `${type}: coverage mismatch`);
  }
});

// ---------------------------------------------------------------------------
// Route wiring.
//
// A source-level check, because the route is an HTTP handler that spawns Python and
// writes to Postgres — there is no unit seam. The predicate itself is covered against
// the real functions in storage-sync.test.ts; what is unguarded without this is the
// WIRING. Drop the third argument at either call site and the race returns silently
// while every other test still passes, which is precisely how the bug shipped.
// ---------------------------------------------------------------------------

const ROUTE = path.join(process.cwd(), "src/app/api/pipeline/run/route.ts");

test("the pipeline route bounds both uploads to files the step actually wrote", async () => {
  const src = await readFile(ROUTE, "utf-8");

  assert.match(
    src,
    /const runStartedAtMs = Date\.now\(\)/,
    "the bound must be captured before spawn",
  );
  // Anchored on the CALL, not the bare word: "spawn()" also appears in a comment far
  // earlier in the file, which made a naive indexOf compare against the wrong position.
  const spawnCall = src.indexOf("= spawn(");
  assert.ok(spawnCall > 0, "expected a spawn() call in the route");
  assert.ok(
    src.indexOf("const runStartedAtMs") < spawnCall,
    "capturing the bound AFTER spawn would miss files the step writes early",
  );
  assert.match(
    src,
    /startPeriodicSync\(\s*safeProblemId,\s*outputsDir,\s*outputSyncMs,\s*runStartedAtMs,?\s*\)/,
    "the periodic sync must be bounded — its first tick republishes the whole workspace",
  );
  assert.match(
    src,
    /uploadOutputsFromDir\(safeProblemId,\s*outputsDir,\s*runStartedAtMs\)/,
    "the exit upload must be bounded, or the step republishes its hydrated copy",
  );
});
