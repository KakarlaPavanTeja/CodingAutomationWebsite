import type { QuestionType } from "@/types/pipeline";

/** Mirrors `editorial_manager.py` — what must exist on disk before generation. */
export type EditorialPrereqIssue = {
  id: string;
  label: string;
  /** Which pipeline step (or tab action) produces this artifact. */
  hint: string;
};

export type EditorialPrereqCheck = {
  ready: boolean;
  missingRequired: EditorialPrereqIssue[];
  warnings: EditorialPrereqIssue[];
};

const SOLUTION_FILES = [
  "generatedFullCode/PYTHON.py",
  "generatedFullCode/CPP.cpp",
  "generatedFullCode/JAVA.java",
  "generatedFullCode/NodeJS.js",
] as const;

const DRIVER_FILES = [
  "CodeContentFiles/Python/driver.py",
  "CodeContentFiles/Cpp/driver.cpp",
  "CodeContentFiles/Java/driver.java",
  "CodeContentFiles/NodeJS/driver.js",
] as const;

function hasAny(paths: Iterable<string>, candidates: readonly string[]): boolean {
  const set = paths instanceof Set ? paths : new Set(paths);
  return candidates.some((p) => set.has(p));
}

/**
 * Check whether the problem has the outputs editorial_manager.py reads.
 * Uses output file paths (from `/api/files/outputs`) and whether `problem.md`
 * exists in inputs — same fallbacks as the Python script.
 */
export function evaluateEditorialPrerequisites(
  outputPaths: Iterable<string>,
  hasInputProblemMd: boolean,
  questionType: QuestionType,
  ownerTitle?: string
): EditorialPrereqCheck {
  const outputs = outputPaths instanceof Set ? outputPaths : new Set(outputPaths);
  const missingRequired: EditorialPrereqIssue[] = [];
  const warnings: EditorialPrereqIssue[] = [];

  const hasStatement =
    outputs.has("generated_description.md") || hasInputProblemMd;
  if (!hasStatement) {
    missingRequired.push({
      id: "statement",
      label: "Problem statement (`generated_description.md` or `Inputs/problem.md`)",
      hint: "Run Generate Question → Description (or upload `problem.md` in Inputs).",
    });
  }

  const hasSolution = hasAny(outputs, SOLUTION_FILES);
  if (!hasSolution) {
    missingRequired.push({
      id: "solutions",
      label: "At least one full solution in `Outputs/generatedFullCode/`",
      hint: "Run Generate Question (Python / C++ / Java / Node.js translation sub-steps).",
    });
  }

  if (questionType === "function" && !hasAny(outputs, DRIVER_FILES)) {
    warnings.push({
      id: "drivers",
      label: "Driver code in `Outputs/CodeContentFiles/` (function signature reference)",
      hint: "Run Split Code so the editorial uses the real function name and signature.",
    });
  }

  if (!hasAny(outputs, ["generatedFullCode/BRUTE_FORCE.py", "generatedFullCode/BRUTE.py"])) {
    warnings.push({
      id: "brute_force",
      label: "Brute-force reference (`generatedFullCode/BRUTE_FORCE.py`)",
      hint: "Optional but recommended — run Generate Brute Force so the naive approach matches your oracle.",
    });
  }

  if (!ownerTitle?.trim() && !outputs.has("generated_titles.txt")) {
    warnings.push({
      id: "title",
      label: "Short problem title (owner title or `generated_titles.txt`)",
      hint: "Set a title in Pipeline settings or run Generate Question → Titles; otherwise the editorial keeps the model-chosen H1.",
    });
  }

  return {
    ready: missingRequired.length === 0,
    missingRequired,
    warnings,
  };
}
