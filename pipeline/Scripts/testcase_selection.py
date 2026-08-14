"""Deterministic, LLM-free size bucketing and input dedup.

Pure functions only — no subprocess, network, clock, or randomness.

This module used to also SELECT: it trimmed an over-generated pool down to a
target count. The suite now ships exactly as generated, so the selection passes
(`select_suite`, `guarantee_pass`, `_fill_pass`, `fill_target`, `format_funnel`
and the cap/floor/target constants) are gone. What survives is what the rest of
the pipeline still needs: the single bucket rule and the dedup rule, both used by
`testcase_helpers` and by the derive step in `testcase_manager_v4`.
"""

import hashlib

# Bucket thresholds as proportions of MAX_N. edge is degenerate (<=1);
# small up to SMALL_FRAC; large from LARGE_FRAC; medium is the gap.
SMALL_FRAC = 0.2
LARGE_FRAC = 0.5


def bucket_size(size_metric: int, max_n: int) -> str:
    """Bucket a case by its model-declared size_metric against MAX_N.

    Size-only view. Prefer `bucket_case`, which also honours a case's `is_edge`
    flag — the edge bucket is about degeneracy, which size alone cannot express.
    """
    n = max(0, int(size_metric))
    m = max(1, int(max_n))
    if n <= 1:
        return "edge"
    if n >= LARGE_FRAC * m:
        return "large"
    if n <= SMALL_FRAC * m:
        return "small"
    return "medium"


def bucket_case(case, max_n, size_kind=None) -> str:
    """THE bucket rule for one case — size fractions plus declared degeneracy.

    `edge` counts degenerate/boundary cases (n = min, empty, all-same, singleton,
    overflow boundary) — what the generator's `is_edge` flag marks, and what the
    edge distribution target was written for. Defining edge as n <= 1 alone makes
    that target unreachable whenever a problem has almost no distinct
    minimum-size inputs: a binary string has exactly two ("0" and "1"), so a
    150-case suite could never hold more than 2 edge cases however it was built.

    Stress size still wins: a case at >= LARGE_FRAC * MAX_N is `large` even when
    flagged degenerate, so marking cases as edge can never quietly drain the
    stress bucket.
    """
    if size_kind == "none":
        return "flat"
    case = case if isinstance(case, dict) else {}
    n = max(0, int(case.get("size_metric") or 0))
    m = max(1, int(max_n))
    if n >= LARGE_FRAC * m:
        return "large"
    if n <= 1 or bool(case.get("is_edge")):
        return "edge"
    if n <= SMALL_FRAC * m:
        return "small"
    return "medium"


def normalize_input(raw: str) -> str:
    """Normalize input for dedup: strip trailing whitespace per line, drop
    trailing blank lines, unify newlines. Internal structure is preserved so
    genuinely different layouts stay distinct."""
    lines = str(raw).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines = [ln.rstrip() for ln in lines]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def dedup_by_input(cases):
    """Drop cases whose normalized input already appeared. Keep first occurrence
    in order. Returns (unique_cases, dropped_count)."""
    seen = set()
    unique = []
    dropped = 0
    for c in cases:
        h = hashlib.sha1(normalize_input(c["input"]).encode("utf-8")).hexdigest()
        if h in seen:
            dropped += 1
            continue
        seen.add(h)
        unique.append(c)
    return unique, dropped
