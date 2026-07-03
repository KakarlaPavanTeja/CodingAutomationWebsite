"""Shared test-case helpers without LLM dependencies."""

from __future__ import annotations

import re

import math

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
    """Parse primary size n from first line/token of stdin."""
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


def parse_constraint_max_n(description: str) -> int | None:
    """Best-effort parse of max n from constraints section."""
    text = description or ""
    patterns = [
        r"n\s*≤\s*10\^?(\d+)",
        r"n\s*<=\s*10\^?(\d+)",
        r"1\s*≤\s*n\s*≤\s*(\d+)",
        r"1\s*<=\s*n\s*<=\s*(\d+)",
        r"n\s*≤\s*(\d+)",
        r"n\s*<=\s*(\d+)",
        r"(\d+)\s*≤\s*n",
        r"(\d+)\s*<=\s*n",
        r"m\s*≤\s*(\d+)",
        r"1\s*≤\s*m\s*≤\s*(\d+)",
    ]
    best = None
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            val = m.group(1)
            try:
                if "10^" in pat or "10\\^" in pat:
                    num = 10 ** int(val)
                else:
                    num = int(val)
                if best is None or num > best:
                    best = num
            except ValueError:
                continue
    return best


def derive_size_bucket(n: int | None, max_n: int | None, inp: str) -> str:
    """Authoritative size bucket from parsed n vs constraint max N."""
    if n is None:
        if inp and len(inp.strip()) < 20:
            return "edge"
        return "small"
    if max_n and n >= max(1, int(0.8 * max_n)):
        return "large"
    if n <= 1 or (max_n and n == 1):
        return "edge"
    if n <= 20:
        return "small"
    if max_n and n >= int(0.5 * max_n):
        return "large"
    return "medium"


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


def sync_example_testcases(test_cases: list, description: str) -> int:
    """Force order-1 and order-2 cases to match description Examples 1 & 2."""
    if not test_cases or not description:
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


def sync_size_tags(test_cases: list, description: str) -> int:
    """Rewrite size_* tags from derived input buckets. Returns cases corrected."""
    if not test_cases:
        return 0
    max_n = parse_constraint_max_n(description)
    fixed = 0
    for tc in test_cases:
        if not isinstance(tc, dict):
            continue
        inp = tc.get("input", "") or ""
        bucket = derive_size_bucket(parse_primary_n(inp), max_n, inp)
        if bucket not in SIZE_BUCKETS:
            continue
        declared = tag_size_bucket(tc.get("tags") or [])
        if declared == bucket:
            continue
        tc["tags"] = dedupe_tags(_strip_size_tags(tc.get("tags") or []) + [size_tag(bucket)])
        fixed += 1
    return fixed


def sync_size_tags_json_root(data, description: str) -> int:
    if isinstance(data, list) and data and isinstance(data[0], dict) and "test_cases" in data[0]:
        return sync_size_tags(data[0]["test_cases"], description)
    if isinstance(data, dict) and "test_cases" in data:
        return sync_size_tags(data["test_cases"], description)
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
    max_n = parse_constraint_max_n(description)
    for tc in cases:
        inp = tc.get("input", "") or ""
        bucket = derive_size_bucket(parse_primary_n(inp), max_n, inp)
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

    max_n = parse_constraint_max_n(description)
    rank = {"edge": 0, "small": 1, "medium": 2, "large": 3}

    def _difficulty_key(tc: dict):
        inp = tc.get("input", "") or ""
        bucket = derive_size_bucket(parse_primary_n(inp), max_n, inp)
        return (rank.get(bucket, 1), testcase_payload_byte_size(tc), parse_primary_n(inp) or 0)

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
