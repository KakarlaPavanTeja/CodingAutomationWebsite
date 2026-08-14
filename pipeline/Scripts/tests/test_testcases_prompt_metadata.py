"""The generator prompt must declare the per-case metadata the derive step consumes
(subtask/scenario/is_edge/size_metric + root size_model/space_mode) and nothing more.

Weights, size tags, order and subtask numbers are derived after the model runs, so the
prompt must NOT ask for them — a model that emits them is guessing at arithmetic we do
deterministically.
"""

import unittest

from Prompts.testcasesprompt_v4 import (
    get_testcases_prompt,
    COUNT_BAND_BY_DIFFICULTY,
    MIN_TESTCASES,
)

REF = "import sys\nprint(sum(map(int, sys.stdin.read().split()[1:])))\n"

REQUIRED_CASE_KEYS = ("input", "output", "subtask", "scenario", "is_edge", "size_metric")


class TestPromptMetadata(unittest.TestCase):
    def _sys(self, **kw):
        system, user = get_testcases_prompt(
            "Sum an array. Constraints: 1 <= n <= 100000.", REF, **kw)
        return system

    def test_declares_per_case_metadata(self):
        s = self._sys()
        for key in REQUIRED_CASE_KEYS:
            self.assertIn(key, s, f"prompt must mention per-case {key}")

    def test_declares_root_size_model(self):
        s = self._sys()
        self.assertIn("size_model", s)
        self.assertIn("space_mode", s)
        self.assertIn("exhaustive", s)
        # kinds enumerated
        for kind in ("count", "value", "grid", "multi", "none"):
            self.assertIn(kind, s)

    def test_json_shape_includes_new_fields(self):
        s = self._sys()
        # the CORRECT root example carries size_model + space_mode
        self.assertIn('"size_model"', s)
        self.assertIn("FINAL SUITE", s)

    def test_does_not_ask_for_derived_fields(self):
        s = self._sys()
        for derived in ("weightage", "OVER-GENERATE", "size_edge"):
            self.assertNotIn(derived, s, f"{derived} is derived, not declared")

    def test_count_bands_are_what_ships(self):
        # No selector trims the suite, so the band IS the shipped count.
        for lo, hi in COUNT_BAND_BY_DIFFICULTY.values():
            self.assertLess(lo, hi)
            self.assertGreaterEqual(lo, MIN_TESTCASES)
        self.assertEqual(COUNT_BAND_BY_DIFFICULTY["hard"][1], 250)


if __name__ == "__main__":
    unittest.main()
