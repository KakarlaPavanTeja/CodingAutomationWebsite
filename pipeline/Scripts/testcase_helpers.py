"""Shared test-case helpers without LLM dependencies."""

from __future__ import annotations

import re

import math

from testcase_selection import bucket_case, bucket_size

from Prompts.testcasesprompt_v4 import (
    MAX_CASES_PER_SUBTASK,
    MAX_SUBTASKS,
    MIN_SUBTASKS,
    SIZE_BUCKETS,
    SIZE_CATEGORY_TARGETS,
    SIZE_TOLERANCE_PP,
    SUBTASK_TAG_PREFIX,
    size_tag,
    subtask_tag,
    tier_from_tags,
    verified_contract_pairs,
)

SIZE_TAG_PREFIX = "size_"

# Order matters: first match wins. Keep sliding_window narrow — "subarray" /
# "contiguous" alone also describe Kadane / prefix-sum array problems.
_TYPE_KEYWORDS = [
    ("tree", ("tree", "binary tree", "bst", "root", "leaf", "subtree")),
    ("graph", ("graph", "edge", "vertex", "vertices", "adjacency", "dijkstra", "node and")),
    ("sliding_window", (
        "sliding window",
        "window of size",
        "window of length",
        "window size",
        "fixed window",
        "window k",
        "size k window",
        "substring of length",
    )),
    ("dp", ("dynamic programming", "subsequence", "minimum cost", "maximum sum",
            "number of ways", "longest increasing", "longest common", "partition")),
    ("string", ("string", "substring", "character", "palindrome", "anagram")),
    ("math", ("modulo", "prime", "gcd", "factorial", "combinatorial", "number theory")),
    ("greedy", ("greedy", "interval", "schedule", "activity selection")),
    ("array", ("array", "list of integers", "nums", "subarray", "contiguous")),
]


def detect_problem_type(description: str) -> str:
    text = (description or "").lower()
    for type_name, kws in _TYPE_KEYWORDS:
        if any(kw in text for kw in kws):
            return type_name
    return "generic"


def parse_primary_n(inp: str) -> int | None:
    """Parse primary size n from the first line/token of stdin.

    Only meaningful when that token really is a count. Prefer `case_size_metric`
    / `measure_input_size`, which fall back to this but also recognise inputs
    whose first token is DATA (a binary string, an id) rather than a size.
    """
    if not inp or not inp.strip():
        return None
    first_line = inp.strip().split("\n", 1)[0].strip()
    parts = first_line.split()
    if not parts:
        return None
    try:
        return int(parts[0])
    except ValueError:
        return None


def _bound_value(expr: str) -> int | None:
    """Evaluate a constraint bound: "200000", "10^5", "2 × 10^5", "2*10^5"."""
    text = re.sub(r"\s+", "", expr or "")
    if not text:
        return None
    total = 1
    for factor in re.split(r"[×x*·]", text, flags=re.IGNORECASE):
        base, _, power = factor.partition("^")
        try:
            total *= int(base) ** int(power) if power else int(base)
        except (TypeError, ValueError, OverflowError):
            return None
    return total


# A bound written any of the usual ways: "200000", "10^5", "2 × 10^5", "2*10^5".
_BOUND_EXPR = r"(\d+(?:\s*\^\s*\d+)?(?:\s*[×x*·]\s*\d+(?:\s*\^\s*\d+)?)*)"

# A bound stated against a SIZE noun, whatever the variable is called:
# "1 ≤ n ≤ 2 × 10^5", "length of logData ≤ 2 × 10^5", "|s| <= 10^5",
# "number of rows ≤ 1000". Noun-based rather than name-based, so a problem does
# not have to call its size "n" to be measured correctly.
_SIZE_NOUN_BOUND = re.compile(
    r"(?:\|\s*\w+\s*\|"
    r"|\b(?:n|m|k|q|len|length|size|count|rows?|cols?|columns?)\b)"
    r"[^\n≤<]{0,40}?(?:≤|<=)\s*" + _BOUND_EXPR,
    re.IGNORECASE,
)


def parse_constraint_max_n(description: str) -> int | None:
    """Best-effort parse of MAX_N from the constraints section.

    Fallback only — a generator-declared `size_model.max_n` always wins (see
    `resolve_size_context`). Returns None when the text states no size bound;
    callers must then derive the bound from the suite rather than assume one.
    """
    text = description or ""
    best = None
    for m in _SIZE_NOUN_BOUND.finditer(text):
        num = _bound_value(m.group(1))
        if num is not None and (best is None or num > best):
            best = num
    return best


def measure_input_size(inp: str, kind: str | None = None, max_n: int | None = None) -> int | None:
    """Size of a raw input on the problem's own metric.

    Used only when the generator declared no `size_metric` for the case. The
    first token counts as a size only when it CAN be one: no leading zeros,
    within MAX_N, and followed by actual data. Otherwise it is data — the binary
    string `0100101` parses to 100101, which says nothing about its size — and
    the input's own character length is the size.
    """
    text = (inp or "").strip()
    if not text:
        return None
    lines = text.split("\n")
    first_parts = lines[0].split()
    first_tok = first_parts[0] if first_parts else ""
    as_int = int(first_tok) if first_tok.lstrip("-").isdigit() else None

    # kind == "value": the number itself IS the size (f(n)-style problems).
    if kind == "value" and as_int is not None:
        return abs(as_int)

    if as_int is not None:
        digits = first_tok.lstrip("-")
        has_leading_zero = len(digits) > 1 and digits.startswith("0")
        within_bound = max_n is None or abs(as_int) <= max_n
        has_payload = len(lines) > 1 or len(first_parts) > 1
        if has_payload and not has_leading_zero and within_bound:
            return abs(as_int)

    # Data, not a count: measure the widest data line.
    return max(len(line.strip()) for line in lines)


def case_size_metric(tc: dict, kind: str | None = None, max_n: int | None = None) -> int | None:
    """This case's size on the problem's own metric.

    The generator's declared `size_metric` is authoritative; measuring the raw
    input is the fallback for legacy suites that carry none.
    """
    if not isinstance(tc, dict):
        return None
    declared = tc.get("size_metric")
    if isinstance(declared, int) and not isinstance(declared, bool) and declared >= 0:
        return declared
    if isinstance(declared, str) and declared.strip().isdigit():
        return int(declared.strip())
    return measure_input_size(tc.get("input", "") or "", kind, max_n)


def resolve_size_context(
    root=None, description: str = "", test_cases: list | None = None
) -> tuple[str | None, int | None]:
    """(size_kind, max_n) for THIS problem — never a hardcoded default.

    Precedence: the generator's declared `size_model` (kind + max_n) → the
    description's constraint bound → the largest size the suite actually
    contains. The last fallback keeps buckets meaningful for legacy suites
    without inventing a bound the problem never stated.
    """
    declared = root.get("size_model") if isinstance(root, dict) else None
    kind = None
    max_n = None
    if isinstance(declared, dict):
        if isinstance(declared.get("kind"), str):
            kind = declared["kind"]
        raw_max = declared.get("max_n")
        if isinstance(raw_max, int) and not isinstance(raw_max, bool) and raw_max > 0:
            max_n = raw_max
    if max_n is None:
        max_n = parse_constraint_max_n(description)
    if max_n is None and test_cases:
        observed = [
            m for m in (
                case_size_metric(tc, kind) for tc in test_cases if isinstance(tc, dict)
            ) if isinstance(m, int)
        ]
        if observed:
            max_n = max(observed)
    return kind, (max_n if isinstance(max_n, int) and max_n > 0 else None)


def bucket_for_case(tc: dict, max_n: int | None, kind: str | None = None) -> str | None:
    """Size bucket for one case, scaled to this problem's MAX_N.

    Delegates to `testcase_selection.bucket_case` — the same rule the selector and
    the B3 gate use — so a case's tag, its selection bucket and its audited bucket
    can never disagree. Returns None when the problem has no size dimension
    (`kind == "none"`) or no size could be established; callers then leave the
    case's tags alone rather than guessing.
    """
    if kind == "none":
        return None
    n = case_size_metric(tc, kind, max_n)
    if n is None or max_n is None:
        return None
    is_edge = bool(tc.get("is_edge")) if isinstance(tc, dict) else False
    return bucket_case({"size_metric": n, "is_edge": is_edge}, max_n)


def derive_size_bucket(n: int | None, max_n: int | None, inp: str) -> str:
    """Size bucket for a size `n` against this problem's MAX_N.

    Thin wrapper over the single bucket rule (`testcase_selection.bucket_size`),
    whose boundaries are fractions of MAX_N — so the same n lands in different
    buckets for a MAX_N=100 problem and a MAX_N=2*10^5 one, as it should.
    """
    if n is None:
        n = measure_input_size(inp, None, max_n)
    if n is None:
        return "edge" if not (inp or "").strip() else "small"
    if max_n is None:
        return "edge" if n <= 1 else "small"
    return bucket_size(n, max_n)


def size_tag_from_bucket(bucket: str) -> str:
    return size_tag(bucket)


def tag_size_bucket(tags: list) -> str | None:
    for t in tags or []:
        name = t if isinstance(t, str) else str(t.get("name_enum", ""))
        if name.startswith(SIZE_TAG_PREFIX):
            return name[len(SIZE_TAG_PREFIX):]
    return None



def dedupe_tags(tags: list) -> list:
    """Drop duplicate tag entries (by name_enum or string value), preserving order."""
    seen: set[str] = set()
    out: list = []
    for t in tags or []:
        if isinstance(t, dict):
            name = str(t.get("name_enum", "")).strip()
            if not name or name in seen:
                continue
            seen.add(name)
            out.append(t)
        else:
            key = str(t).strip()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


def sync_example_testcases(test_cases: list, description: str, io_contract=None) -> int:
    """Force order-1 and order-2 cases to match description Examples 1 & 2.

    A verified `io_contract` wins over the description text: its pairs were produced by
    running the reference solution, so they are raw stdin even when the description shows
    the named-variable display form (`N = 2763`) that `extract_example_io` cannot use."""
    if not test_cases:
        return 0
    pairs = verified_contract_pairs(io_contract)
    if not pairs:
        if not description:
            return 0
        try:
            from benchmark_suite import extract_example_io
        except ImportError:
            return 0
        pairs = extract_example_io(description)
    if not pairs:
        return 0
    cases = [tc for tc in test_cases if isinstance(tc, dict)]
    if not cases:
        return 0
    by_order = sorted(
        cases,
        key=lambda tc: tc.get("order") if isinstance(tc.get("order"), int) else 10**9,
    )
    changed = 0
    for i, (inp, out) in enumerate(pairs[:2]):
        if i >= len(by_order):
            break
        tc = by_order[i]
        want_inp = inp if inp.endswith("\n") else inp + "\n"
        want_out = out.rstrip("\n") if isinstance(out, str) else str(out)
        cur_inp = tc.get("input", "") or ""
        cur_out = tc.get("output", "") or ""
        if cur_inp != want_inp or cur_out != want_out:
            tc["input"] = want_inp
            tc["output"] = want_out
            changed += 1
        tags = dedupe_tags(list(tc.get("tags") or []))
        if "example" not in tags:
            tags = tags + ["example"]
            tc["tags"] = tags
            changed += 1
        else:
            tc["tags"] = tags
    return changed


def _strip_size_tags(tags: list) -> list:
    kept: list = []
    for t in tags or []:
        if isinstance(t, str) and t.startswith(SIZE_TAG_PREFIX):
            continue
        if isinstance(t, dict) and str(t.get("name_enum", "")).startswith(SIZE_TAG_PREFIX):
            continue
        kept.append(t)
    return kept


def sync_size_tags(test_cases: list, description: str, root=None) -> int:
    """Rewrite size_* tags from each case's size against THIS problem's MAX_N.

    Sizes come from the generator's declared `size_metric`/`size_model` when
    present (see `resolve_size_context`), so the tags describe the problem's own
    size dimension instead of whatever the first input token happens to look
    like. Returns the number of cases corrected.
    """
    if not test_cases:
        return 0
    kind, max_n = resolve_size_context(root, description, test_cases)
    fixed = 0
    for tc in test_cases:
        if not isinstance(tc, dict):
            continue
        bucket = bucket_for_case(tc, max_n, kind)
        if bucket not in SIZE_BUCKETS:
            continue
        declared = tag_size_bucket(tc.get("tags") or [])
        if declared == bucket:
            continue
        tc["tags"] = dedupe_tags(_strip_size_tags(tc.get("tags") or []) + [size_tag(bucket)])
        fixed += 1
    return fixed


_REQUIRED_CASE_KEYS = ("input", "output", "weightage", "tags", "order",
                       "size_metric", "scenario", "is_edge")


def normalize_input_for_dedup(raw: str) -> str:
    """The same normalization `testcase_selection.dedup_by_input` uses, so a suite
    deduped here is already deduped there — one notion of "same input", not two."""
    from testcase_selection import normalize_input
    return normalize_input(raw)


def repair_suite(test_cases: list) -> dict:
    """Mechanically fix what the generator gets wrong and we can compute ourselves.

    Every repair here already existed LATE in the pipeline: `prepare_platform_json`
    fills missing keys and `_scale_weights_to_total` fixes the weight sum, and
    `select_suite` dedups. The problem was ORDERING — the generated script `assert`ed
    these same invariants and died at GENERATION time, so our fixers never saw the data
    and we paid an LLM repair round trip for a defect we already knew how to fix.
    Repairing here is what lets the prompt stop asking the model to be right about them.

    Mutates `test_cases` in place. Returns a report of what was repaired so the caller
    can log which contract rules the model actually broke.
    """
    report = {"duplicate_inputs": 0, "missing_keys": {}, "nonpositive_weights": 0,
              "reordered": 0, "dropped_unusable": 0}
    if not test_cases:
        return report

    seen: set[str] = set()
    kept: list = []
    for tc in test_cases:
        if not isinstance(tc, dict) or not str(tc.get("input") or "").strip():
            report["dropped_unusable"] += 1      # no input = not a runnable case
            continue
        key = normalize_input_for_dedup(tc.get("input", ""))
        if key in seen:
            report["duplicate_inputs"] += 1
            continue
        seen.add(key)
        kept.append(tc)

    defaults = {"output": "", "weightage": 1.0, "tags": [], "scenario": "default",
                "is_edge": False}
    for idx, tc in enumerate(kept, start=1):
        for k in _REQUIRED_CASE_KEYS:
            if tc.get(k) is not None:
                continue
            report["missing_keys"][k] = report["missing_keys"].get(k, 0) + 1
            if k == "order":
                tc[k] = idx
            elif k == "size_metric":
                tc[k] = measure_input_size(tc.get("input", "")) or 0
            else:
                tc[k] = defaults.get(k, "")
        try:
            if float(tc["weightage"]) <= 0:
                raise ValueError
        except (TypeError, ValueError):
            tc["weightage"] = 1.0                # every case must score something
            report["nonpositive_weights"] += 1
        if tc.get("order") != idx:
            tc["order"] = idx
            report["reordered"] += 1

    test_cases[:] = kept
    return report


# A whole line that is a bracketed literal holding digits or quotes: `[8]`, `["NO"]`,
# `[1, 2, 3]`. Bare `[]` is not flagged — an empty collection is a legitimate input.
_LITERAL_LINE = re.compile(r"^\s*[\[\(]\s*[\d\"'].*[\]\)]\s*$")
# Quoted tokens inside data: `["NO","YES"]`, `'a', 'b'`.
_QUOTED_TOKENS = re.compile(r"[\"'][A-Za-z0-9_]+[\"']\s*[,\]]")
# A human-readable assignment the description shows for display: `N = 2763`.
_ASSIGNMENT_LINE = re.compile(r"^\s*[A-Za-z_]\w*\s*=\s*\S")
# Forms the description may legitimately use, in which case none of the above is a bug.
_BRACKETS_SANCTIONED = re.compile(
    r"level[- ]order|linked[- ]?list|\btree\b|\bnull\b", re.IGNORECASE)


def _description_sanctions_literals(description: str) -> bool:
    """True when the description's own format legitimately uses bracketed input.

    Tree and linked-list problems are fed a bracketed level-order line by convention
    (the generation prompt says so), so brackets there are correct, not a defect.
    """
    text = description or ""
    if _BRACKETS_SANCTIONED.search(text):
        return True
    # The statement literally shows a bracketed list in its format/examples.
    return any(_LITERAL_LINE.match(ln) for ln in text.splitlines())


def audit_io_shape(test_cases: list, description: str, limit: int = 5) -> dict:
    """Flag cases whose `input`/`output` is a Python/JSON literal, not raw stdin.

    The defect this catches, from a real 2026-07-29 run ("T primes"): the suite stored
    `input: "1\\n[8]\\n"` and `output: '["NO"]'` where the driver reads
    `sys.stdin.buffer.read().split()` and prints one token per line. All three languages
    scored 0/150. It survived grounding because the reference solution of the moment
    parsed the literal form too — so grounding alone cannot catch this class, and a
    shape check on the text itself is the only thing that can.

    Returns {"inputs": n, "outputs": n, "samples": [...]}; empty dict when clean.
    """
    if not test_cases or _description_sanctions_literals(description):
        return {}

    def offends(text: str) -> bool:
        for line in str(text or "").splitlines():
            if _LITERAL_LINE.match(line) or _QUOTED_TOKENS.search(line):
                return True
            if _ASSIGNMENT_LINE.match(line):
                return True
        return False

    bad_in, bad_out, samples = 0, 0, []
    for tc in test_cases:
        if not isinstance(tc, dict):
            continue
        hit_in, hit_out = offends(tc.get("input")), offends(tc.get("output"))
        if hit_in:
            bad_in += 1
        if hit_out:
            bad_out += 1
        if (hit_in or hit_out) and len(samples) < limit:
            samples.append({
                "order": tc.get("order"),
                "input": str(tc.get("input", ""))[:60],
                "output": str(tc.get("output", ""))[:40],
            })
    if not (bad_in or bad_out):
        return {}
    return {"inputs": bad_in, "outputs": bad_out, "total": len(test_cases),
            "samples": samples}


def format_io_shape(report: dict) -> str:
    """Multi-line human report for the generate_testcases log. Empty when clean."""
    if not report:
        return ""
    head = (f"I/O SHAPE: {report['inputs']} input(s) and {report['outputs']} output(s) of "
            f"{report['total']} look like Python/JSON literals rather than raw "
            f"stdin/stdout. The platform driver will fail on these.")
    lines = [head]
    for s in report["samples"]:
        lines.append(f"    order {s['order']}: input={s['input']!r} output={s['output']!r}")
    return "\n".join(lines)


def repair_suite_json_root(data) -> dict:
    if isinstance(data, list) and data and isinstance(data[0], dict) and "test_cases" in data[0]:
        return repair_suite(data[0]["test_cases"])
    if isinstance(data, dict) and "test_cases" in data:
        return repair_suite(data["test_cases"])
    return {}


def format_compliance(report: dict) -> str:
    """One line naming which contract rules the model broke; empty when it was clean.

    Purpose: decide on EVIDENCE which prompt rules earn their tokens. A rule that never
    shows up here across twenty questions can be deleted from the prompt.
    """
    if not report:
        return ""
    parts = []
    if report.get("duplicate_inputs"):
        parts.append(f"{report['duplicate_inputs']} duplicate input(s)")
    if report.get("dropped_unusable"):
        parts.append(f"{report['dropped_unusable']} case(s) with no input")
    for key, n in sorted((report.get("missing_keys") or {}).items()):
        parts.append(f"{n} missing `{key}`")
    if report.get("nonpositive_weights"):
        parts.append(f"{report['nonpositive_weights']} non-positive weight(s)")
    if report.get("reordered"):
        parts.append(f"{report['reordered']} order(s) renumbered")
    return "; ".join(parts)


def sync_size_tags_json_root(data, description: str) -> int:
    """Same as `sync_size_tags`, passing the root through so a declared
    `size_model` (kind + max_n) is honoured over parsing the description."""
    if isinstance(data, list) and data and isinstance(data[0], dict) and "test_cases" in data[0]:
        return sync_size_tags(data[0]["test_cases"], description, data[0])
    if isinstance(data, dict) and "test_cases" in data:
        return sync_size_tags(data["test_cases"], description, data)
    return 0


def audit_size_distribution(test_cases: list, description: str, tolerance_pp: float | None = None) -> dict:
    """Audit the realized size-bucket distribution against SIZE_CATEGORY_TARGETS.

    Buckets are DERIVED from each input (same logic the B3 coverage-shape gate uses),
    not read from declared tags, so this matches what the benchmark will compute after
    sync_size_tags. The generator uses the returned report to decide whether to
    re-prompt the LLM for a size-diverse regeneration:

      ok        — every bucket within +/- tolerance of its target.
      deficient — buckets BELOW target by more than tolerance (need MORE such cases;
                  typically size_large/size_medium when the script never scaled n up).
      excessive — buckets ABOVE target by more than tolerance.

    Returns realized %, raw counts, targets, and the deficient/excessive lists.
    """
    cases = [tc for tc in (test_cases or []) if isinstance(tc, dict)]
    tol = SIZE_TOLERANCE_PP if tolerance_pp is None else tolerance_pp
    total = len(cases)
    counts = {b: 0 for b in SIZE_BUCKETS}
    if total == 0:
        return {
            "ok": True,
            "total": 0,
            "counts": counts,
            "realized": {b: 0.0 for b in SIZE_BUCKETS},
            "targets": dict(SIZE_CATEGORY_TARGETS),
            "tolerance_pp": tol,
            "deficient": [],
            "excessive": [],
        }
    kind, max_n = resolve_size_context(None, description, cases)
    for tc in cases:
        bucket = bucket_for_case(tc, max_n, kind)
        if bucket in counts:
            counts[bucket] += 1
    realized = {b: 100.0 * counts[b] / total for b in SIZE_BUCKETS}
    deficient, excessive = [], []
    for b in SIZE_BUCKETS:
        target = SIZE_CATEGORY_TARGETS.get(b, 0.0)
        delta = realized[b] - target
        if delta < -tol:
            deficient.append({
                "bucket": b,
                "realized": round(realized[b], 1),
                "target": target,
                "shortfall_pp": round(-delta, 1),
            })
        elif delta > tol:
            excessive.append({
                "bucket": b,
                "realized": round(realized[b], 1),
                "target": target,
                "excess_pp": round(delta, 1),
            })
    return {
        "ok": not deficient and not excessive,
        "total": total,
        "counts": counts,
        "realized": {b: round(realized[b], 1) for b in SIZE_BUCKETS},
        "targets": dict(SIZE_CATEGORY_TARGETS),
        "tolerance_pp": tol,
        "deficient": deficient,
        "excessive": excessive,
    }


def testcase_payload_byte_size(tc: dict) -> int:
    inp = tc.get("input", "") or ""
    out = tc.get("output", "") or ""
    if not isinstance(inp, str):
        inp = str(inp)
    if not isinstance(out, str):
        out = str(out)
    return len(inp.encode("utf-8")) + len(out.encode("utf-8"))


def tier_from_testcase(tc: dict) -> int | None:
    if not isinstance(tc, dict):
        return None
    try:
        return tier_from_tags(tc.get("tags") or [])
    except ValueError:
        return None


def has_subtask_tags(test_cases: list) -> bool:
    return any(
        tier_from_testcase(tc) is not None
        for tc in test_cases
        if isinstance(tc, dict)
    )


def _strip_subtask_tags(tags: list) -> list:
    kept: list = []
    for t in tags or []:
        if isinstance(t, str) and t.startswith(SUBTASK_TAG_PREFIX):
            continue
        if isinstance(t, dict) and str(t.get("name_enum", "")).startswith(SUBTASK_TAG_PREFIX):
            continue
        kept.append(t)
    return kept


def _valid_subtask_partition(test_cases: list) -> bool:
    """True when every case carries exactly one subtask tag, the distinct subtask
    count is within [MIN_SUBTASKS, MAX_SUBTASKS], and no tier exceeds the cap that
    audit_coverage_shape (B3) enforces."""
    cases = [tc for tc in test_cases if isinstance(tc, dict)]
    if not cases:
        return True
    counts: dict[int, int] = {}
    for tc in cases:
        tier = tier_from_testcase(tc)
        if tier is None:
            return False
        counts[tier] = counts.get(tier, 0) + 1
    k = len(counts)
    if not (MIN_SUBTASKS <= k <= MAX_SUBTASKS):
        return False
    cap = max(MAX_CASES_PER_SUBTASK, math.ceil(len(cases) / max(k, 1)))
    return all(c <= cap for c in counts.values())


def sync_subtask_tags(test_cases: list, description: str) -> int:
    """Partition the suite into MIN..MAX_SUBTASKS difficulty-ordered subtasks.

    Strengthen (harden) only ever added mutant / wrong-solution killer cases — it
    never repaired coverage SHAPE. A suite generated without subtask_<n> tags
    therefore fails B3 ("subtask count 0 outside [3, 6]") on every run, and no
    amount of re-running Strengthen could fix it. This assigns each case a
    subtask tier ordered by size bucket then payload size, so the partition is
    meaningful (tier 1 = smallest cases, tier k = largest). Returns the number of
    cases whose tags changed (0 when the partition was already valid)."""
    cases = [tc for tc in test_cases if isinstance(tc, dict)]
    n = len(cases)
    if n == 0 or _valid_subtask_partition(cases):
        return 0

    # At least MIN subtasks; enough that no tier exceeds the per-subtask cap;
    # never more than MAX or the number of cases.
    k = max(MIN_SUBTASKS, math.ceil(n / MAX_CASES_PER_SUBTASK))
    k = min(k, MAX_SUBTASKS, n)

    kind, max_n = resolve_size_context(None, description, cases)
    rank = {"edge": 0, "small": 1, "medium": 2, "large": 3}

    def _difficulty_key(tc: dict):
        bucket = bucket_for_case(tc, max_n, kind)
        size = case_size_metric(tc, kind, max_n) or 0
        return (rank.get(bucket, 1), testcase_payload_byte_size(tc), size)

    ordered = sorted(cases, key=_difficulty_key)

    changed = 0
    base, rem = divmod(n, k)
    idx = 0
    for tier in range(1, k + 1):
        group_size = base + (1 if tier <= rem else 0)
        for _ in range(group_size):
            tc = ordered[idx]
            idx += 1
            new_tags = dedupe_tags(_strip_subtask_tags(tc.get("tags") or []) + [subtask_tag(tier)])
            if tc.get("tags") != new_tags:
                tc["tags"] = new_tags
                changed += 1
    return changed


def reorder_testcases_by_subtask(test_cases: list) -> tuple[list, bool]:
    if not test_cases or not has_subtask_tags(test_cases):
        return test_cases, False
    buckets: dict[int, list] = {}
    for tc in test_cases:
        tier = tier_from_testcase(tc)
        if tier is None:
            continue
        buckets.setdefault(tier, []).append(tc)
    ordered: list = []
    for tier in range(1, MAX_SUBTASKS + 1):
        group = buckets.get(tier)
        if not group:
            continue
        if tier >= 3:
            group = sorted(group, key=testcase_payload_byte_size)
        ordered.extend(group)
    for idx, tc in enumerate(ordered, start=1):
        tc["order"] = idx
    test_cases[:] = ordered
    return test_cases, True


def reorder_testcases_by_payload_size(test_cases: list) -> tuple[list, bool]:
    if not test_cases:
        return test_cases, False
    ordered = sorted(test_cases, key=testcase_payload_byte_size)
    for idx, tc in enumerate(ordered, start=1):
        tc["order"] = idx
    test_cases[:] = ordered
    return test_cases, True


def reorder_testcases_json_root(data) -> bool:
    def _reorder_list(test_cases: list) -> bool:
        if has_subtask_tags(test_cases):
            _, ok = reorder_testcases_by_subtask(test_cases)
            return ok
        _, ok = reorder_testcases_by_payload_size(test_cases)
        return ok

    if isinstance(data, list) and data and isinstance(data[0], dict):
        if "test_cases" in data[0]:
            return _reorder_list(data[0]["test_cases"])
    if isinstance(data, dict) and "test_cases" in data:
        return _reorder_list(data["test_cases"])
    return False
