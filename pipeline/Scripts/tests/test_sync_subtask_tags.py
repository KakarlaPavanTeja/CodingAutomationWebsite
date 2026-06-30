"""Regression tests for sync_subtask_tags (coverage-shape / B3 repair).

A suite generated without subtask_<n> tags has subtask count 0, which fails the
B3 gate ("subtask count outside [3, 6]") on every Strengthen run — and the harden
rounds only target mutants (B1) / wrong solutions (B2), so re-running never fixed
it. sync_subtask_tags assigns difficulty-ordered subtask tiers so the suite can
pass. These tests guard that behaviour.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from Prompts.testcasesprompt_v4 import (  # noqa: E402
    MAX_CASES_PER_SUBTASK,
    MAX_SUBTASKS,
    MIN_SUBTASKS,
)
from testcase_helpers import (  # noqa: E402
    _valid_subtask_partition,
    sync_subtask_tags,
    tier_from_testcase,
)

DESC = "Given a tree with n nodes ... 1 <= n <= 100000"


def _untagged_cases(count, size_tag="size_small"):
    return [
        {
            "input": f"{i}\n{' '.join(str(x) for x in range(i))}\n",
            "output": str(i),
            "tags": [size_tag],
            "order": i,
        }
        for i in range(1, count + 1)
    ]


def _tier_counts(cases):
    counts = {}
    for c in cases:
        t = tier_from_testcase(c)
        counts[t] = counts.get(t, 0) + 1
    return counts


class SyncSubtaskTagsTest(unittest.TestCase):
    def test_untagged_suite_gets_valid_partition(self):
        # Mirrors the real failing case: 30 all-small cases, no subtask tags.
        cases = _untagged_cases(30)
        changed = sync_subtask_tags(cases, DESC)
        self.assertEqual(changed, 30)
        counts = _tier_counts(cases)
        self.assertNotIn(None, counts, "every case must end up tagged")
        self.assertTrue(MIN_SUBTASKS <= len(counts) <= MAX_SUBTASKS)
        self.assertTrue(all(v <= MAX_CASES_PER_SUBTASK for v in counts.values()))
        self.assertTrue(_valid_subtask_partition(cases))

    def test_idempotent(self):
        cases = _untagged_cases(30)
        sync_subtask_tags(cases, DESC)
        self.assertEqual(sync_subtask_tags(cases, DESC), 0)

    def test_already_valid_is_noop(self):
        cases = _untagged_cases(12)
        for i, c in enumerate(cases):
            c["tags"] = ["size_small", f"subtask_{(i % 3) + 1}"]
        self.assertTrue(_valid_subtask_partition(cases))
        self.assertEqual(sync_subtask_tags(cases, DESC), 0)

    def test_no_tier_exceeds_cap(self):
        # Many cases must still split so no subtask exceeds the per-subtask cap.
        cases = _untagged_cases(60)
        sync_subtask_tags(cases, DESC)
        counts = _tier_counts(cases)
        self.assertTrue(all(v <= MAX_CASES_PER_SUBTASK for v in counts.values()))
        self.assertTrue(_valid_subtask_partition(cases))

    def test_difficulty_ordering(self):
        # Tier 1 should hold the smallest cases, higher tiers the larger ones.
        cases = _untagged_cases(30)
        sync_subtask_tags(cases, DESC)
        by_tier = {}
        for c in cases:
            by_tier.setdefault(tier_from_testcase(c), []).append(len(c["input"]))
        max_tier = max(by_tier)
        self.assertLessEqual(max(by_tier[1]), max(by_tier[max_tier]))

    def test_empty_suite(self):
        cases = []
        self.assertEqual(sync_subtask_tags(cases, DESC), 0)


if __name__ == "__main__":
    unittest.main()
