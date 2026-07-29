"""Regression tests for the pipeline-review fixes.

Covers the three pieces of real logic those fixes introduced:
  * poll_budget    — scales the compiler poll window with the batch size
  * title cleaning — strips only a trailing "- 95%", keeps hyphenated titles
  * _script_timeout_sec — accepts floats instead of silently ignoring them
"""

import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

import execution_manager_v3 as emv3  # noqa: E402
import testcase_manager_v4 as tm4  # noqa: E402


class TestPollBudget(unittest.TestCase):
    def test_floor_is_the_flat_cap(self):
        """A tiny batch must not poll for less than the historical default."""
        self.assertEqual(
            emv3.poll_budget(5, 1),
            emv3.MAX_POLL_ATTEMPTS,
        )

    def test_scales_with_batch_size(self):
        """A big suite gets a window covering its worst case, not a flat 2 min.

        This is the bug: 400 cases x 5s cannot finish inside MAX_POLL_ATTEMPTS
        polls, so the run returned TIMEOUT and every result was discarded.
        """
        budget = emv3.poll_budget(5, 400)
        worst_case_polls = 5 * 400 / emv3.POLL_INTERVAL_SECONDS
        self.assertGreater(budget, emv3.MAX_POLL_ATTEMPTS)
        self.assertGreaterEqual(budget, worst_case_polls)

    def test_degenerate_inputs_do_not_shrink_the_budget(self):
        for time_limit, num in ((0, 0), (-1, 10), (5, -3)):
            self.assertEqual(emv3.poll_budget(time_limit, num), emv3.MAX_POLL_ATTEMPTS)


class TestTitleAnnotationStripping(unittest.TestCase):
    """All four title readers must agree, and none may truncate a hyphen."""

    def _write_titles(self, tmpdir, line):
        outputs = os.path.join(tmpdir, "Outputs")
        os.makedirs(outputs, exist_ok=True)
        with open(os.path.join(outputs, "generated_titles.txt"), "w") as f:
            f.write(line + "\n")
        return outputs

    def test_v3_keeps_hyphenated_title(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write_titles(tmp, "- Two-Sum Pairs - 95%")
            _, name = emv3._resolve_question_meta(tmp, {"question": {}}, False)
            self.assertEqual(name, "Two-Sum Pairs")

    def test_v3_strips_percent_annotation_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write_titles(tmp, "- Pair Sum Indices - 95%")
            _, name = emv3._resolve_question_meta(tmp, {"question": {}}, False)
            self.assertEqual(name, "Pair Sum Indices")

    def test_v3_title_without_annotation_is_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write_titles(tmp, "- Longest Sub-Array")
            _, name = emv3._resolve_question_meta(tmp, {"question": {}}, False)
            self.assertEqual(name, "Longest Sub-Array")

    def test_editorial_manager_matches(self):
        import editorial_manager as em

        with tempfile.TemporaryDirectory() as tmp:
            outputs = self._write_titles(tmp, "- Two-Sum Pairs - 95%")
            prev = os.environ.pop("PIPELINE_OWNER_TITLE", None)
            try:
                self.assertEqual(em.resolve_short_title(outputs), "Two-Sum Pairs")
            finally:
                if prev is not None:
                    os.environ["PIPELINE_OWNER_TITLE"] = prev


class TestScriptTimeoutParsing(unittest.TestCase):
    def setUp(self):
        self._prev = os.environ.get("TESTCASE_SCRIPT_TIMEOUT_SEC")

    def tearDown(self):
        if self._prev is None:
            os.environ.pop("TESTCASE_SCRIPT_TIMEOUT_SEC", None)
        else:
            os.environ["TESTCASE_SCRIPT_TIMEOUT_SEC"] = self._prev

    def test_float_value_is_honoured(self):
        """int("900.5") raises, and the old code silently reverted to 600."""
        os.environ["TESTCASE_SCRIPT_TIMEOUT_SEC"] = "900.5"
        self.assertEqual(tm4._script_timeout_sec(), 900)

    def test_integer_value_is_honoured(self):
        os.environ["TESTCASE_SCRIPT_TIMEOUT_SEC"] = "1200"
        self.assertEqual(tm4._script_timeout_sec(), 1200)

    def test_garbage_falls_back_to_default(self):
        os.environ["TESTCASE_SCRIPT_TIMEOUT_SEC"] = "soon"
        self.assertEqual(tm4._script_timeout_sec(), 600)

    def test_unset_falls_back_to_default(self):
        os.environ.pop("TESTCASE_SCRIPT_TIMEOUT_SEC", None)
        self.assertEqual(tm4._script_timeout_sec(), 600)


if __name__ == "__main__":
    unittest.main()
