"""Shared test-case helpers without LLM dependencies."""

from __future__ import annotations

import re

from Prompts.testcasesprompt_v4 import MAX_SUBTASKS, SIZE_BUCKETS, size_tag, tier_from_tags

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
        tc["tags"] = _strip_size_tags(tc.get("tags") or []) + [size_tag(bucket)]
        fixed += 1
    return fixed


def sync_size_tags_json_root(data, description: str) -> int:
    if isinstance(data, list) and data and isinstance(data[0], dict) and "test_cases" in data[0]:
        return sync_size_tags(data[0]["test_cases"], description)
    if isinstance(data, dict) and "test_cases" in data:
        return sync_size_tags(data["test_cases"], description)
    return 0


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
