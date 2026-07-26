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
MAX_SUBTASKS = 8
MAX_CASES_PER_SUBTASK = 12
MIN_TESTCASES = 25                          # raised from 20 — LeetCode Easy floor

# Over-generation targets (redesign): the LLM emits a generator SCRIPT, so volume
# is nearly free. A downstream deterministic selector dedups, verifies TLE, scores
# wrong-solution kills, and trims to CASE_CAP — so the generator should aim HIGH and
# leave the final count/size%/weights to the selector. These bound the candidate POOL.
POOL_TARGET_MIN = 150
POOL_TARGET_MAX = 250
CASE_CAP = 150                              # mirrors testcase_selection.CASE_CAP

# Size-category distribution targets (count %, enforced by B3 in benchmark_suite).
# Philosophy (matches real judges like LeetCode): the suite is dominated by cheap
# small/edge CORRECTNESS cases; large/stress cases are FEW but high-value. You don't
# need 50-100 max-size cases — a handful of well-constructed worst cases gates TLE
# just as hard. The few large cases carry most of the WEIGHT (see scoring block), not
# most of the COUNT.
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

# Difficulty x problem-type target band. Used only as a hint to the model; the
# manager passes difficulty + (optional) detected type. Strings/DP skew high.
# Over-generate: the selector dedups + trims to CASE_CAP, so aim for a large POOL.
COUNT_BAND_BY_DIFFICULTY = {
    "easy":   (60, 150),
    "medium": (120, 220),
    "hard":   (150, 280),
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
# IMPORTANT: every subtask count in [MIN_SUBTASKS, MAX_SUBTASKS] MUST have a row in
# BOTH presets, or the generated script's DISTRIBUTION_BY_COUNT[preset][k] lookup
# KeyErrors. Keep the highest key == MAX_SUBTASKS. Each row sums to 100, is monotonic
# increasing, and the top tier holds >= 35% (scoring-block invariant).
DISTRIBUTION_BY_MODE = {
    "assessment": {
        3: [12, 28, 60],
        4: [10, 18, 24, 48],
        5: [9, 13, 17, 22, 39],
        6: [6, 10, 13, 16, 19, 36],
        7: [5, 7, 9, 11, 14, 19, 35],
        8: [4, 5, 7, 8, 10, 13, 18, 35],
    },
    "contest": {
        3: [8, 27, 65],
        4: [6, 14, 25, 55],
        5: [6, 11, 16, 24, 43],
        6: [5, 9, 13, 16, 22, 35],
        7: [4, 6, 8, 10, 13, 21, 38],
        8: [3, 4, 6, 8, 10, 13, 18, 38],
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




def _mandatory_example_block(description: str) -> str:
    """Prompt block requiring order 1-2 cases to mirror description examples."""
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
    lines = [
        "(MANDATORY PUBLIC EXAMPLES):",
        "The first 2 test cases (`order` 1 and `order` 2) MUST use EXACTLY these IO pairs copied verbatim from the description (tag both `example`):",
    ]
    for i, (inp, out) in enumerate(pairs[:2], 1):
        lines.append(f"  Example {i} input:\n{inp!r}")
        lines.append(f"  Example {i} output:\n{out!r}")
    return "\n".join(lines) + "\n"

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
    overflow = (f"OVER-GENERATE toward a pool of ~{POOL_TARGET_MIN}-{POOL_TARGET_MAX} DISTINCT "
                f"cases — the downstream selector dedups and trims to {CASE_CAP}, so more is "
                f"better and there is NO tight per-subtask cap.")
    if num_testcases is not None:
        floor = max(num_testcases, MIN_TESTCASES)
        return (f"at least {floor} (hard minimum {MIN_TESTCASES}). {overflow} "
                f"Type guidance: {type_note}.")
    if band:
        lo, hi = band
        lo = max(lo, MIN_TESTCASES)
        return (f"target {lo}-{hi} for '{diff}' difficulty (hard minimum {MIN_TESTCASES}). "
                f"{overflow} Type guidance: {type_note}.")
    return (f"at least {MIN_TESTCASES} (no difficulty given). {overflow} "
            f"Type guidance: {type_note}.")


def get_testcases_prompt(
    description,
    solution_code,
    total_score,
    brute_force_code=None,
    num_testcases=None,
    distribution_preset=DEFAULT_DISTRIBUTION_PRESET,
    difficulty=None,
    problem_type=None,
    is_function=True,
    signature_params=None,
):
    """
    Build (system_prompt, user_prompt) for v4 generation.

    brute_force_code : optional second solution used purely as a validation
        oracle. When provided, the generated script must cross-check every case
        (optimal vs brute) and abort on any mismatch. When None, the script
        falls back to self-consistency checks only and notes the weaker guarantee.
    Output is always weighted (weightage + subtask tags) for a partial-credit judge.

    is_function / signature_params : whether this is a function-based problem and,
        if so, the reference function's parameter names. Both function-based and
        non-function problems now use the RAW STDIN/STDOUT representation the reference
        solution actually parses (the reference solution's stdin reader is the source of
        truth); `signature_params` is passed only as context about what the solution
        reads. This keeps the generated `input`/`output` in lock-step with the solution
        and the description examples, and lets the generated suite be validated by
        piping each `input` to the reference solution.
    """
    if distribution_preset not in DISTRIBUTION_BY_MODE:
        distribution_preset = DEFAULT_DISTRIBUTION_PRESET
    if num_testcases is not None:
        num_testcases = max(num_testcases, MIN_TESTCASES)

    dist_tables = _format_distribution_tables()
    num_hint = _count_hint(difficulty, problem_type, num_testcases)
    has_brute = bool(brute_force_code and brute_force_code.strip())

    # Single source of truth for the size targets shown in the prompt — interpolated
    # from SIZE_CATEGORY_TARGETS so the prompt can never drift from what B3 enforces.
    st = SIZE_CATEGORY_TARGETS
    tol = SIZE_TOLERANCE_PP
    size_targets_block = (
        f"  * size_edge   (~{st['edge']:g}%): min/degenerate sizes, singleton, all-equal, boundary extremes.\n"
        f"  * size_small  (~{st['small']:g}%): n in [2, ~20], hand-traceable correctness cluster (the MAJORITY).\n"
        f"  * size_medium (~{st['medium']:g}%): sparse middle (n between ~21 and ~0.5*max N); keep thin.\n"
        f"  * size_large  (~{st['large']:g}%): n at/near max constraint N; FEW but high-value stress cases."
    )
    size_targets_inline = ", ".join(f"{b} {st[b]:g}%" for b in ("edge", "small", "medium", "large"))

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
- Output case keys IN ORDER: `input`, `output`, `weightage`, `tags`, `order`, `size_metric`, `scenario`, `is_edge`.
- Invariants: weights sum to TOTAL_WEIGHTAGE (±0.01); top subtask holds >= 35% of weight;
  stress/large cases carry ~50% of weight (target 50%, assert >= 45%) — they are FEW in
  COUNT but high-value, so passing them gates most of the score; all weights > 0.
"""

    # I/O representation depends on the problem kind. Function-based problems use
    # the description's named-variable-assignment input + return-value output;
    # non-function problems use line-based STDIN/STDOUT. Keeping this in lock-step
    # with descriptionPrompt.py's _function_example_format_addon is what stops the
    # generated `input`/`output` from drifting away from the statement.
    if is_function:
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

    overgenerate_block = f"""
(OVER-GENERATE — a downstream SELECTOR dedups, verifies TLE, scores kills, and trims to {CASE_CAP}):
This suite is NO LONGER the final suite. A deterministic selector runs AFTER you: it removes
exact-input duplicates, buckets by size, times the brute force for TLE, scores which cases catch
wrong solutions, and keeps the strongest ~{CASE_CAP}. So:
  * Aim HIGH: emit a LARGE pool of DISTINCT cases (target ~{POOL_TARGET_MIN}-{POOL_TARGET_MAX}). More
    distinct, well-labeled cases is strictly better. Do NOT minimize the count or stop early.
  * You are NOT responsible for the final count, the exact size %, or the final weights — the
    selector owns those. You ARE responsible for: correct outputs, DISTINCT inputs, explicit edge
    cases, real at-MAX_N stress cases, and accurate per-case labels (below).
  * Keep emitting distinct cases per scenario/size until the scenario runs dry (respect `seen_inputs`
    and the attempt caps); never pad with duplicates.
"""

    declared_metadata_block = """
(DECLARED PER-CASE METADATA — REQUIRED on EVERY case, consumed by the selector):
In ADDITION to input/output/weightage/tags/order, every case MUST also carry:
  * `size_metric` (int): the REAL numeric size THIS case scales by — array length / string length /
    rows*cols / nodes+edges / the value of n. This is what the selector buckets on, so it must be the
    true size (NOT blindly the first token if that token is not the size). Use 0 ONLY when the problem
    has no size dimension at all.
  * `scenario` (str, snake_case): the named scenario, e.g. "answer_at_end", "all_equal", "max_stress",
    "duplicates". Mirror the scenario tag; one token.
  * `is_edge` (bool): true for degenerate / boundary / min literals (empty, n=min, all-same, overflow
    boundary, singleton). The selector FORCE-KEEPS every is_edge case, so mark them accurately.
"""

    size_model_block = """
(PROBLEM SIZE MODEL — REQUIRED at the ROOT dict, alongside `test_cases`):
Declare how THIS problem scales so the selector buckets correctly:
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
4. Total Weightage: {total_score}
5. Target total cases: {num_hint}
6. Distribution mode: `{distribution_preset}`.
{oracle_block}
{scoring_block}
{_mandatory_example_block(description)}

(SIZE DISTRIBUTION — CORRECTNESS-HEAVY, FEW HIGH-VALUE STRESS — CRITICAL):
Like real judges (LeetCode): MANY cheap small/edge correctness cases, FEW large
stress cases. Each case MUST carry exactly ONE size tag: `size_edge`, `size_small`,
`size_medium`, or `size_large`.
Target COUNT distribution (within +/-{tol:g} percentage points):
{size_targets_block}
Do NOT spread sizes evenly and do NOT push half the cases to max. The small cluster
DOMINATES the count; large cases are deliberately FEW — but they carry ~50% of the
WEIGHT (see scoring block), so for large cases quality matters far more than quantity.
A few worst-case stress inputs at/near MAX_N fail a slow solution just as hard as fifty.

MANDATORY SIZE-LADDER RECIPE (do this explicitly IN CODE — do NOT hand-wave):
  1. Parse MAX_N (the largest primary-size constraint) from the Constraints section into
     a variable. If several sizes exist (n, m, q...), scale the dominant one.
  2. In SCENARIO_PLAN, assign every planned case a TARGET size bucket UP FRONT, then pick
     its n FROM that bucket's range:
        edge   -> min / degenerate (n = min, singleton, all-equal, boundary)
        small  -> n in [2, 20]
        medium -> n in [21, 0.5*MAX_N]
        large  -> n in [0.8*MAX_N, MAX_N]   (REAL stress sizes — fill with legal values)
  3. size_large cases MUST use n at/near MAX_N. This is the #1 failure we see: a suite
     that is 100% small is REJECTED by the coverage-shape gate (B3) AND makes mutation
     testing vacuous — small inputs cannot kill off-by-one / comparison / boundary mutants.

HOW THE SIZE AUDIT ACTUALLY BUCKETS YOUR CASES (match it EXACTLY — it IGNORES your tags):
  The audit does NOT trust your size_* tag. It DERIVES each case's bucket from the raw
  input: n = the FIRST integer token of the input's FIRST line, then:
     n >= 0.8*MAX_N            -> large
     n <= 1                    -> edge
     n <= 20                   -> small
     n >= 0.5*MAX_N            -> large    else -> medium
     (first token NOT an integer -> the case can ONLY be edge/small, never large/medium)
  CONSEQUENCE: when the problem has a size dimension, the FIRST LINE's FIRST TOKEN must BE
  that primary size n (array length / count / etc.), and every size_large case must make
  that token >= 0.8*MAX_N. If you lead the input with a non-size value, or never scale n
  up, the audit records 0% large and REGENERATES you — no matter how you tagged the cases.
Self-check (MUST mirror the audit, not your own tags): for each case, parse the first int
token of its first input line as n, compute the DERIVED bucket with the rule above, and
assert the derived bucket counts match targets ({size_targets_inline}) within +/-{tol:g}pp.
If a bucket is short, ADD constraint-scaled cases for it before writing JSON.

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
  * Dedup with a `seen_inputs` set that gates EVERY emitted case — it is authoritative.
    Do NOT add an `allow_duplicate`/force flag or any other bypass of `seen_inputs`, and do
    NOT clone a scenario into `*_repeat_1..N` specs to pad a count. Every `while`/generation
    loop has a hard attempt cap (e.g. `if attempts > 20000: break`) and unique fallbacks (add
    the attempt counter or a random filler so repeated fallbacks don't collide and re-trigger
    the loop).
  * NEVER `raise`, `assert`, or `sys.exit` because a scenario produced a duplicate input or
    could not reach its target case count. On a duplicate: SKIP it and continue (or perturb a
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

{overgenerate_block}
{declared_metadata_block}
{size_model_block}
(OUTPUT JSON SHAPE):
Root: a LIST containing EXACTLY ONE dict with keys `"test_cases"`, `"size_model"`, `"space_mode"`.
  CORRECT:   [ {{"test_cases": [...], "size_model": {{"kind": "count", "max_n": 100000}}, "space_mode": "sampled"}} ]
  INCORRECT: {{"test_cases": [...]}}   (dict at root is invalid; missing size_model/space_mode)
Each case dict carries: `input`, `output`, `weightage`, `tags`, `order`, `size_metric`, `scenario`, `is_edge`.
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
    if ts & STRESS_SCENARIO_TAGS: m *= 2.5
    if "stress" in ts or "max_constraint" in ts: m *= 1.25
    if tier == top_tier: m *= 1.3
    return max(m, 0.25)
```
Use integer-cents splitting so weights sum exactly; ensure every weight > 0.
STRESS SHARE TARGET (~50%): after applying multipliers, compute the total weight held by
stress/large cases (tags in STRESS_SCENARIO_TAGS or size_large). If it is < 45% of
TOTAL_WEIGHTAGE, scale stress/large weights UP (and/or non-stress weights down) until the
stress/large share is ~50%, THEN re-normalize so the grand total is exact. This is
intentional: large cases are few in count but must gate roughly half the score.

(SELF-CHECK BEFORE WRITE):
  * Every case validated by the optimal{" and cross-checked by brute (where size permits)" if has_brute else ""}.
  * `seen_inputs` dedup; all inputs constraint-legal.
  * Bimodal size check: assert there exist cases with small n AND cases at/near max n.
  * Size distribution: assert each size_* bucket within +/-{tol:g}pp of targets ({size_targets_inline}).
  * Scenario diversity: distinct scenario tags >= max(2, non_example_count // 3).
  * Declared metadata present: EVERY case has int `size_metric`, str `scenario`, bool `is_edge`;
    the root dict has `size_model` (kind+max_n) and `space_mode`.
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
9. json.dump([{{"test_cases": test_cases, "size_model": {{"kind": SIZE_KIND, "max_n": MAX_N}}, "space_mode": SPACE_MODE}}], open("testcases.json","w"), indent=4, ensure_ascii=False)
   (every case dict must include size_metric/scenario/is_edge; SIZE_KIND/SPACE_MODE are the declared problem size model)

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
     * size_edge   (~{SIZE_CATEGORY_TARGETS['edge']}%): degenerate / min sizes (n = min, singleton, all-equal, boundary).
     * size_small  (~{SIZE_CATEGORY_TARGETS['small']}%): n in [2, 20], hand-traceable.
     * size_medium (~{SIZE_CATEGORY_TARGETS['medium']}%): n in [21, 0.5*MAX_N] (keep thin).
     * size_large  (~{SIZE_CATEGORY_TARGETS['large']}%): n in [0.8*MAX_N, MAX_N] — REAL stress sizes, NOT small.
3. For deficient buckets, ADD cases constructed at the right n. For size_large you MUST
   generate inputs with n near MAX_N (fill with constraint-legal values; keep the
   brute-force cross-check guarded by its own size cap so large cases are validated by the
   optimal alone).
4. Re-tag each case with the correct size_<bucket> from its ACTUAL n, and keep the
   self-check assert that realized bucket counts are within tolerance of the targets.

Do not reduce the total below the current count. Return ONLY the corrected Python script.

### Problem Description (for constraint parsing):
{description}

### Current generator script:
{failed_script}
"""
    return system, user
