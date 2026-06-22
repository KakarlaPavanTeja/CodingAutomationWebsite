"""
v4 test-case generation prompt — LeetCode-grade coverage.

Key changes from v3:
  * DUAL ORACLE. The generated script embeds BOTH the optimal solution and a
    brute-force solution. Optimal produces the expected `output` (ground truth);
    brute force CROSS-CHECKS every generated case. If they disagree on any case,
    the script aborts loudly — a buggy "optimal" can no longer silently poison
    the suite. (Brute force is the oracle, not the answer source — the
    LeetCode-correct division of labor.)
  * BIMODAL SIZE DISTRIBUTION (not uniform, not max-heavy). A large cluster of
    tiny hand-traceable cases + a separate cluster pinned at max, sparse middle.
  * PER-PROBLEM-TYPE STRATEGY. Explicit required scenarios for array / string /
    tree / graph / DP / sliding-window / math problems.
  * ADVERSARIAL ENGINE (carried from v3 and strengthened): scenarios crafted to
    break specific wrong approaches (early-exit, greedy-instead-of-DP, etc.).
  * UNIQUE-SOLUTION VERIFICATION (lifted from v1): for "exactly one solution"
    problems, inject the target and scan the search space to prove uniqueness.
  * DIFFICULTY x TYPE COUNT. Target count scales; not a flat random range.
  * WEIGHTED SCORING. Output always carries weightage + subtask tags
    (partial-credit judge).

Public API mirrors v3 so the manager can import the same names.
"""

DEFAULT_DISTRIBUTION_PRESET = "assessment"
MIN_SUBTASKS = 3
MAX_SUBTASKS = 6
MAX_CASES_PER_SUBTASK = 12
MIN_TESTCASES = 25                          # raised from 20 — LeetCode Easy floor

# Size-category distribution targets (count %, enforced by B3 in benchmark_suite).
SIZE_CATEGORY_TARGETS = {
    "edge": 20.0,
    "small": 40.0,
    "medium": 8.0,
    "large": 32.0,
}
SIZE_TOLERANCE_PP = 7.0  # +/- percentage points
SIZE_TAG_PREFIX = "size_"
SIZE_BUCKETS = ("edge", "small", "medium", "large")


def size_tag(bucket: str) -> str:
    if bucket not in SIZE_BUCKETS:
        raise ValueError(f"size bucket must be one of {SIZE_BUCKETS}, got {bucket!r}")
    return f"{SIZE_TAG_PREFIX}{bucket}"

# Difficulty x problem-type target band. Used only as a hint to the model; the
# manager passes difficulty + (optional) detected type. Strings/DP skew high.
COUNT_BAND_BY_DIFFICULTY = {
    "easy":   (25, 45),
    "medium": (50, 90),
    "hard":   (90, 160),
}
# Multipliers nudging the band by problem family (applied to the upper end).
TYPE_COUNT_HINT = {
    "string": "skew HIGH (strings need many cases — aim near the top of the band or above)",
    "dp": "skew HIGH (DP needs many small cases covering every transition)",
    "math": "exhaustively cover the SMALL input range (every value up to a modest cap)",
    "array": "mid band",
    "graph": "skew LOW-MID but structurally diverse (fewer cases, many topologies)",
    "tree": "skew LOW-MID but structurally diverse (skewed, balanced, single-node, max-depth)",
    "sliding_window": "mid band; include window=1 and window=entire-array",
    "greedy": "mid-high; include cases where greedy-instead-of-correct fails",
    "generic": "mid band",
}

# Weight % per subtask (must sum to 100). Later subtasks = stress tiers.
DISTRIBUTION_BY_MODE = {
    "assessment": {
        3: [12, 28, 60],
        4: [10, 18, 24, 48],
        5: [9, 13, 17, 22, 39],
        6: [6, 10, 13, 16, 19, 36],
    },
    "contest": {
        3: [8, 27, 65],
        4: [6, 14, 25, 55],
        5: [6, 11, 16, 24, 43],
        6: [5, 9, 13, 16, 22, 35],
    },
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


def _format_distribution_tables() -> str:
    lines = []
    for mode, by_count in DISTRIBUTION_BY_MODE.items():
        lines.append(f"  {mode!r}:")
        for n in sorted(by_count):
            pcts = by_count[n]
            lines.append(f"    {n}: {pcts},  # {' / '.join(str(p) for p in pcts)}")
    return "\n".join(lines)


def _count_hint(difficulty, problem_type, num_testcases):
    diff = (difficulty or "").strip().lower()
    band = COUNT_BAND_BY_DIFFICULTY.get(diff)
    type_note = TYPE_COUNT_HINT.get((problem_type or "generic").strip().lower(),
                                    TYPE_COUNT_HINT["generic"])
    if num_testcases is not None:
        floor = max(num_testcases, MIN_TESTCASES)
        return (f"at least {floor} (hard minimum {MIN_TESTCASES}; "
                f"max {MAX_CASES_PER_SUBTASK} per subtask). Type guidance: {type_note}.")
    if band:
        lo, hi = band
        lo = max(lo, MIN_TESTCASES)
        return (f"target {lo}-{hi} for '{diff}' difficulty "
                f"(hard minimum {MIN_TESTCASES}; max {MAX_CASES_PER_SUBTASK} per subtask). "
                f"Type guidance: {type_note}.")
    return (f"at least {MIN_TESTCASES} (no difficulty given; "
            f"max {MAX_CASES_PER_SUBTASK} per subtask). Type guidance: {type_note}.")


def get_testcases_prompt(
    description,
    solution_code,
    total_score,
    brute_force_code=None,
    num_testcases=None,
    distribution_preset=DEFAULT_DISTRIBUTION_PRESET,
    difficulty=None,
    problem_type=None,
):
    """
    Build (system_prompt, user_prompt) for v4 generation.

    brute_force_code : optional second solution used purely as a validation
        oracle. When provided, the generated script must cross-check every case
        (optimal vs brute) and abort on any mismatch. When None, the script
        falls back to self-consistency checks only and notes the weaker guarantee.
    Output is always weighted (weightage + subtask tags) for a partial-credit judge.
    """
    if distribution_preset not in DISTRIBUTION_BY_MODE:
        distribution_preset = DEFAULT_DISTRIBUTION_PRESET
    if num_testcases is not None:
        num_testcases = max(num_testcases, MIN_TESTCASES)

    dist_tables = _format_distribution_tables()
    num_hint = _count_hint(difficulty, problem_type, num_testcases)
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
(SINGLE-ORACLE MODE — no brute force provided):
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

    scoring_block = f"""
(SCORING — partial-credit judge, weighted):
Every case carries subtask structure and per-case weights.
- Each case carries `weightage` (> 0), exactly one `subtask_<n>` tag, and exactly one `size_<edge|small|medium|large>` tag.
- Subtask weight split comes from DISTRIBUTION_BY_COUNT[preset][SUBTASK_COUNT].
- Within a subtask, skew weight toward stress/adversarial scenarios (see multiplier fn).
- Output case keys IN ORDER: `input`, `output`, `weightage`, `tags`, `order`.
- Invariants: weights sum to TOTAL_WEIGHTAGE (±0.01); top subtask holds >= 35% of weight;
  stress-tagged cases hold >= 30% of weight; all weights > 0.
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
4. Total Weightage: {total_score}
5. Target total cases: {num_hint}
6. Distribution mode: `{distribution_preset}`.
{oracle_block}
{scoring_block}

(SIZE DISTRIBUTION — BIMODAL WITH EXPLICIT % TARGETS — CRITICAL):
Real judge sets cluster at TWO ends with a sparse middle. Each case MUST carry
exactly ONE size tag: `size_edge`, `size_small`, `size_medium`, or `size_large`.
Target COUNT distribution (within +/-7 percentage points):
  * size_edge  (~20%): min/degenerate sizes, singleton, all-equal, boundary extremes.
  * size_small (~40%): n in [2, ~20], hand-traceable correctness cluster (majority).
  * size_medium (~8%): sparse middle (n between ~21 and ~0.5*max N); keep thin.
  * size_large (~32%): n at or near max constraint N; TLE/overflow/stress cluster.
Do NOT spread sizes evenly and do NOT push half the cases to max only. The small
cluster and the max cluster should each be substantial; the middle stays thin.
Self-check: assert realized size_* tag counts match targets within tolerance.

(PER-PROBLEM-TYPE REQUIRED SCENARIOS):
Detect the problem family from the statement + solution and include its mandatory cases.
| Family | Must-include scenarios |
|--------|------------------------|
| Array | all-negative, all-zero, all-equal, single element, min & max values, heavy duplicates, sorted asc, reverse sorted |
| String | empty (if allowed), single char, all-same char, palindrome, no-match, max length, spaces/unicode if in alphabet |
| Tree | single node, fully left-skewed (linked-list shape), fully right-skewed, perfectly balanced, max depth |
| Graph | single node, disconnected components, self-loop (if allowed), complete graph, line/path graph, max edges |
| DP | n=0 (if allowed), n=1, the impossible/"-1" case, greedy-beats-correct trap, all-zeros, max n |
| Sliding window | window = 1, window = entire array, all duplicates, all distinct |
| Math/combinatorial | exhaustively cover the SMALL value range, plus the max value; off-by-one at boundaries |
Adapt names to the actual problem. Skip a row only if constraints make it impossible
(e.g. empty array when 2 <= n).

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
  * Dedup with a `seen_inputs` set; every `while`/generation loop has a hard attempt cap
    (e.g. `if attempts > 20000: break`) and unique fallbacks (add the attempt counter or a
    random filler so repeated fallbacks don't collide and re-trigger the loop).
  * Constructive generation preferred over rejection sampling.

(I/O FORMAT — match the statement EXACTLY):
  * Read the Input/Output Format sections. Produce `input`/`output` strings byte-exact to
    the spec (line-based STDIN/STDOUT: usually a size line then a data line per array).
  * Space-separated values via `' '.join(map(str, values))`. Do NOT use Python's default
    `str([1,2,3])` (gives "[1, 2, 3]") unless the spec literally uses that bracket form.
  * Handle newlines and trailing spaces per spec. Both fields are STDIN/STDOUT strings.

(SOLUTION EMBED + EXEC — avoid the classic NameError):
  * Embed OPTIMAL_CODE {"and BRUTE_CODE " if has_brute else ""}VERBATIM. Do not refactor.
  * Use a SINGLE namespace per solution so its `import sys` and `main()` share scope:
        opt_env = {{ "__name__": "optimal_ns" }}
        exec(OPTIMAL_CODE, opt_env)
    then call opt_env['main']() (or the named function) inside run_optimal.
  * Do NOT use `exec(CODE, globals_dict, locals_dict)` with two dicts — that splits the
    solution's imports from where you look up `main`, causing NameError for `sys`.
  * `run_optimal` (and `run_brute`) feed `input` via StringIO on sys.stdin and capture
    stdout; `normalize` strips trailing whitespace per line before comparison.

(OUTPUT HYGIENE — YOUR RESPONSE IS EXECUTED DIRECTLY AS .py — ABSOLUTELY CRITICAL):
Your ENTIRE response is written verbatim to a .py file and run with python. No
post-processing strips extra text.
  1. The VERY FIRST character MUST be valid Python (`import`, `#`, or `from`). The last
     line MUST be valid Python.
  2. Do NOT prepend/append anything non-Python: no preamble, no "Here is the script", no
     aphorisms, no sign-off.
  3. NO markdown fences (no ``` or ```python). No markdown anywhere.
  4. Human commentary lives ONLY in `#` comments or docstrings.

(IMPORT CORRECTNESS):
  * Only import names that exist. `round`/`abs`/`min`/`max`/`sum`/`pow`/`divmod` are
    BUILT-INS — never `from math import round`; use directly.
  * From `math` only real members (floor, ceil, sqrt, gcd, log, factorial, inf, pi), or
    `import math` and qualify. Prefer `import math/random/json` + qualified calls.
  * Typically you need only `import json`, `import random`, `import sys`, `from io import StringIO`,
    and maybe `import math`.

(OUTPUT JSON SHAPE):
Root: a LIST containing EXACTLY ONE dict whose only key is `"test_cases"`.
  CORRECT:   [ {{"test_cases": [...]}} ]
  INCORRECT: {{"test_cases": [...]}}   (dict at root is invalid)
Write with `json.dump(result, f, indent=4, ensure_ascii=False)`.
`order` is global 1..N, sequential (+1 each), smallest/example first, max stress last.

(WEIGHT DISTRIBUTION):
Embed and use this dict after choosing SUBTASK_COUNT (3-6, problem-driven, do NOT default to 4):
```
DISTRIBUTION_BY_COUNT = {{
{dist_tables}
}}
```
Compute subtask buckets from the row for the chosen count, then split within each bucket
by a multiplier that favors stress/adversarial cases:
```
STRESS_SCENARIO_TAGS = frozenset({{
    "stress", "max_constraint", "worst_case_position", "early_exit_trap",
    "answer_at_end", "adversarial", "tle_trap",
}})
def case_weight_multiplier(tags, tier, top_tier):
    m, ts = 1.0, set(tags)
    if "example" in ts: m *= 0.5
    if "random" in ts and not ts & STRESS_SCENARIO_TAGS: m *= 0.75
    if ts & STRESS_SCENARIO_TAGS: m *= 2.0
    if "stress" in ts or "max_constraint" in ts: m *= 1.25
    if tier == top_tier: m *= 1.3
    return max(m, 0.25)
```
Use integer-cents splitting so weights sum exactly; ensure every weight > 0.

(SELF-CHECK BEFORE WRITE):
  * Every case validated by the optimal{" and cross-checked by brute (where size permits)" if has_brute else ""}.
  * `seen_inputs` dedup; all inputs constraint-legal.
  * Bimodal size check: assert there exist cases with small n AND cases at/near max n.
  * Size distribution: assert each size_* bucket within +/-7pp of targets (edge 20%, small 40%, medium 8%, large 32%).
  * Scenario diversity: distinct scenario tags >= max(2, non_example_count // 3).
  * `order` == 1..N sequential.
  * Weight asserts: weight-sum, top-tier-share, stress-share (see scoring block).

(Script structure):
1. imports, constants, `random.seed(42)`
2. OPTIMAL_CODE {"+ BRUTE_CODE " if has_brute else ""}as triple-quoted strings; exec each into its own single-namespace env
3. serialize_input / serialize_output helpers, run_optimal{"/run_brute" if has_brute else ""}, normalize
4. comment: intended algorithm + naive pitfalls for THIS problem
5. plan structures (SUBTASK_PLAN + SCENARIO_PLAN) — every case named before any input is built
6. weight computation
7. iterate SCENARIO_PLAN: deterministic construct per scenario → run optimal{" + brute cross-check" if has_brute else ""} → append case
8. self-checks + diversity + bimodal asserts
9. json.dump([{{"test_cases": test_cases}}], open("testcases.json","w"), indent=4, ensure_ascii=False)

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
{solution_code}
{brute_section}"""
    return system_prompt, user_prompt
