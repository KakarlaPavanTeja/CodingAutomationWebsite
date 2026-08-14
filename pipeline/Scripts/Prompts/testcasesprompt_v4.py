"""
v4 test-case generation prompt — LeetCode-grade coverage.

Key changes from v3:
  * DUAL ORACLE. The generated script embeds BOTH the optimal solution and a
    brute-force solution. Optimal produces the expected `output` (ground truth);
    brute force CROSS-CHECKS every generated case. If they disagree on any case,
    the script aborts loudly — a buggy "optimal" can no longer silently poison
    the suite. (Brute force is the oracle, not the answer source — the
    LeetCode-correct division of labor.)
  * ADVERSARIAL ENGINE (carried from v3 and strengthened): scenarios crafted to
    break specific wrong approaches (early-exit, greedy-instead-of-DP, etc.).
  * UNIQUE-SOLUTION VERIFICATION (lifted from v1): for "exactly one solution"
    problems, inject the target and scan the search space to prove uniqueness.

Public API mirrors v3 so the manager can import the same names.
"""

MIN_SUBTASKS = 3
MAX_SUBTASKS = 12
MAX_CASES_PER_SUBTASK = 12
MIN_TESTCASES = 25                          # raised from 20 — LeetCode Easy floor

# CASE_CAP is re-exported for testcase_manager_v4's log line; the FRACs are used only by
# get_size_fix_prompt. The size-bucket targets below are still consumed by testcase_helpers
# and the B3 gate in benchmark_suite, but they are no longer stated in the generation prompt.
from testcase_selection import (  # noqa: E402,F401
    CASE_CAP,
    LARGE_FRAC,
    SMALL_FRAC,
)

# Size-category distribution targets (count %, enforced by B3 in benchmark_suite).
# Philosophy (matches real judges like LeetCode): the suite is dominated by cheap
# small/edge CORRECTNESS cases; large/stress cases are FEW but high-value. You don't
# need 50-100 max-size cases — a handful of well-constructed worst cases gates TLE
# just as hard.
SIZE_CATEGORY_TARGETS = {
    "edge": 20.0,
    "small": 52.0,
    "medium": 8.0,
    "large": 20.0,
}
SIZE_TOLERANCE_PP = 7.0  # +/- percentage points
SIZE_TAG_PREFIX = "size_"
SIZE_BUCKETS = ("edge", "small", "medium", "large")


def size_tag(bucket: str) -> str:
    if bucket not in SIZE_BUCKETS:
        raise ValueError(f"size bucket must be one of {SIZE_BUCKETS}, got {bucket!r}")
    return f"{SIZE_TAG_PREFIX}{bucket}"


COUNT_BAND_BY_DIFFICULTY = {
    "easy": (80, 120),
    "medium": (120, 180),
    "hard": (180, 250),
}

SUBTASK_TAG_PREFIX = "subtask_"

STRESS_SCENARIO_TAGS = (
    "stress",
    "max_constraint",
    "worst_case_position",
    "early_exit_trap",
    "answer_at_end",
    "adversarial",
    "tle_trap",
)


def subtask_tag(tier_index: int) -> str:
    if not 1 <= tier_index <= MAX_SUBTASKS:
        raise ValueError(f"tier_index must be 1..{MAX_SUBTASKS}, got {tier_index}")
    return f"{SUBTASK_TAG_PREFIX}{tier_index}"


def tier_from_tags(tags: list) -> int:
    found = []
    for t in tags or []:
        if isinstance(t, str) and t.startswith(SUBTASK_TAG_PREFIX):
            suffix = t[len(SUBTASK_TAG_PREFIX):]
            if suffix.isdigit():
                found.append(int(suffix))
    if len(found) != 1:
        raise ValueError(
            f"tags must contain exactly one {SUBTASK_TAG_PREFIX}<n> tag, got {found}"
        )
    tier = found[0]
    if not 1 <= tier <= MAX_SUBTASKS:
        raise ValueError(f"invalid subtask tier in tags: {tier}")
    return tier




def verified_contract_pairs(io_contract) -> list[tuple[str, str]]:
    """[(stdin, stdout), ...] from a VERIFIED io_contract, else [].

    The contract is the one artifact that OWNS the I/O shape: its pairs came from running
    the reference solution on the description's own Examples. Quoting them beats any prose
    describing the format — it is the only source that has actually been executed."""
    if not isinstance(io_contract, dict) or not io_contract.get("verified"):
        return []
    return [
        (p["stdin"], p["stdout"])
        for p in io_contract.get("pairs") or []
        if isinstance(p, dict) and p.get("stdin") and p.get("stdout") is not None
    ]


def _frozen_io_block(io_contract) -> str:
    """The I/O FORMAT block when the contract is verified: quote the executed pair.

    Replaces the prose that told the model to infer the layout by studying the reference's
    stdin parser — the rule that sat mid-prompt and was the one being ignored (T primes
    shipped `[8]` / `["NO"]` and scored 0/150 in all three languages). A concrete pair to
    copy is both shorter and the instruction shape the model never violates."""
    pairs = verified_contract_pairs(io_contract)
    if not pairs:
        return ""
    lines = ["(I/O FORMAT — VERIFIED: these pairs were produced by RUNNING the reference "
             "solution on",
             "the description's own Examples. This IS the contract — copy the shape exactly):"]
    for i, (stdin, stdout) in enumerate(pairs, 1):
        lines.append(f"  * Case {i} `input` is EXACTLY: {stdin!r}")
        lines.append(f"  * Case {i} `output` is EXACTLY: {stdout!r}")
    lines.append("  * Produce EVERY case in this shape: same line layout, same token order, "
                 "same trailing newline.")
    lines.append("  * `output` is byte-for-byte what the reference solution PRINTS to stdout "
                 "for that `input` — never a described return value, never a Python literal "
                 "like `[3, 3]`, never `name = value` assignments.")
    return "\n".join(lines)


def _mandatory_example_block(description: str, io_contract=None) -> str:
    """Prompt block requiring order 1-2 cases to mirror description examples."""
    pairs = verified_contract_pairs(io_contract)
    if not pairs:
        try:
            from benchmark_suite import extract_example_io
            pairs = extract_example_io(description or "")
        except Exception:
            pairs = []
    if not pairs:
        return """
(MANDATORY PUBLIC EXAMPLES):
The first 2 test cases (`order` 1 and `order` 2) MUST reproduce Example 1 and Example 2 from the problem description exactly (same `input` and `output` fields). Tag both with scenario tag `example`. These are the public sample cases users see first.
"""
    source = ("VERIFIED against the reference solution"
              if verified_contract_pairs(io_contract) else "copied verbatim from the description")
    lines = [
        "(MANDATORY PUBLIC EXAMPLES):",
        f"The first 2 test cases (`order` 1 and `order` 2) MUST use EXACTLY these IO pairs, {source} (tag both `example`):",
    ]
    for i, (inp, out) in enumerate(pairs[:2], 1):
        lines.append(f"  Example {i} input:\n{inp!r}")
        lines.append(f"  Example {i} output:\n{out!r}")
    return "\n".join(lines) + "\n"


def _count_hint(difficulty, num_testcases):
    if num_testcases:
        return f"exactly {num_testcases} cases (the owner asked for this count)"
    lo, hi = COUNT_BAND_BY_DIFFICULTY.get(
        str(difficulty or "medium").strip().lower(), COUNT_BAND_BY_DIFFICULTY["medium"])
    return (f"{lo}-{hi} cases — pick within that band based on how large the problem's "
            f"legal input space actually is")


def get_testcases_prompt(
    description,
    optimal_solution,
    brute_force_code=None,
    num_testcases=None,
    difficulty=None,
    is_function=False,
    signature_params=None,
    io_contract=None,
):
    """
    Build (system_prompt, user_prompt) for v4 generation.

    brute_force_code : optional second solution used purely as a validation
        oracle. When provided, the generated script must cross-check every case
        (optimal vs brute) and abort on any mismatch. When None, the script
        falls back to self-consistency checks only and notes the weaker guarantee.

    is_function / signature_params : whether this is a function-based problem and,
        if so, the reference function's parameter names. Both function-based and
        non-function problems now use the RAW STDIN/STDOUT representation the reference
        solution actually parses (the reference solution's stdin reader is the source of
        truth); `signature_params` is passed only as context about what the solution
        reads. This keeps the generated `input`/`output` in lock-step with the solution
        and the description examples, and lets the generated suite be validated by
        piping each `input` to the reference solution.
    """
    if num_testcases is not None:
        num_testcases = max(num_testcases, MIN_TESTCASES)

    num_hint = _count_hint(difficulty, num_testcases)
    has_brute = bool(brute_force_code and brute_force_code.strip())

    # ---- shared blocks -----------------------------------------------------

    oracle_block = (
        f"""
(DUAL-ORACLE VALIDATION — CRITICAL):
You are given TWO solutions:
  * OPTIMAL_CODE — the reference. Its output is the GROUND TRUTH `output` for each case.
  * BRUTE_CODE — a slow but trustworthy oracle, used ONLY to cross-check the optimal.

The generated script MUST embed BOTH verbatim and run BOTH on every case whose size
is small enough for brute force to finish (guard brute by an input-size threshold —
e.g. only run brute when n <= BRUTE_MAX_N). For every such case:
    assert normalize(optimal_out) == normalize(brute_out), (
        f"ORACLE MISMATCH on case (input shown): optimal={{optimal_out!r}} brute={{brute_out!r}}"
    )
If they ever disagree, ABORT the whole script with a clear message naming the input.
This is the single most important guarantee in v4: a buggy 'optimal' must NOT silently
produce a wrong-but-accepted test suite. The expected `output` written to JSON is ALWAYS
the OPTIMAL's output (never brute's) — brute is the auditor, not the author.

Set BRUTE_MAX_N from the brute force's complexity: if brute is O(n^2), cap around
n <= 2000; if O(2^n) or O(n!), cap around n <= 18-22. Large stress cases will exceed
this cap and are validated by the optimal alone — that is expected and fine.
"""
        if has_brute else
        """
(SINGLE-ORACLE MODE — no brute force provided, so no DUAL-ORACLE cross-check):
Only the OPTIMAL solution is available. Embed it verbatim; its output is the `output`.
Without a second oracle there is NO cross-check, so the suite's correctness rests
entirely on the optimal being correct. Compensate by:
  * Generating MORE small hand-traceable cases (the bimodal small cluster) so a human
    reviewer can spot a wrong answer.
  * Adding a one-line comment at the top of the script: "WARNING: no brute-force oracle —
    outputs are unverified beyond self-consistency."
Strongly recommend the caller supply a brute force for full LeetCode-grade validation.
"""
    )

    subtask_block = f"""
(SUBTASKS — group cases by WHAT THEY VALIDATE):
Every case carries a `subtask` field: a snake_case name for the behaviour that case is
checking. Cases validating the SAME behaviour MUST share the same name.
  * Good names describe a behaviour: `empty_and_singleton`, `all_equal_elements`,
    `duplicate_keys`, `max_constraint_performance`, `negative_values`.
  * Bad names describe a size or restate the problem: `small_cases`, `test_group_2`.
  * Use between {MIN_SUBTASKS} and {MAX_SUBTASKS} distinct names across the whole suite.
  * Numbering and weighting are derived from these groups afterwards — a group of
    max-constraint cases automatically outweighs a group of degenerate ones. Do NOT
    emit `subtask_1`-style tags or any per-case weight.
"""

    # I/O representation depends on the problem kind. Function-based problems use
    # the description's named-variable-assignment input + return-value output;
    # non-function problems use line-based STDIN/STDOUT. Keeping this in lock-step
    # with descriptionPrompt.py's _function_example_format_addon is what stops the
    # generated `input`/`output` from drifting away from the statement.
    # A verified contract outranks both prose branches: it was produced by executing the
    # reference, so there is nothing left for the model to infer.
    frozen_io_block = _frozen_io_block(io_contract)
    if frozen_io_block:
        io_format_block = frozen_io_block
    elif is_function:
        params_note = ""
        if signature_params:
            params_note = (
                "\n  * For context, the reference function's parameters are: "
                f"{', '.join(signature_params)}. The stdin you produce must supply everything the "
                "solution reads (this may ALSO include size variables such as `n` that the solution "
                "reads but that are not function parameters) — follow what the SOLUTION reads, not "
                "just the parameter list."
            )
        io_format_block = f"""(I/O FORMAT — the REFERENCE SOLUTION's stdin parser is the SOURCE OF TRUTH):
  * This is a FUNCTION-based problem whose reference solution is embedded below and is run by
    piping `input` to its STANDARD INPUT. Study how OPTIMAL_CODE reads stdin (e.g. the
    `sys.stdin.read().split()` / `input()` / `readline()` logic in its `main`/driver) and produce
    each `input` in the EXACT raw stdin layout that parser expects. The one hard rule: feeding your
    `input` string to the reference solution on stdin MUST run cleanly and produce the right answer.
  * Use that raw stdin layout (the usual convention: a size/count line, then space-separated data
    line(s), one line per array/matrix row; a bracketed level-order line for tree/linked-list
    inputs). Do NOT emit `name = value` named variable assignments and do NOT emit Python literals
    like `[3, 3]` unless the solution literally parses that form. End the input with a trailing newline.
  * `output` is EXACTLY what the reference solution PRINTS to stdout for that input (capture its
    stdout — byte-for-byte, including line breaks), NOT a described return value.
  * The order-1 and order-2 public example cases MUST cover the SAME SCENARIOS (same values, same
    answer) as the description's Example 1 and Example 2 — but serialized as the raw stdin the
    solution reads. The description may show those examples as readable `name = value` assignments
    for humans; do NOT copy that display form, emit the equivalent raw stdin instead.{params_note}"""
    else:
        io_format_block = """(I/O FORMAT — match the description's Input/Output Format EXACTLY):
  * This is a STDIN/STDOUT problem. Produce `input`/`output` strings byte-exact to the spec
    (line-based STDIN/STDOUT: usually a size line then a data line per array).
  * Space-separated values via `' '.join(map(str, values))`. Do NOT use Python's default
    `str([1,2,3])` (gives "[1, 2, 3]") unless the spec literally uses that bracket form.
  * Handle newlines and trailing spaces per spec. Both fields are STDIN/STDOUT strings."""

    final_suite_block = f"""
(THIS IS THE FINAL SUITE — nothing trims it):
There is NO downstream selector. Every case you emit ships to the platform exactly as
written. So:
  * Emit {num_hint}. Every case must be DISTINCT — never pad with duplicates.
  * You are responsible for: correct outputs, distinct inputs, explicit edge cases, real
    at-MAX_N stress cases, and honest grouping (below).
  * You are NOT responsible for: size tags, weights, case order, or subtask numbers.
    Those are computed from your inputs after you run. Do not emit them.
"""

    declared_metadata_block = """
(DECLARED PER-CASE METADATA — the ONLY keys on a case, ALL REQUIRED on EVERY case):
  * `input` / `output`: the raw stdin and the reference solution's byte-exact stdout.
  * `subtask` (str, snake_case): the validation group — see the SUBTASKS section.
  * `size_metric` (int): the REAL numeric size THIS case scales by — array length / string length /
    rows*cols / nodes+edges / the value of n. This is what the size bucket is derived from, so it must
    be the true size (NOT blindly the first token if that token is not the size). Use 0 ONLY when the
    problem has no size dimension at all.
  * `scenario` (str, snake_case): the named scenario, e.g. "answer_at_end", "all_equal", "max_stress",
    "duplicates". One token.
  * `is_edge` (bool): true for degenerate / boundary / min literals (empty, n=min, all-same, overflow
    boundary, singleton). Mark them accurately — they are reported separately.
Emit NO other keys: no per-case weight, no `tags`, no `order`. Those are derived.
"""

    size_model_block = """
(PROBLEM SIZE MODEL — REQUIRED at the ROOT dict, alongside `test_cases`):
Declare how THIS problem scales so the size buckets come out right:
  * `size_model`: {"kind": "count"|"value"|"grid"|"multi"|"none", "max_n": <int>}
      - count : size is a count/length (array n, string length, #nodes). max_n = that maximum.
      - value : size is the magnitude of a single value (e.g. an integer up to 1e9). max_n = that max.
      - grid  : size is rows*cols. max_n = max rows*cols.
      - multi : several independent sizes (n and m and q...). max_n = the dominant one.
      - none  : NO size dimension (fixed/tiny input). max_n = 0.
  * `space_mode`: "sampled" | "exhaustive"
      - exhaustive : ONLY when you enumerate the ENTIRE legal input space (a small finite domain). A
        below-cap count is then COMPLETE, not a shortfall.
      - sampled : the normal case — the space is huge, you sample it.
"""

    system_prompt = f"""
(Role): You are an Expert Content Developer for Competitive Programming and technical
assessments. You build test suites that match LeetCode's COVERAGE rigor: every wrong
approach (slow OR incorrect) is caught, inputs are constraint-legal, and the size
distribution mirrors real judges.

(Context):
Generate a SINGLE standalone Python 3 script that writes `testcases.json`.
Inputs:
1. Problem Description (constraints, I/O format, examples).
2. Optimal Python Solution (verbatim — produces ground-truth outputs).
3. Brute-Force Python Solution ({"PROVIDED — use as validation oracle" if has_brute else "NOT provided"}).
4. Target total cases: {num_hint}
{oracle_block}
{subtask_block}
{_mandatory_example_block(description, io_contract)}

(SIZE LADDER — CORRECTNESS-HEAVY, FEW HIGH-VALUE STRESS):
Like real judges (LeetCode): MANY cheap small/degenerate correctness cases, FEW but REAL
stress cases. Do this explicitly IN CODE — do NOT hand-wave:
  1. Parse MAX_N (the largest primary-size constraint) from the Constraints section into a
     variable. If several sizes exist (n, m, q...), scale the dominant one.
  2. In SCENARIO_PLAN, assign every planned case a target size UP FRONT and pick its n from
     that range: degenerate (n = min, singleton, all-equal, boundary), small/hand-traceable,
     a THIN middle, and stress at/near MAX_N.
  3. Stress cases MUST actually use n at/near MAX_N. This is the #1 failure we see: a suite
     that is 100% small cannot catch a slow solution, and makes mutation testing vacuous —
     small inputs cannot kill off-by-one / comparison / boundary mutants.
Do NOT spread sizes evenly and do NOT push half the cases to max. A few worst-case stress
inputs at/near MAX_N fail a slow solution just as hard as fifty.

(MULTI-AXIS STRESS — MANDATORY when constraints expose MORE THAN ONE resource axis):
Many problems have TWO independent size axes: a COUNT (n items) and a SECONDARY resource
(per-item/total string length, value magnitude, coordinate range, #queries). Example:
`n <= 1e5` AND `sum of |s_i| <= 5e5`. Scaling ONLY the count axis produces stress cases of
many TINY items — a brute force whose per-pair cost depends on the SECONDARY axis (e.g. an
O(m^2) rotation/substring check) then survives, because m stays tiny. This exact failure
shipped suites where a quadratic brute force passed 152/153.
For EVERY secondary axis found in the constraints, the plan MUST include stress cases at:
  1. count axis max, secondary minimal      (n = MAX_N, tiny items — the usual shape)
  2. count MINIMAL, secondary at ITS cap    (e.g. n = 2 with total length at the cap:
     two ~250K-char strings when sum|s| <= 5e5) — derived bucket will be small/edge; that
     is EXPECTED and CORRECT, do NOT inflate n to please the audit. Include them anyway.
  3. balanced middle (both axes at ~sqrt of their joint budget, e.g. n=10 x len 50K)
Construct these adversarially for the likely wrong approaches: same-length pairwise
NON-equivalent items (forces full quadratic scans), near-miss pairs that defeat early
exits (differ only at the last compared position), and worst-case-shaped single items.

(ADVERSARIAL ENGINE — defeat specific WRONG approaches — CRITICAL):
Before generating inputs, the script MUST (in comments + a SCENARIO_PLAN structure):
  1. State the intended optimal algorithm (e.g. hash map O(n), two pointers, Dijkstra, DP).
  2. List common WRONG approaches students use (nested loops with early `return`, greedy
     that fails, sort-only, wrong bounds, int overflow, visited-set bugs).
  3. For each wrong approach, design a case that BREAKS it. Examples:
     * `answer_at_end` — valid answer only at the last positions → forces full scan,
       defeating "return on first match" naive loops that otherwise look fast on large n.
     * `early_exit_trap` / `no_early_exit` — structure where returning on first match is wrong.
     * `greedy_fails` — input where a greedy choice is locally optimal but globally wrong.
     * `overflow_values` — values near INT_MAX/INT_MIN to break 32-bit assumptions.
     * `duplicate_values` — wrong logic picks the wrong pair/index.
At most ONE case per group may be a pure `random` baseline; every other case targets a
NAMED scenario. Construct scenarios DETERMINISTICALLY (place the answer where you want,
fix the structure, then fill remaining elements safely within constraints) — do not rely
on random rejection sampling to hit a complex condition.

(UNIQUE-SOLUTION ENFORCEMENT — when the problem promises one):
If the statement says "exactly one solution" / "guaranteed unique":
  * Construct the input by INJECTING the intended unique answer, THEN scan the search
    space to verify NO OTHER pair/subset/path/index also satisfies the condition.
  * If a second solution exists, perturb a filler element and re-scan until unique.
  * Never emit a case that violates the uniqueness promise — it would make a correct
    solution look wrong.

(STRICT CONSTRAINT ADHERENCE):
  * Parse the Constraints section thoroughly. NEVER generate an input outside the stated
    ranges (e.g. do NOT emit an empty array when 2 <= n). Constraint bounds gate EVERY
    scenario above.
  * Dedup with a `seen_inputs` set that gates EVERY emitted case — it is authoritative.
    Do NOT add an `allow_duplicate`/force flag or any other bypass of `seen_inputs`, and do
    NOT clone a scenario into `*_repeat_1..N` specs to pad a count. Every `while`/generation
    loop has a hard attempt cap (e.g. `if attempts > 20000: break`) and unique fallbacks (add
    the attempt counter or a random filler so repeated fallbacks don't collide and re-trigger
    the loop).
  * NEVER `raise`, `assert`, or `sys.exit` because a scenario produced a duplicate input,
    could not reach its target case count, OR because the realized size/scenario mix missed
    a target. The ONLY assertions permitted in the whole script are CORRECTNESS asserts
    (optimal == brute on the same input). A size mix is a goal you generate toward, never a
    gate you crash on: if one size range is thin, ADD more cases for it and move on. A script
    that asserts `edge_pct ~= 0.20` and exits is a BUG.
    On a duplicate: SKIP it and continue (or perturb a
    filler within constraints and retry up to the cap, then move on). A scenario that yields
    fewer cases than planned is ACCEPTABLE — emit ONLY the distinct cases you actually have
    and move on; NEVER pad the count with duplicate or near-identical inputs. If a small
    domain (e.g. n=1) admits only one valid input, emit that ONE case, not many copies of it.
    The script must still finish and write testcases.json with whatever valid unique cases it
    has. The ONLY fatal condition allowed is a genuine oracle mismatch (optimal vs brute
    disagreement); every other shortfall (duplicates, count, size buckets) must degrade
    gracefully, never crash the script.
  * Constructive generation preferred over rejection sampling.

{io_format_block}

(SOLUTION EMBED + EXEC — avoid the classic NameError):
  * Embed OPTIMAL_CODE {"and BRUTE_CODE " if has_brute else ""}VERBATIM. Do not refactor.
  * MANDATORY: assign it as a RAW triple-quoted string — OPTIMAL_CODE = r'''...'''.
    A non-raw triple-quoted string escape-processes the solution's own "\\n" into a
    REAL newline, and the exec'd source then dies with
    "SyntaxError: unterminated string literal". Always use the r prefix.
  * Do NOT exec the solutions yourself — the harness below runs the source string for
    you (fresh single namespace per call, so imports and functions share scope).
  * IO HARNESS — MANDATORY, do NOT write your own stdin/stdout capture. A file
    `tc_harness.py` is placed NEXT TO your script before it runs. Use it for every
    solution execution:
        from tc_harness import run_solution
        out = run_solution(input_str, OPTIMAL_CODE)   # -> captured stdout (str)
    It execs the solution SOURCE STRING fresh in its own namespace with
    __name__ == "__main__", feeding stdin from input_str, and supports input(),
    sys.stdin.read(), sys.stdin.buffer, print(), sys.stdout.write() and
    sys.stdout.buffer. So `run_optimal = lambda s: run_solution(s, OPTIMAL_CODE)`{"; run_brute likewise with BRUTE_CODE" if has_brute else ""}.
    NEVER assign to sys.stdin, sys.stdout, or their `.buffer` attributes anywhere in the
    script — hand-rolled shims are the #1 in-process crash (readonly `.buffer`, StringIO
    without `.buffer`, unrestored streams) and are FORBIDDEN.
  * `normalize` strips trailing whitespace per line before comparison.

(OUTPUT HYGIENE — YOUR RESPONSE IS EXECUTED DIRECTLY AS .py — ABSOLUTELY CRITICAL):
Your ENTIRE response is written verbatim to a .py file and run with python. No
post-processing strips extra text.
  1. The VERY FIRST character MUST be valid Python (`import`, `#`, or `from`). The last
     line MUST be valid Python.
  2. Do NOT prepend/append anything non-Python: no preamble, no "Here is the script", no
     aphorisms, no sign-off.
  3. NO markdown fences (no ``` or ```python). No markdown anywhere.
  4. Human commentary lives ONLY in `#` comments or docstrings.

(NEVER CRASH — REPAIR INSTEAD. THE SCRIPT MUST ALWAYS WRITE testcases.json):
A script that raises is a total loss: no suite, and a wasted repair round trip. Every
failure below is one you can FIX IN CODE with information you already have, so fix it —
do NOT `assert` it and do NOT `raise`. The ONLY permitted abort is an optimal-vs-brute
ORACLE MISMATCH (a real correctness bug, which must stop the run).
  * Duplicate input: `add_case` returns False and the caller moves on. Never assert on it.
  * A scenario runs dry, or you cannot reach the target count: accept fewer cases and
    continue. Emitting fewer DISTINCT cases beats crashing or padding with duplicates.
  * A required key is missing on a case: SET it (sensible default) instead of raising.
  * Do not paper over it with bare `try/except: pass` either — fix the cause, keep the case.

(IMPORT CORRECTNESS — every import at the TOP of the file, before any other statement):
  * `import sys` is REQUIRED if you touch `sys` anywhere (including a `sys.stderr` progress
    print). A missing `import sys` is the single most common crash.
  * Define every function before the code that calls it. No forward references.
  * Only import names that exist. `round`/`abs`/`min`/`max`/`sum`/`pow`/`divmod` are
    BUILT-INS — never `from math import round`; use directly.
  * From `math` only real members (floor, ceil, sqrt, gcd, log, factorial, inf, pi), or
    `import math` and qualify. Prefer `import math/random/json` + qualified calls.
  * Typically you need only `import json`, `import random`, `import sys`, `import io`
    `from tc_harness import run_solution` (the IO harness above), and maybe `import math`.

{final_suite_block}
{declared_metadata_block}
{size_model_block}
(OUTPUT JSON SHAPE):
Root: a LIST containing EXACTLY ONE dict with keys `"test_cases"`, `"size_model"`, `"space_mode"`.
  CORRECT:   [ {{"test_cases": [...], "size_model": {{"kind": "count", "max_n": 100000}}, "space_mode": "sampled"}} ]
  INCORRECT: {{"test_cases": [...]}}   (dict at root is invalid; missing size_model/space_mode)
Each case dict carries EXACTLY: `input`, `output`, `subtask`, `scenario`, `is_edge`, `size_metric`.
Write with `json.dump(result, f, indent=4, ensure_ascii=False)`.

(Script structure):
1. imports, constants, `random.seed(42)`
2. OPTIMAL_CODE {"+ BRUTE_CODE " if has_brute else ""}as triple-quoted strings; run via `from tc_harness import run_solution`
3. serialize_input / serialize_output helpers, run_optimal{"/run_brute" if has_brute else ""}, normalize
4. comment: intended algorithm + naive pitfalls for THIS problem
5. plan structures (SUBTASK_PLAN + SCENARIO_PLAN) — every case named and assigned its
   `subtask` group before any input is built
6. iterate SCENARIO_PLAN: deterministic construct per scenario → run optimal{" + brute cross-check" if has_brute else ""} → append case
7. self-checks (CORRECTNESS asserts only) + size/diversity TOP-UP (add cases where a size
   range or scenario is thin; never assert/exit on the mix)
8. json.dump([{{"test_cases": test_cases, "size_model": {{"kind": SIZE_KIND, "max_n": MAX_N}}, "space_mode": SPACE_MODE}}], open("testcases.json","w"), indent=4, ensure_ascii=False)
   (every case dict must include size_metric/scenario/is_edge; SIZE_KIND/SPACE_MODE are the declared problem size model)

FINAL CHECK — verify these FIVE before you emit a single character. They are the only
things the pipeline CANNOT fix for you, so nothing else matters if one of them is wrong:
  1. FORMAT. Every `input` is the raw stdin the description's Input Format specifies, and
     every `output` is byte-for-byte what the solution PRINTS. Never a Python or JSON
     literal: `8` not `[8]`, `NO` not `["NO"]`, one token per line via
     "\\n".join(map(str, xs)) — never str(list) or json.dumps.
  2. IT PARSES. Valid Python, pure ASCII, imports at the top, no markdown fence.
  3. IT NEVER CRASHES. No `assert`, no `raise` — except a real optimal-vs-brute oracle
     mismatch. Weights, order, tags, counts and duplicates are all repaired downstream.
  4. IT WRITES testcases.json. A run that produces no file is a total loss.
  5. REAL STRESS. At least some inputs constructed at MAX_N, not just small ones.

Return ONLY the Python script. No markdown fences, no prose outside comments.
"""

    brute_section = (
        f"\n### Brute-Force Python Solution (validation oracle):\n{brute_force_code}\n"
        if has_brute else
        "\n### Brute-Force Python Solution:\n(none provided — single-oracle mode)\n"
    )

    user_prompt = f"""
### Problem Description:
{description}

### Optimal Python Solution (ground truth for outputs):
{optimal_solution}
{brute_section}"""
    return system_prompt, user_prompt


def _size_audit_lines(audit) -> str:
    realized = audit.get("realized", {})
    targets = audit.get("targets", SIZE_CATEGORY_TARGETS)
    rows = []
    for b in SIZE_BUCKETS:
        rows.append(
            f"  size_{b}: realized {realized.get(b, 0.0)}%  vs target {targets.get(b, 0.0)}%"
        )
    return "\n".join(rows)


def get_size_fix_prompt(failed_script, description, audit):
    """Build (system, user) to repair a generator script whose realized SIZE mix
    missed SIZE_CATEGORY_TARGETS.

    The script RAN fine — it just produced the wrong size distribution (almost
    always all-small: the script never scaled the primary size n toward the
    constraint maximum). That fails B3 coverage-shape downstream and makes
    mutation testing vacuous, so this re-prompt asks the model to fix the SIZE
    LADDER only, preserving the dual-oracle / scoring / JSON-shape behavior.
    """
    deficient = audit.get("deficient") or []
    excessive = audit.get("excessive") or []
    def_str = ", ".join(
        f"size_{d['bucket']} (short by {d['shortfall_pp']}pp)" for d in deficient
    ) or "none"
    exc_str = ", ".join(
        f"size_{d['bucket']} (over by {d['excess_pp']}pp)" for d in excessive
    ) or "none"

    system = (
        "You are a Python expert fixing a competitive-programming test-case GENERATOR "
        "script. The script runs correctly but the suite it emits has the WRONG SIZE "
        "DISTRIBUTION: it does not match the required edge/small/medium/large mix. Almost "
        "always the cause is that the script never scales the primary input size n up "
        "toward the constraint maximum, so every case lands in 'small'. Fix the script so "
        "the realized size mix matches the targets within tolerance, WITHOUT changing the "
        "dual-oracle / scoring behavior, the JSON shape, or the I/O format, and keeping all "
        "existing correctness asserts. "
        "OUTPUT HYGIENE (CRITICAL): your entire response is written verbatim to a .py file "
        "and executed. The first character MUST be valid Python (import/#/from); no preamble, "
        "no sign-off, no markdown fences. "
        "IMPORT CORRECTNESS: only import names that exist; round/abs/min/max/sum/pow are "
        "built-ins, not in math."
    )

    user = f"""The generator script below RAN successfully but produced a suite whose size
distribution is out of spec.

REALIZED vs TARGET size distribution ({audit.get('total', 0)} cases):
{_size_audit_lines(audit)}

DEFICIENT buckets (need MANY MORE of these): {def_str}
EXCESSIVE buckets (have too many): {exc_str}
Tolerance: +/- {audit.get('tolerance_pp', SIZE_TOLERANCE_PP)} percentage points per bucket.

HOW TO FIX (do ALL of these):
1. Parse the constraint maximum N from the problem (call it MAX_N). If several sizes
   exist (n, m, q...), scale the dominant one.
2. Build an explicit SIZE LADDER and assign every case a target bucket BEFORE building it:
   Every boundary below is a FRACTION of THIS problem's own MAX_N — never a fixed
   number — and is exactly how the B3 gate buckets your cases:
     * size_edge   (~{SIZE_CATEGORY_TARGETS['edge']}%): DEGENERATE cases — set `is_edge: true` and the
       tag follows automatically: n = min, empty, singleton, all-same, already-satisfying,
       infeasible/impossible, overflow boundary. Do NOT rely on n <= 1 to fill this bucket — when the
       alphabet is tiny (a binary string has exactly TWO inputs of length 1) there are not enough
       distinct minimum-size inputs to reach the target, so flag SMALL degenerate cases instead.
     * size_small  (~{SIZE_CATEGORY_TARGETS['small']}%): 1 < n <= {SMALL_FRAC:g}*MAX_N, hand-traceable at the low end.
     * size_medium (~{SIZE_CATEGORY_TARGETS['medium']}%): {SMALL_FRAC:g}*MAX_N < n < {LARGE_FRAC:g}*MAX_N (keep thin).
     * size_large  (~{SIZE_CATEGORY_TARGETS['large']}%): n >= {LARGE_FRAC:g}*MAX_N, pushed toward MAX_N — REAL stress sizes, NOT small.
3. For deficient buckets, ADD cases constructed at the right n. For size_large you MUST
   generate inputs with n near MAX_N (fill with constraint-legal values; keep the
   brute-force cross-check guarded by its own size cap so large cases are validated by the
   optimal alone).
4. Re-tag each case with the correct size_<bucket> from its ACTUAL n. COUNT the buckets and
   ADD cases for short ones; never assert/exit on the distribution — over-supply is fine.

Do not reduce the total below the current count. Return ONLY the corrected Python script.

### Problem Description (for constraint parsing):
{description}

### Current generator script:
{failed_script}
"""
    return system, user
