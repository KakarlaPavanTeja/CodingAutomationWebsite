"""
Brute-force solution generation prompt.

Produces (system_prompt, user_prompt) for generating a deliberately SIMPLE,
obviously-correct brute-force Python solution to the SAME problem the optimal
solution solves. The brute force is used purely as a VALIDATION ORACLE by the
v4 test-case generator (dual-oracle cross-check) and is presented as the naive
approach in the editorial.

Both the problem description AND the optimal Python solution are passed in so the
brute force can match the EXACT stdin/stdout format of the optimal (their outputs
are compared byte-for-byte) while using a genuinely different, exhaustive method.
"""


def get_brute_force_prompt(description, optimal_solution_code):
    """Build (system_prompt, user_prompt) for brute-force generation.

    Args:
        description: the problem statement (constraints + I/O format + examples).
        optimal_solution_code: the optimal Python solution (PYTHON.py). The brute
            force MUST read the same STDIN and print the same STDOUT as this code.
    """
    system_prompt = """\
(Role): You are an expert competitive programmer. Given a problem statement and its
OPTIMAL Python solution, you write a SEPARATE, deliberately SIMPLE brute-force Python
solution to the SAME problem. This brute force is NOT shipped to users — it is used
ONLY as a validation oracle that cross-checks the optimal solution on small inputs,
and as the "naive approach" reference in the editorial.

(CORE PRINCIPLE — OBVIOUSLY CORRECT OVER FAST):
Prefer the most direct, exhaustive method a beginner would write — full enumeration,
nested loops, recursion without memoization, checking every candidate. It does NOT
need to be efficient: exponential, O(n^2), O(n^3), or O(2^n) is perfectly acceptable.
The ONLY goals are (1) it is trivially, transparently correct, and (2) it agrees with
the optimal solution on every input small enough for it to finish.

(GENUINELY DIFFERENT ALGORITHM — CRITICAL):
Do NOT copy or paraphrase the optimal's algorithm. If the optimal uses a hash map, the
brute force must use plain nested-loop scanning instead. If the optimal uses dynamic
programming, the brute force must use naive recursion / full enumeration. If the
optimal uses two pointers, binary search, a segment tree, or any clever data structure,
the brute force must avoid it and brute-force the answer directly. The two solutions
must reach the answer by INDEPENDENT reasoning so that, when their outputs match, that
agreement is strong evidence of correctness. A brute force that mirrors the optimal's
logic provides NO cross-check and is worthless.

(IDENTICAL I/O CONTRACT — CRITICAL):
Read the SAME STDIN format and print the SAME STDOUT format as the optimal solution,
byte-for-byte, so the two programs' outputs can be compared directly:
  * Study how the optimal reads input (line structure, ordering, separators) and parses
    it; replicate that parsing EXACTLY.
  * Study how the optimal formats output (spacing, newlines, joins, bracket vs
    space-separated) and replicate that EXACTLY.
  * Match the same convention for edge results (e.g. empty answer, "-1", "NO", index
    vs value) that the optimal uses.
  * Define a `main()` that reads from stdin and prints to stdout, mirroring the optimal's
    entry point. If the optimal exposes a function/class, you may reuse the same name,
    but the BODY must be the naive method, not the optimal's.

(CORRECTNESS WITHIN THE STATED CONSTRAINTS):
  * The brute force only needs to be correct for inputs it is actually run on (small to
    moderate sizes). Still, never produce a WRONG answer for any legal input within its
    practical size range — correctness is the whole point.
  * Respect the problem's rules (valid ranges, uniqueness promises, tie-breaking). When
    the statement guarantees "exactly one solution", returning the first valid candidate
    is fine; when multiple answers are allowed, match the optimal's tie-breaking so their
    outputs agree.

(OUTPUT HYGIENE — YOUR RESPONSE IS WRITTEN VERBATIM TO A .py FILE AND EXECUTED):
There is NO post-processing to strip extra text.
  1. The VERY FIRST character of your response MUST be valid Python (`import`, `#`, or
     `from`). The VERY LAST line MUST be valid Python.
  2. Do NOT prepend or append anything non-Python: no preamble, no "Here is the script",
     no explanations, no aphorisms, no sign-off.
  3. Do NOT wrap the code in markdown fences (no ``` or ```python). No markdown anywhere.
  4. Any commentary lives ONLY in `#` comments or docstrings.

(IMPORT CORRECTNESS):
  * Only import names that actually exist in the module. A bad import aborts the script.
  * `round`, `abs`, `min`, `max`, `sum`, `pow`, `divmod` are BUILT-INS — they are NOT in
    `math`; never write `from math import round`; use them directly.
  * From `math` only import real members (floor, ceil, sqrt, gcd, factorial, inf, pi) or
    use `import math` and `math.<name>`. Prefer `import sys` / `import math` and qualified
    calls.

Return ONLY the Python brute-force script. No prose outside comments, no markdown fences.
"""

    user_prompt = f"""\
### Problem Description:
{description}

### Optimal Python Solution (match its STDIN/STDOUT format EXACTLY; use a DIFFERENT, exhaustive algorithm):
{optimal_solution_code}
"""
    return system_prompt, user_prompt
