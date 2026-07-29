"""The mechanical contract is repaired, not asserted.

Every defect below crashed a real generator script on 2026-07-29 — and every one was
already fixed later in the pipeline (`prepare_platform_json` fills missing keys and
rescales weights, `select_suite` dedups). The script just died before our fixers ran:

    AssertionError: Duplicate input generated for case diamond_edge
    ValueError: Missing required key order in case 1
    KeyError: 'size_tag'
    AssertionError: Weight sum 20.22 != 20

`repair_suite` moves those repairs to immediately after generation, so the prompt can
stop asking the model to be right about them. `format_compliance` names what was broken
so we can tell on evidence which prompt rules still earn their tokens.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import (  # noqa: E402
    format_compliance,
    repair_suite,
    repair_suite_json_root,
)


def case(inp, **kw):
    tc = {"input": inp, "output": "x", "weightage": 1.0, "tags": ["subtask_1"],
          "order": 1, "size_metric": 1, "scenario": "s", "is_edge": False}
    tc.update(kw)
    return tc


class TestRepairSuite(unittest.TestCase):
    def test_duplicate_inputs_dropped_not_asserted(self):
        cases = [case("1\n8\n"), case("1\n8"), case("1\n9\n")]
        rep = repair_suite(cases)
        self.assertEqual(len(cases), 2)               # trailing-newline dupe collapsed
        self.assertEqual(rep["duplicate_inputs"], 1)

    def test_missing_keys_are_filled(self):
        c = {"input": "3\n1 2 3\n"}
        rep = repair_suite([c])
        for key in ("output", "weightage", "tags", "order", "size_metric",
                    "scenario", "is_edge"):
            self.assertIn(key, c, f"{key} was not filled")
        self.assertEqual(rep["missing_keys"]["order"], 1)
        self.assertEqual(c["order"], 1)

    def test_size_metric_derived_from_input_when_missing(self):
        c = {"input": "5\n1 2 3 4 5\n", "output": "15"}
        repair_suite([c])
        self.assertEqual(c["size_metric"], 5)

    def test_order_renumbered_sequentially(self):
        cases = [case("a", order=7), case("b", order=99), case("c", order=3)]
        rep = repair_suite(cases)
        self.assertEqual([c["order"] for c in cases], [1, 2, 3])
        self.assertEqual(rep["reordered"], 2)   # the third was already at 3

    def test_nonpositive_and_garbage_weights_fixed(self):
        cases = [case("a", weightage=0), case("b", weightage=-2),
                 case("c", weightage="oops"), case("d", weightage=None)]
        rep = repair_suite(cases)
        self.assertTrue(all(float(c["weightage"]) > 0 for c in cases))
        self.assertEqual(rep["nonpositive_weights"], 3)   # the None counts as missing

    def test_cases_with_no_input_are_dropped(self):
        cases = [case("1\n8\n"), {"output": "x"}, case("   ")]
        rep = repair_suite(cases)
        self.assertEqual(len(cases), 1)
        self.assertEqual(rep["dropped_unusable"], 2)

    def test_empty_suite_is_safe(self):
        self.assertEqual(repair_suite([])["duplicate_inputs"], 0)

    def test_clean_suite_reports_nothing(self):
        cases = [case("a", order=1), case("b", order=2)]
        self.assertEqual(format_compliance(repair_suite(cases)), "")

    def test_json_root_shapes(self):
        listed = [{"test_cases": [case("a"), case("a")]}]
        self.assertEqual(repair_suite_json_root(listed)["duplicate_inputs"], 1)
        dicted = {"test_cases": [case("b"), case("b")]}
        self.assertEqual(repair_suite_json_root(dicted)["duplicate_inputs"], 1)
        self.assertEqual(repair_suite_json_root("garbage"), {})


class TestFormatCompliance(unittest.TestCase):
    def test_names_every_violation(self):
        cases = [case("a", order=5), case("a"), {"output": "x"}, case("b", weightage=0)]
        line = format_compliance(repair_suite(cases))
        self.assertIn("duplicate input", line)
        self.assertIn("no input", line)
        self.assertIn("non-positive weight", line)

    def test_empty_report_is_empty_string(self):
        self.assertEqual(format_compliance({}), "")


if __name__ == "__main__":
    unittest.main()
