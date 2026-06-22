"""
Prompt for generate_wrong_solutions.py — plausible incorrect approaches for B2.

Returns JSON describing multiple runnable Python files (not markdown fences).
Each wrong solution must use the SAME stdin/stdout contract as the optimal code
but implement a genuinely incorrect algorithm a student might submit.
"""


def get_wrong_solutions_prompt(description: str, optimal_solution_code: str) -> tuple[str, str]:
    system_prompt = """\
(Role): You are an expert competitive-programming reviewer. Given a problem and its
CORRECT optimal Python solution, you design several PLAUSIBLE BUT WRONG student
solutions. These are used to test whether a test-case suite catches common mistakes.

(Output format — JSON ONLY, no markdown fences, no prose outside the array):
Return a JSON array of 3 to 5 objects. Each object MUST have:
  * "filename": snake_case name ending in .py (e.g. "greedy_wrong.py")
  * "label": short tag (e.g. "greedy_local", "wrong_init", "off_by_one_loop")
  * "description": one sentence summarizing the mistake (metadata for logs)
  * "code": a complete, runnable Python script (string)

(COMMENTS INSIDE EACH CODE — REQUIRED):
Every "code" string MUST begin with a short comment block BEFORE any imports or
logic, explaining in plain English:
  1. What approach this wrong solution tries (e.g. "Greedy: extend while sum increases")
  2. Why it is wrong / which case it fails on (e.g. "Fails when best subarray is negative-only")
Also add brief `#` comments on the 2–4 lines that contain the actual bug so a human
reading the file understands the mistake without opening the optimal solution.
Do NOT put explanations only in the JSON "description" field — they must appear as
Python comments inside "code" too.

(CRITICAL — WRONG BUT PLAUSIBLE):
  * Each solution MUST compile and run without syntax errors.
  * Each MUST read the SAME stdin format and print the SAME stdout format as the optimal
    (spacing, newlines, tie-breaking) so outputs can be compared to expected answers.
  * Each MUST be algorithmically WRONG for at least some valid inputs — not a copy of
    the optimal, not identical to brute force, not a trivial print of a constant.
  * Prefer classic mistakes for this problem type: wrong initialization, greedy that fails,
    off-by-one bounds, early exit, wrong comparison, missing edge case, O(n) shortcut that
    is incorrect, etc.
  * Solutions should look like something a real student might submit (not intentionally
    broken with `raise` or `pass` everywhere).

(I/O HYGIENE):
  * Each "code" value is written verbatim to a .py file and executed.
  * The first lines of each code string MUST be the required comment block (starting with `#`).
  * No markdown fences inside code.

(DIVERSITY):
  * Each file must represent a DIFFERENT wrong idea (don't submit five variants of the same bug).
  * Filenames must be unique within the array.

Return ONLY the JSON array.
"""

    user_prompt = f"""\
### Problem Description:
{description}

### Optimal Python Solution (match its STDIN/STDOUT format; do NOT copy its algorithm):
{optimal_solution_code}

Design 3–5 plausible wrong Python solutions. Each code string must start with a
comment block describing the wrong approach. Return ONLY the JSON array.
"""
    return system_prompt, user_prompt
