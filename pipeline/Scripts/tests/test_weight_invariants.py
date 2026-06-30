"""Regression tests for the per-case weight invariants in prepare_platform_json.

The platform rejects any test case with weightage <= 0, and exam/practice scoring
relies on the generated relative weights summing EXACTLY to the total score. These
guard the three helpers that enforce that:

- _ensure_positive_weights: lift any <=0 weight to WEIGHT_FLOOR, borrowing the cost
  from the largest donor so the total is preserved when feasible (positivity wins
  over the exact sum only in the degenerate too-small-total regime).
- _scale_weights_to_total: scale real generated weights to sum exactly to the total,
  preserving proportions; return False (so the caller falls back) if any are bad.
- _generated_weight_total: sum, or None if any weight is missing / <=0.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from prepare_platform_json import (  # noqa: E402
    WEIGHT_FLOOR,
    _ensure_positive_weights,
    _scale_weights_to_total,
    _generated_weight_total,
)


def _cases(weights):
    return [{"weightage": w} for w in weights]


class EnsurePositiveWeightsTest(unittest.TestCase):
    def test_all_positive_unchanged(self):
        w = [1.0, 2.0, 3.0]
        self.assertEqual(_ensure_positive_weights(w), [1.0, 2.0, 3.0])

    def test_negative_residue_lifted_and_total_preserved(self):
        # -0.02 must be lifted to the floor; the 0.03 deficit borrowed from the
        # largest donor (1.0 -> 0.97). Grand total stays 1.48.
        w = _ensure_positive_weights([1.0, 0.5, -0.02])
        self.assertTrue(all(x >= WEIGHT_FLOOR for x in w))
        self.assertAlmostEqual(sum(w), 1.48, places=2)
        self.assertEqual(w[2], WEIGHT_FLOOR)

    def test_zero_is_lifted(self):
        w = _ensure_positive_weights([0.0, 5.0])
        self.assertTrue(all(x > 0 for x in w))
        self.assertEqual(w[0], WEIGHT_FLOOR)
        self.assertAlmostEqual(sum(w), 5.0, places=2)

    def test_degenerate_total_prioritizes_positivity_over_sum(self):
        # No donor can give up 0.01 and stay >= floor, so the sum is allowed to
        # drift upward — but every weight MUST end up strictly positive.
        w = _ensure_positive_weights([0.01, 0.0])
        self.assertTrue(all(x >= WEIGHT_FLOOR for x in w))
        self.assertEqual(w, [0.01, 0.01])

    def test_empty_list(self):
        self.assertEqual(_ensure_positive_weights([]), [])


class ScaleWeightsToTotalTest(unittest.TestCase):
    def test_scales_to_exact_total_preserving_proportions(self):
        cases = _cases([1.0, 2.0, 3.0])
        self.assertTrue(_scale_weights_to_total(cases, 100.0))
        out = [c["weightage"] for c in cases]
        self.assertAlmostEqual(sum(out), 100.0, places=2)
        # 1:2:3 proportions -> the third holds half the total.
        self.assertAlmostEqual(out[2], 50.0, places=1)
        self.assertLess(out[0], out[1])
        self.assertLess(out[1], out[2])

    def test_rounding_residual_absorbed_so_sum_is_exact(self):
        # Three equal weights over 100 do not divide evenly at 2dp; the residual
        # must be absorbed so the realized sum is EXACTLY the total.
        cases = _cases([1.0, 1.0, 1.0])
        self.assertTrue(_scale_weights_to_total(cases, 100.0))
        self.assertAlmostEqual(sum(c["weightage"] for c in cases), 100.0, places=2)

    def test_all_weights_strictly_positive_after_scaling(self):
        cases = _cases([0.001, 0.001, 99.0])
        self.assertTrue(_scale_weights_to_total(cases, 10.0))
        self.assertTrue(all(c["weightage"] > 0 for c in cases))

    def test_missing_weight_returns_false_and_does_not_mutate(self):
        cases = [{"weightage": 1.0}, {"weightage": None}]
        self.assertFalse(_scale_weights_to_total(cases, 100.0))
        self.assertEqual(cases[0]["weightage"], 1.0)

    def test_nonpositive_weight_returns_false(self):
        self.assertFalse(_scale_weights_to_total(_cases([1.0, 0.0]), 100.0))
        self.assertFalse(_scale_weights_to_total(_cases([1.0, -2.0]), 100.0))

    def test_empty_is_true_noop(self):
        self.assertTrue(_scale_weights_to_total([], 100.0))


class GeneratedWeightTotalTest(unittest.TestCase):
    def test_sums_valid_weights(self):
        self.assertEqual(_generated_weight_total(_cases([1.5, 2.5, 6.0])), 10.0)

    def test_none_when_empty(self):
        self.assertIsNone(_generated_weight_total([]))

    def test_none_when_any_missing(self):
        self.assertIsNone(_generated_weight_total([{"weightage": 1.0}, {}]))

    def test_none_when_any_nonpositive(self):
        self.assertIsNone(_generated_weight_total(_cases([1.0, 0.0])))
        self.assertIsNone(_generated_weight_total(_cases([1.0, -1.0])))


if __name__ == "__main__":
    unittest.main()
