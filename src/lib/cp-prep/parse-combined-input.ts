const PROBLEM_MARKER = /^===\s*PROBLEM\s*===$/im;
const SOLUTION_MARKER = /^===\s*SOLUTION\s*===$/im;

export interface ParsedCombinedInput {
  problemStatement: string;
  referenceSolution?: string;
}

/**
 * Parse a combined input file with delimiters:
 *   === PROBLEM ===
 *   (statement)
 *   === SOLUTION ===
 *   (optional reference code)
 */
export function parseCombinedInput(raw: string): ParsedCombinedInput {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return { problemStatement: "" };
  }

  const lines = trimmed.split("\n");
  let problemStart = -1;
  let solutionStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (PROBLEM_MARKER.test(line) && problemStart === -1) {
      problemStart = i + 1;
    } else if (SOLUTION_MARKER.test(line)) {
      solutionStart = i + 1;
      break;
    }
  }

  if (problemStart === -1) {
    // No markers — treat entire file as problem statement.
    return { problemStatement: trimmed };
  }

  const problemEnd = solutionStart !== -1 ? solutionStart - 2 : lines.length - 1;
  const problemStatement = lines
    .slice(problemStart, problemEnd + 1)
    .join("\n")
    .trim();

  let referenceSolution: string | undefined;
  if (solutionStart !== -1) {
    const sol = lines.slice(solutionStart).join("\n").trim();
    if (sol) referenceSolution = sol;
  }

  return { problemStatement, referenceSolution };
}
