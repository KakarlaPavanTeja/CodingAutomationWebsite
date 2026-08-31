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

# The stress band is sized in ABSOLUTE cases, never as a percentage of the suite.
# A percentage scales with the total count, so the same rule meant ~16 stress cases at
# 80 total and ~50 at 250 — and coverage does not scale with suite size: a problem has
# the adversarial shapes it has, whether you write 80 cases or 250. Measured outcome of
# the percentage rule: 35 stress cases covering 2 distinct shapes (25 of them one shape).
# There is deliberately NO ceiling on the shape count — it is a property of the problem,
# and a cap would teach the model to stop looking. Repetition is bounded by the shape
# signature (see STRICT CONSTRAINT ADHERENCE), not by a constant.
VALUE_PATTERNS_PER_SHAPE = 2   # same-values and distinct-values, where constraints allow both

# Cases whose PURPOSE is the value magnitude (overflow / sign / full-range). An absolute
# count for the same reason the stress band is: two or three catch every 32-bit and sign
# bug a suite can catch, and that does not become more true in a bigger suite. Everything
# else stays hand-checkable. Prose alone did not hold this line -- a real run put 5-digit
# values on EVERY stress case -- so magnitude is now a DECLARED, COUNTABLE per-case field.
MAX_EXTREME_MAGNITUDE_CASES = 3

# REPORTING ONLY — nothing re-prompts or gates on these numbers.
# History worth knowing before you trust or re-wire them: `large: 20.0` with a 7pp
# tolerance meant any suite under 13% large was labelled "deficient", and
# audit_size_distribution's docstring said the generator would then re-prompt for MORE
# large cases. As a percentage of a 250-case suite that is a demand for 33+ stress cases.
# B3 (the enforcer) left the pipeline, so nothing calls the audit today — but the numbers
# and that docstring still read as live, which is how the bug comes back.
# `large` is now the DERIVED expectation, not a target: it is roughly
# (distinct shapes) x VALUE_PATTERNS_PER_SHAPE cases, which lands near 6-8% of a
# mid-sized suite. If you re-wire the audit, compare the ABSOLUTE stress-case count
# against the shape plan — never a percentage of the total.
SIZE_CATEGORY_TARGETS = {
    "edge": 20.0,
    "small": 64.0,
    "medium": 8.0,
    "large": 8.0,
}
SIZE_TOLERANCE_PP = 7.0  # +/- percentage points

# What B3 actually enforces. FLOORS, not targets: the model chooses the suite's shape —
# that is the point of the redesign, and this prompt deliberately no longer states
# proportions — so the audit must not grade against a rulebook the model was never given.
# Two-sided targets failed every suite once the prompt stopped stating them (a real run
# scored edge 16% / small 76% / medium 0% / large 8% while killing 100% of injected bugs).
# What still matters is that no whole CLASS of input is missing: degenerate cases, and
# cases big enough to expose a slow solution. `medium` has no floor — the small/medium
# boundary is a bucketing artifact, not a property anyone should have to hit.
SIZE_MIN_PCT = {"edge": 5.0, "large": 5.0}
SIZE_TAG_PREFIX = "size_"
SIZE_BUCKETS = ("edge", "small", "medium", "large")


def size_tag(bucket: str) -> str:
    if bucket not in SIZE_BUCKETS:
        raise ValueError(f"size bucket must be one of {SIZE_BUCKETS}, got {bucket!r}")
    return f"{SIZE_TAG_PREFIX}{bucket}"


# A DIAGNOSTIC BAND, NOT A TARGET. Any count handed to the model becomes a quota it
# fills, and when the genuine scenarios run out it pads with more max-size draws — which
# is precisely how a suite ended up with 25 stress cases of one shape. Coverage decides
# the count; this band only says when the coverage plan looks wrong. Difficulty is
# deliberately NOT a driver: it is assigned for learner-facing reasons and does not
# predict how many distinct behaviours a problem has.
COUNT_BAND = (80, 250)

# Back-compat: testcase_manager_v4 and tests/test_testcases_prompt_metadata import this
# name. Difficulty no longer changes the band, so every key maps to the same pair — the
# shim keeps those callers working without pretending difficulty still drives the count.
COUNT_BAND_BY_DIFFICULTY = {
    "easy": COUNT_BAND,
    "medium": COUNT_BAND,
    "hard": COUNT_BAND,
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
    """The count is an OUTCOME of the coverage plan, never a quota to fill."""
    if num_testcases:
        return f"exactly {num_testcases} cases (the owner asked for this count)"
    lo, hi = COUNT_BAND
    return (
        f"whatever your coverage plan yields — do NOT aim at a number.\n"
        f"   Build SCENARIO_PLAN from the shapes this problem actually admits, then count\n"
        f"   what you have. Use {lo}-{hi} only as a DIAGNOSTIC on that plan:\n"
        f"     * under {lo} in `sampled` mode -> you have MISSED shapes. Go find them; do not\n"
        f"       pad with more draws of a shape you already covered.\n"
        f"     * over {hi} -> you are testing something twice. Merge, do not trim at random.\n"
        f"   In `exhaustive` mode the {lo} floor does NOT apply: if the entire legal input\n"
        f"   space is (say) 34 distinct inputs, 34 cases is COMPLETE, not a shortfall. This is\n"
        f"   the normal shape of a small-domain problem (backtracking/permutation problems\n"
        f"   with n <= 8-10) — the constraints decide the count, not this band."
    )


_ENUMERATE_BLOCK = """
(THIS PROBLEM ACCEPTS MORE THAN ONE CORRECT ANSWER):
There is no driver to wrap a stdin/stdout program in, so each multi-answer case must ship
EVERY valid answer instead of one.

For such a case emit, in place of `output`:
    "multiple_possible_output": true,
    "outputs": ["<answer 1>", "<answer 2>", ...]
Emit `output` OR `outputs`, never both.

  * Write an `is_valid_answer(stdin_text, candidate_stdout)` helper inside the generator
    script and use it to filter. It is a generation-time tool and is never shipped.
  * The list must be provably EXHAUSTIVE. Walk the candidate space to completion and keep
    everything the helper accepts. A truncated list marks correct answers wrong, which is
    the exact bug this exists to remove — so if you cannot enumerate a case completely, do
    NOT ship it as multi-answer: reshape its input so the answer is unique.
  * The answer shown in the problem statement's Example 1 / Example 2 MUST be in that
    case's `outputs`. Test cases 1 and 2 are synced to the worked examples, so a list that
    omits the stated answer fails the student who copied it.
  * Stress and large cases MUST have a UNIQUE answer. They carry the timing coverage, so
    shape them so only one output is valid (a chain rather than a sparse graph). Small
    cases carry the multi-answer coverage. This is what keeps enumeration bounded without
    a cap: enumeration cost is superexponential in the free choices (8 unconstrained nodes
    = 40,320 orderings, 10 = 3.6M, 12 = 479M), and you control that through the input you
    choose.
  * There is deliberately NO fixed cap on the number of stored answers. The bound is the
    input shape you pick, not a constant.
  * A case whose answer IS unique stays an ordinary `output` case. Do not wrap a single
    answer in `outputs`.
"""


def get_testcases_prompt(
    description,
    optimal_solution,
    brute_force_code=None,
    num_testcases=None,
    difficulty=None,
    is_function=False,
    signature_params=None,
    io_contract=None,
    open_ended=False,
):
    """
    Build (system_prompt, user_prompt) for v4 generation.

    brute_force_code : optional second solution used purely as a validation
        oracle. When provided, the generated script must cross-check every case
        (optimal vs brute) and abort on any mismatch. When None, the script
        falls back to self-consistency checks only and notes the weaker guarantee.

    open_ended : the problem legitimately admits more than one correct answer (decided
        at authoring time, read from Outputs/problem_flags.json). Only NON-function
        problems change here: they have no driver to run a checker in, so each
        multi-answer case must ship EVERY valid answer. Function-based problems are
        graded by the driver's checker and must NOT also enumerate.

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
  * Emit {num_hint}
  * Every case must be a DISTINCT SHAPE-AND-VALUE-PATTERN, not merely a distinct string —
    never pad with more draws of a shape you already covered.
  * You are responsible for: correct outputs, distinct shapes, explicit edge cases, real
    at-MAX_N stress cases (one pair per shape), and honest grouping (below).
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
  * `scenario` (str, snake_case): WHAT THIS CASE EXISTS TO CATCH — e.g. "answer_at_end",
    "all_equal", "max_n_sorted_distinct", "overflow_values". One token. This is the field a
    reviewer reads to answer "why does this case exist?", so it must name the case's purpose,
    never its size or its position. For stress cases it must name the SHAPE, and no scenario
    may appear more than twice across the whole suite (once per value pattern) — a third
    case sharing a scenario name is padding by definition.
  * `magnitude` (str): `"small"` or `"extreme"`. `"small"` means every value in this case is
    hand-checkable — a reviewer can read the input and see why the answer is right.
    `"extreme"` means the case's PURPOSE is the value magnitude (near INT_MAX/INT_MIN, full
    range span, sign boundary). Declare it honestly: the count of `"extreme"` cases is
    checked, and a case that quietly uses huge values while declaring `"small"` is the exact
    failure this field exists to make visible. AT MOST 3 cases in the whole suite may be
    `"extreme"`.
  * `is_edge` (bool): true for degenerate / boundary / min literals (empty, n=min, all-same, overflow
    boundary, singleton). Mark them accurately — they are reported separately.
Emit NO other keys: no per-case weight, no `tags`, no `order`. Those are derived.
"""

    # Non-function open-ended problems only. There is no driver around a stdin/stdout
    # program, so nothing of ours can run a checker at grading time — the valid answers
    # have to be worked out here and stored. Function-based problems keep the reference's
    # single answer; their driver's `is_valid_answer` does the accepting.
    enumerate_block = _ENUMERATE_BLOCK if (open_ended and not is_function) else ""

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

(THE STRESS BAND IS A LIST OF SHAPES, NOT A COUNT — READ THIS TWICE):
The stress band is built by ENUMERATING the distinct adversarial SHAPES this problem
admits at/near MAX_N, then emitting cases for each. It is never sized as a fraction of
the suite.
  * A SHAPE is the STRUCTURE of the input: ordering (sorted / reverse / unsorted /
    rotated), repetition structure, and topology (path / star / balanced / dense /
    disconnected — whatever this problem's structure axis is). Two inputs that differ
    only by random seed are the SAME shape and the second one tests NOTHING new.
  * Enumerate EVERY shape the problem admits. There is NO maximum. If this problem has
    eleven meaningfully different worst-case structures, emit eleven shapes — a shape
    count is a property of the PROBLEM, not a budget you spend.
  * For EACH shape, emit TWO cases that differ on the VALUE axis, because they break
    different code:
      - repeated values (all-equal, or heavy duplicates) — breaks dedup logic, `<` vs
        `<=`, tie-breaking, counting with multiplicity, set-vs-list confusion.
      - distinct values (no repeats) — breaks ordering assumptions, comparator logic,
        off-by-one in sorted scans.
    Where the constraints forbid one of the two (e.g. the statement guarantees all values
    distinct, or the shape IS a strict permutation), emit only the legal one and add a
    one-line comment saying which pattern was skipped and why. NEVER manufacture an
    out-of-constraint input to satisfy this rule.
  * Both cases in a pair stay SMALL-VALUED (see VALUE MAGNITUDE). The pair differs in HOW
    MANY values repeat, never in how big they are.
  * A third case for a shape you have already covered with both value patterns is padding.
    Do not emit it. Spend the case on a shape you have not covered.

(VALUE MAGNITUDE IS A BUDGET OF 3 CASES, NOT A STYLE PREFERENCE — READ THIS TWICE):
Every case declares `magnitude` ("small" | "extreme"). The rule is a COUNT, exactly like the
stress band's:
  * AT MOST 3 cases in the WHOLE suite may declare `"extreme"`, and each one's `scenario`
    must name the magnitude itself (`overflow_values`, `min_value_boundary`,
    `full_range_span`, `sign_boundary`). Three is enough: overflow, sign, and full-range.
  * EVERY OTHER CASE — including every stress case at MAX_N — declares `"small"` and uses
    the SMALLEST values its scenario actually needs. If the scenario is "the answer is at
    the last position", the values are 1..9 and the position is what varies. Do not reach
    for the constraint's upper bound because it is available.
  * Size and magnitude are INDEPENDENT. An n=MAX_N case built from two-digit values stresses
    time exactly as hard as one built from nine-digit values, because time depends on how
    many operations run, not on how wide the operands print.
  * SELF-CHECK BEFORE YOU EMIT: count your `"extreme"` cases. More than 3 means you sprayed
    magnitude across the suite instead of testing it — set the rest to small values and
    regenerate those inputs.
  * The ONE exception: when `size_model.kind == "value"` the magnitude IS the size axis, so
    the stress band legitimately scales it. Those cases still declare `"small"` unless their
    purpose is an overflow boundary — scaling the size axis is not the same as testing
    magnitude.

(WHY THIS MATTERS MORE THAN IT LOOKS):
  * A wall of random 9-digit numbers makes every failure undebuggable and catches nothing
    the small values miss. A shipped suite had every max-n case built from 9-digit values:
    ~30 characters per line where 1-3 digits needs ~9 — 3x the bytes for IDENTICAL
    discrimination. An n=100000 case of `320 232 536` triples gates a slow solution exactly
    as hard as one of `3200000 232275654 536201494` triples, and a reviewer can read it.
  * Once a case is loaded to the platform it can only be REWRITTEN, never removed. Oversized
    inputs are permanent. This is the one cost in the suite you cannot undo later.

(VALUE MAGNITUDE — the reasoning behind the budget above):
The constraints bound how BIG a value may be; they do not ask you to use that bound. Size
and magnitude are independent — an n=MAX_N case built from two-digit values stresses time
exactly as hard as one built from nine-digit values.
  * DEFAULT to small, hand-checkable values (roughly 1-3 digits, or a compact window around
    0) for the MAJORITY of cases, INCLUDING most stress cases. A reviewer must be able to
    read a case and see why the answer is right; a wall of random 9-digit numbers makes
    every failure undebuggable and catches nothing the small values miss.
  * Reserve near-min / near-max magnitudes for a FEW dedicated cases whose named `scenario`
    IS the magnitude (`overflow_values`, `min_value_boundary`, `full_range_span`). Two or
    three of them catch every 32-bit / sign / overflow bug the suite can catch.
  * A suite where every non-example case uses extreme values is a BUG, not thoroughness: it
    re-tests one narrow failure mode dozens of times and tests the ordinary range zero
    times. It also makes the public examples look like a different problem.
  * THIS APPLIES HARDEST TO THE STRESS BAND, which is where the rule is usually broken. A
    shipped suite had every max-n case built from 9-digit values: ~30 characters per line
    where 1-3 digits needs ~9. That is 3x the bytes for IDENTICAL time-complexity
    discrimination, and once a case is loaded to the platform it can only be rewritten,
    never removed. An n=100000 case of `320 232 536` triples gates a slow solution exactly
    as hard as one of `3200000 232275654 536201494` triples — and a reviewer can read it.
  * Magnitude extremes are their OWN named shape (`overflow_values`, `min_value_boundary`,
    `full_range_span`) — two or three cases for the WHOLE suite. Never an attribute
    sprayed across every stress case.
  * Vary magnitude ACROSS cases deliberately: tiny, mixed sign, a modest range, and only
    then the extremes. Same rule for every value-like axis — coordinates, weights, IDs,
    node values, the alphabet of generated strings.

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
     * `overflow_values` — values near INT_MAX/INT_MIN to break 32-bit assumptions. A FEW
       cases only — see VALUE MAGNITUDE; the rest of the suite stays small-valued.
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
  * Dedup on the SHAPE SIGNATURE, not the input string. Keep a `seen_signatures` set that
    gates EVERY emitted case — it is authoritative — where the signature is the tuple:
        (size_bucket, n_bucket, orderedness, repetition_pattern, value_magnitude_bucket,
         structural_class)
    An exact-input set (`seen_inputs`) is NOT sufficient and is the reason this rule kept
    being satisfied while the suite filled with near-identical cases: 25 different random
    arrays at n=200000 are 25 distinct STRINGS and ONE shape. Compute the signature from
    the input you just built and SKIP the case if that signature is already present.
    At most ONE case per full signature. (The "two per shape" rule above is satisfied
    because the two value patterns produce two DIFFERENT signatures.)
    Keep a `seen_inputs` set as well, to catch byte-identical collisions cheaply.
    Do NOT add an `allow_duplicate`/force flag or any other bypass of either set, and do
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
{declared_metadata_block}{enumerate_block}
{size_model_block}
(OUTPUT JSON SHAPE):
Root: a LIST containing EXACTLY ONE dict with keys `"test_cases"`, `"size_model"`, `"space_mode"`.
  CORRECT:   [ {{"test_cases": [...], "size_model": {{"kind": "count", "max_n": 100000}}, "space_mode": "sampled"}} ]
  INCORRECT: {{"test_cases": [...]}}   (dict at root is invalid; missing size_model/space_mode)
Each case dict carries EXACTLY: `input`, `output`, `subtask`, `scenario`, `magnitude`, `is_edge`, `size_metric`.
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
   (every case dict must include size_metric/scenario/magnitude/is_edge; SIZE_KIND/SPACE_MODE are the declared problem size model)

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
  6. NO REPEATED SHAPES. Every stress case is a distinct (shape, value-pattern) pair. If two
     cases differ only by random seed, or share a `scenario` name more than twice, DELETE one
     and spend the case on an uncovered shape.
  7. MAGNITUDE BUDGET. Count the cases declaring `magnitude": "extreme"`. If it is more than
     3, you have sprayed magnitude across the suite: pick the 3 whose purpose IS the
     magnitude, and rebuild every other case's values as small and hand-checkable. Every
     stress case at MAX_N declares `"small"` unless magnitude is its stated purpose.

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
