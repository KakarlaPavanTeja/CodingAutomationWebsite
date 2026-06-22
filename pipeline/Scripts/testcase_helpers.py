"""Shared test-case helpers without LLM dependencies."""

from __future__ import annotations

from Prompts.testcasesprompt_v4 import MAX_SUBTASKS, tier_from_tags

_TYPE_KEYWORDS = [
    ("tree", ("tree", "binary tree", "bst", "root", "leaf", "subtree")),
    ("graph", ("graph", "edge", "vertex", "vertices", "adjacency", "dijkstra", "node and")),
    ("dp", ("dynamic programming", "subsequence", "minimum cost", "maximum sum",
            "number of ways", "longest", "partition")),
    ("sliding_window", ("subarray", "window", "contiguous", "substring of length")),
    ("string", ("string", "substring", "character", "palindrome", "anagram")),
    ("math", ("modulo", "prime", "gcd", "factorial", "combinatorial", "number theory")),
    ("greedy", ("greedy", "interval", "schedule", "activity selection")),
    ("array", ("array", "list of integers", "nums")),
]


def detect_problem_type(description: str) -> str:
    text = (description or "").lower()
    for type_name, kws in _TYPE_KEYWORDS:
        if any(kw in text for kw in kws):
            return type_name
    return "generic"


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
