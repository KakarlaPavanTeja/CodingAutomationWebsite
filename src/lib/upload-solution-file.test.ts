import { test } from "node:test";
import assert from "node:assert/strict";
import {
  problemFileExtError,
  resolveSolutionFileName,
} from "./upload-solution-file";

test("a Python reference solution is stored as solution.py", () => {
  const r = resolveSolutionFileName("solution.py");
  assert.deepEqual(r, { ok: true, name: "solution.py" });
});

test("an odd source filename still lands on the canonical name", () => {
  const r = resolveSolutionFileName("my final attempt (3).py");
  assert.deepEqual(r, { ok: true, name: "solution.py" });
});

test("the stored extension is lowercased so the pipeline's *.py glob finds it", () => {
  // Regression: `Solution.PY` used to be stored verbatim as `solution.PY`.
  // detect_user_solution() globs Inputs/*.py — case-sensitive on Linux — so the
  // file was invisible and the run died with "No solution file found in Inputs/".
  for (const name of ["Solution.PY", "solution.Py", "SOLUTION.pY"]) {
    assert.deepEqual(
      resolveSolutionFileName(name),
      { ok: true, name: "solution.py" },
      `expected ${name} to be stored as solution.py`,
    );
  }
});

test("an extensionless upload is treated as Python", () => {
  assert.deepEqual(resolveSolutionFileName("solution"), {
    ok: true,
    name: "solution.py",
  });
});

test("a non-Python reference solution is rejected, whatever its casing", () => {
  // The pipeline exits 1 on these (generate_full_question.py detect_user_solution),
  // so accepting them here only produced a problem that could never run step 1.
  for (const name of ["solution.cpp", "Solution.CPP", "sol.java", "a.JS", "x.txt"]) {
    const r = resolveSolutionFileName(name);
    assert.equal(r.ok, false, `expected ${name} to be rejected`);
    assert.match(
      (r as { ok: false; error: string }).error,
      /must be Python/,
      "the error should say why, not just that it is invalid",
    );
  }
});

test("the rejection names the extension it saw and points at the AI path", () => {
  const r = resolveSolutionFileName("solution.cpp");
  assert.equal(r.ok, false);
  const { error } = r as { ok: false; error: string };
  assert.match(error, /\.cpp/);
  assert.match(error, /prepare it with AI/i);
});

test("a .md problem statement is accepted, in any casing", () => {
  assert.equal(problemFileExtError("problem.md"), null);
  assert.equal(problemFileExtError("Problem.MD"), null);
});

test("an extensionless problem statement is accepted", () => {
  assert.equal(problemFileExtError("problem"), null);
});

test("a non-markdown problem statement is rejected", () => {
  const err = problemFileExtError("problem.docx");
  assert.match(String(err), /\.docx/);
  assert.match(String(err), /Only \.md/);
});
