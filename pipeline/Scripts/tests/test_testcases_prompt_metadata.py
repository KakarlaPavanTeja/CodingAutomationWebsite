"""Phase 3: the generator prompt must instruct the model to emit the declared
metadata (size_metric/scenario/is_edge + root size_model/space_mode) and to
over-generate a large pool, while keeping the legacy weightage/tags shape."""

import unittest

from Prompts.testcasesprompt_v4 import (
    get_testcases_prompt,
    COUNT_BAND_BY_DIFFICULTY,
    POOL_TARGET_MIN,
    CASE_CAP,
)

REF = "import sys\nprint(sum(map(int, sys.stdin.read().split()[1:])))\n"


class TestPromptMetadata(unittest.TestCase):
    def _sys(self, **kw):
        system, user = get_testcases_prompt(
            "Sum an array. Constraints: 1 <= n <= 100000.", REF, 30, **kw)
        return system

    def test_declares_per_case_metadata(self):
        s = self._sys()
        for key in ("size_metric", "scenario", "is_edge"):
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
        # the CORRECT root example now carries size_model + space_mode
        self.assertIn('"size_model"', s)
        self.assertIn("OVER-GENERATE", s)

    def test_keeps_legacy_shape(self):
        # weightage + tags must still be required so downstream doesn't break
        s = self._sys()
        self.assertIn("weightage", s)
        self.assertIn("tags", s)

    def test_over_generate_targets_raised(self):
        # bands now over-generate toward the pool target, well above CASE_CAP intent
        self.assertGreaterEqual(COUNT_BAND_BY_DIFFICULTY["hard"][1], POOL_TARGET_MIN)
        self.assertGreaterEqual(POOL_TARGET_MIN, CASE_CAP)


if __name__ == "__main__":
    unittest.main()
