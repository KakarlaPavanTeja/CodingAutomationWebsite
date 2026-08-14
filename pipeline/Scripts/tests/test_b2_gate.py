"""B2 is the only blocking gate now, so it must never silently no-op.

A skipped B2 used to be harmless because the selector was still filtering. It is not
harmless any more: it means zero quality control on a suite that reports success.
"""

import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from benchmark_suite import (  # noqa: E402
    b2_verdict,
    run_wrong_approach_gate,
    suite_is_float_valued,
)

B2_KEYS = {"skipped", "missing", "cannot_judge", "reason", "wrong_files",
           "failures", "hard_fail"}


class TestFloatDetection(unittest.TestCase):
    def test_decimal_outputs_are_float_valued(self):
        self.assertTrue(suite_is_float_valued([{"output": "3.14159"}]))

    def test_integer_outputs_are_not_float_valued(self):
        self.assertFalse(suite_is_float_valued([{"output": "42"}, {"output": "7"}]))

    def test_non_numeric_outputs_are_not_float_valued(self):
        self.assertFalse(suite_is_float_valued([{"output": "YES"}]))

    def test_one_decimal_among_many_is_enough(self):
        self.assertTrue(suite_is_float_valued([{"output": "1"}, {"output": "2.5"}]))

    def test_a_dotted_non_number_is_not_float_valued(self):
        self.assertFalse(suite_is_float_valued([{"output": "a.b"}]))


class TestMissingWrongSolutionsBlocks(unittest.TestCase):
    def test_empty_directory_is_a_hard_fail_not_a_skip(self):
        with tempfile.TemporaryDirectory() as empty:
            result = run_wrong_approach_gate([{"input": "1\n", "output": "1"}],
                                             wrong_dir=empty)
        self.assertTrue(result["hard_fail"], "missing wrong solutions must block")
        self.assertTrue(result["missing"])

    def test_open_ended_problem_abstains_instead_of_passing(self):
        with tempfile.TemporaryDirectory() as empty:
            result = run_wrong_approach_gate(
                [{"input": "1\n", "output": "1"}], wrong_dir=empty,
                description="Return any valid arrangement of the letters.")
        self.assertTrue(result["cannot_judge"])
        self.assertFalse(result["hard_fail"], "abstention must not block")

    def test_float_suite_abstains_instead_of_passing(self):
        with tempfile.TemporaryDirectory() as empty:
            result = run_wrong_approach_gate(
                [{"input": "1\n", "output": "3.14159"}], wrong_dir=empty,
                description="Compute the average.")
        self.assertTrue(result["cannot_judge"])
        self.assertFalse(result["hard_fail"])

    def test_every_return_path_carries_every_key(self):
        cases = [{"input": "1\n", "output": "1"}]
        with tempfile.TemporaryDirectory() as empty:
            missing = run_wrong_approach_gate(cases, wrong_dir=empty)
            abstain = run_wrong_approach_gate(cases, wrong_dir=empty,
                                              description="print any valid answer")
        for result in (missing, abstain):
            self.assertEqual(B2_KEYS, set(result))


class TestReusedVerdict(unittest.TestCase):
    """testcase_annotate reuses its own kill data instead of re-running the gate.

    That path is the one the pipeline actually takes, so it must reach the same
    verdicts as the live gate.
    """

    def test_zero_wrong_files_blocks(self):
        v = b2_verdict(0, [], [{"output": "1"}], "count the pairs")
        self.assertTrue(v["missing"])
        self.assertTrue(v["hard_fail"])

    def test_a_surviving_wrong_solution_blocks(self):
        v = b2_verdict(3, [{"file": "w1.py"}], [{"output": "1"}], "count the pairs")
        self.assertTrue(v["hard_fail"])
        self.assertFalse(v["missing"])
        self.assertEqual(3, v["wrong_files"])

    def test_all_wrong_solutions_caught_passes(self):
        v = b2_verdict(3, [], [{"output": "1"}], "count the pairs")
        self.assertFalse(v["hard_fail"])
        self.assertFalse(v["cannot_judge"])
        self.assertEqual(B2_KEYS, set(v))


if __name__ == "__main__":
    unittest.main()
