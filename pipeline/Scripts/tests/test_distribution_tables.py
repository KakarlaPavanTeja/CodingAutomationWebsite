"""Regression tests locking the test-case distribution constants in testcasesprompt_v4.

The generator's size mix and per-subtask weight ladder are driven by two module-level
tables. The generated script does a DISTRIBUTION_BY_MODE[mode][k] lookup for every
subtask count k in [MIN_SUBTASKS, MAX_SUBTASKS], so a missing row KeyErrors at run time;
and each row must sum to 100, be monotonic increasing, and put >= 35% on the top tier
(the scoring-block invariant). These tests fail fast if a future edit breaks any of that.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from Prompts.testcasesprompt_v4 import (  # noqa: E402
    DISTRIBUTION_BY_MODE,
    SIZE_CATEGORY_TARGETS,
    MIN_SUBTASKS,
    MAX_SUBTASKS,
)


class SizeCategoryTargetsTest(unittest.TestCase):
    def test_targets_sum_to_100(self):
        self.assertAlmostEqual(sum(SIZE_CATEGORY_TARGETS.values()), 100.0, places=6)

    def test_expected_buckets_present(self):
        self.assertEqual(set(SIZE_CATEGORY_TARGETS), {"edge", "small", "medium", "large"})

    def test_small_cluster_dominates_count(self):
        # Philosophy of the change: correctness-heavy by count (small is the majority).
        self.assertEqual(
            max(SIZE_CATEGORY_TARGETS, key=SIZE_CATEGORY_TARGETS.get), "small"
        )


class DistributionByModeTest(unittest.TestCase):
    def test_every_subtask_count_has_a_row_in_both_modes(self):
        wanted = set(range(MIN_SUBTASKS, MAX_SUBTASKS + 1))
        for mode, rows in DISTRIBUTION_BY_MODE.items():
            self.assertTrue(
                wanted.issubset(set(rows)),
                f"{mode} missing rows for {wanted - set(rows)}",
            )

    def test_row_length_matches_its_key(self):
        for mode, rows in DISTRIBUTION_BY_MODE.items():
            for k, row in rows.items():
                self.assertEqual(len(row), k, f"{mode}[{k}] has {len(row)} entries")

    def test_each_row_sums_to_100(self):
        for mode, rows in DISTRIBUTION_BY_MODE.items():
            for k, row in rows.items():
                self.assertEqual(sum(row), 100, f"{mode}[{k}] sums to {sum(row)}")

    def test_each_row_is_monotonic_increasing(self):
        for mode, rows in DISTRIBUTION_BY_MODE.items():
            for k, row in rows.items():
                self.assertEqual(row, sorted(row), f"{mode}[{k}] not monotonic: {row}")

    def test_top_tier_holds_at_least_35_percent(self):
        for mode, rows in DISTRIBUTION_BY_MODE.items():
            for k, row in rows.items():
                self.assertGreaterEqual(row[-1], 35, f"{mode}[{k}] top tier {row[-1]} < 35")


if __name__ == "__main__":
    unittest.main()
