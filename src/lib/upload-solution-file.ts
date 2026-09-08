/**
 * File-type policy for the two files `POST /api/files/upload` accepts.
 *
 * Lives here rather than inline in the route so it can be tested directly — a
 * route module can only export request handlers.
 */
import path from "path";

export const ALLOWED_PROBLEM_EXTS = new Set([".md"]);

/**
 * Reference solutions are PYTHON ONLY, because the pipeline is.
 *
 * `detect_user_solution()` (pipeline/Scripts/generate_full_question.py) calls
 * `sys.exit(1)` on a .cpp/.java/.js reference solution: there is no
 * `translate_python` sub-step, so `Outputs/generatedFullCode/PYTHON.py` would never
 * be written, and both generate_brute_force and testcase_manager_v4 stop on its
 * absence. Accepting one here produced a problem whose very first step could only
 * ever fail — and since every later step depends on generate_question, the whole
 * problem was a dead end.
 *
 * Non-Python source is still supported, just not by this path: the LLM "prepare"
 * mode ports it to Python and submits the result as solution.py.
 */
export const ALLOWED_SOLUTION_EXTS = new Set([".py"]);

export type SolutionFileName =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * The name an uploaded reference solution is stored under in `Inputs/`.
 *
 * The extension is lowercased. The pipeline finds the file by globbing
 * `Inputs/*.py`, which is case-sensitive on Linux, so a `Solution.PY` stored
 * verbatim was invisible to it and surfaced as "No solution file found in Inputs/"
 * — a confusing failure two clicks away from the upload that caused it.
 */
export function resolveSolutionFileName(uploadedName: string): SolutionFileName {
  const ext = path.extname(uploadedName).toLowerCase();

  // No extension at all keeps the historical default: treat the upload as Python.
  if (!ext) return { ok: true, name: "solution.py" };

  if (!ALLOWED_SOLUTION_EXTS.has(ext)) {
    return {
      ok: false,
      error:
        `Invalid solution file type: ${ext}. The reference solution must be Python (.py) — ` +
        `the pipeline translates Python into C++/Java/Node.js and cannot start from them. ` +
        `To use a C++/Java/JavaScript solution, prepare it with AI instead of uploading it as-is.`,
    };
  }

  return { ok: true, name: `solution${ext}` };
}

/**
 * Whether an uploaded problem statement's extension is acceptable.
 * An extensionless upload is allowed, matching the long-standing behaviour.
 */
export function problemFileExtError(uploadedName: string): string | null {
  const ext = path.extname(uploadedName).toLowerCase();
  if (ext && !ALLOWED_PROBLEM_EXTS.has(ext)) {
    return `Invalid problem file type: ${ext}. Only .md files are allowed.`;
  }
  return null;
}
