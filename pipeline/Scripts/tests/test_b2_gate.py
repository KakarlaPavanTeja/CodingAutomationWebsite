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
)

B2_KEYS = {"skipped", "missing", "cannot_judge", "reason", "wrong_files",
           "failures", "hard_fail"}


class TestDecimalSuitesAreJudgedNormally(unittest.TestCase):
    """Decimal outputs get NO exception, because the grading compiler has none.

    Probed against nw-compiler on 2026-08-14: `0.30` vs `0.3`,
    `0.3000000000000001` vs `0.3`, `3` vs `3.0` and a 1e-9 difference all came back
    INCORRECT. Grading is exact text, so B2's exact-text comparison models it
    faithfully — a solution whose decimals differ really does fail. Abstaining here
    would only hide real survivors.
    """

    def test_a_surviving_wrong_solution_still_blocks_on_a_decimal_suite(self):
        v = b2_verdict(2, [{"file": "w1.py"}], [{"output": "3.14159"}],
                       "compute the average")
        self.assertTrue(v["hard_fail"], "decimals must not buy an exemption")
        self.assertFalse(v["cannot_judge"])

    def test_a_clean_decimal_suite_passes_on_evidence_not_abstention(self):
        v = b2_verdict(2, [], [{"output": "2.5"}], "compute the average")
        self.assertFalse(v["hard_fail"])
        self.assertFalse(v["cannot_judge"], "this is a real pass, not an abstention")


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

    def test_a_decimal_suite_with_no_wrong_solutions_still_blocks(self):
        """Decimals are not a judgement problem, so they do not excuse a missing folder."""
        with tempfile.TemporaryDirectory() as empty:
            result = run_wrong_approach_gate(
                [{"input": "1\n", "output": "3.14159"}], wrong_dir=empty,
                description="Compute the average.")
        self.assertTrue(result["missing"])
        self.assertTrue(result["hard_fail"])

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
