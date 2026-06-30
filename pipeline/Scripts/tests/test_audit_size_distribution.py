"""Regression tests for audit_size_distribution (size-diversity feedback loop).

A generator that never scales the primary size n toward the constraint maximum
produces an all-small suite: it passes generation but fails the B3 coverage-shape
gate and makes mutation testing vacuous. audit_size_distribution measures the
realized edge/small/medium/large mix (derived from inputs, like B3) so the manager
can decide whether to re-prompt the LLM. These tests guard that signal.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import audit_size_distribution  # noqa: E402

DESC = "Given an array of n integers ... Constraints: 1 <= n <= 100000"
MAX_N = 100000


def _case(n, fill=1):
    if n <= 0:
        return {"input": "0\n\n", "output": "0"}
    line = " ".join(str(fill) for _ in range(min(n, 5)))
    return {"input": f"{n}\n{line}\n", "output": str(n)}


class AuditSizeDistributionTest(unittest.TestCase):
    def test_all_small_is_deficient_in_large(self):
        # The real failure mode: every case small, none scaled to MAX_N.
        cases = [_case(n) for n in range(2, 32)]  # all n in [2,31] -> small/medium
        audit = audit_size_distribution(cases, DESC)
        self.assertFalse(audit["ok"])
        deficient_buckets = {d["bucket"] for d in audit["deficient"]}
        self.assertIn("large", deficient_buckets)
        self.assertIn("edge", deficient_buckets)

    def test_balanced_distribution_passes(self):
        # Targets: edge 20%, small 52%, medium 8%, large 20% across 25 cases.
        cases = []
        cases += [_case(1) for _ in range(5)]                 # edge  (20%)
        cases += [_case(10) for _ in range(13)]               # small (52%)
        cases += [_case(MAX_N // 3) for _ in range(2)]        # medium (8%)
        cases += [_case(MAX_N) for _ in range(5)]             # large (20%)
        audit = audit_size_distribution(cases, DESC)
        self.assertEqual(audit["total"], 25)
        self.assertTrue(audit["ok"], audit)

    def test_realized_percentages_sum_to_100(self):
        cases = [_case(n) for n in (1, 5, 50000, 100000)]
        audit = audit_size_distribution(cases, DESC)
        self.assertAlmostEqual(sum(audit["realized"].values()), 100.0, places=1)

    def test_empty_suite_is_ok(self):
        audit = audit_size_distribution([], DESC)
        self.assertTrue(audit["ok"])
        self.assertEqual(audit["total"], 0)

    def test_deficient_carries_shortfall(self):
        cases = [_case(10) for _ in range(20)]  # all small
        audit = audit_size_distribution(cases, DESC)
        large = next(d for d in audit["deficient"] if d["bucket"] == "large")
        self.assertGreater(large["shortfall_pp"], 0)
        self.assertEqual(large["target"], 20.0)


if __name__ == "__main__":
    unittest.main()
