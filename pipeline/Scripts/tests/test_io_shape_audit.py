"""Testcase `input`/`output` must be raw stdin/stdout, never a Python/JSON literal.

The defect, from a real run on 2026-07-29 ("T primes"): the suite stored
`input: "1\\n[8]\\n"` and `output: '["NO"]'` while the driver reads
`sys.stdin.buffer.read().split()` and prints one token per line. Python, C++ and Java
all scored 0/150, and the outputs had to be hand-edited.

Grounding could not catch it: the reference solution of the moment parsed the literal
form too, so the suite grounded clean and only failed three steps later against the real
driver. A shape check on the stored TEXT is the only thing that catches this class.

The false-positive guards matter as much as the detection — bracketed input is CORRECT
for tree and linked-list problems (level-order with `null`), and flagging those would
block good questions.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import audit_io_shape, format_io_shape  # noqa: E402

PLAIN_DESC = ("The first line contains an integer n. "
              "The second line contains n integers.")


def case(order, inp, out):
    return {"order": order, "input": inp, "output": out}


class TestDetectsRealDefects(unittest.TestCase):
    def test_t_primes_literal_input_and_output(self):
        cases = [case(1, "1\n[8]\n", '["NO"]'),
                 case(2, "2\n[4, 9]\n", '["YES","YES"]')]
        rep = audit_io_shape(cases, PLAIN_DESC)
        self.assertEqual(rep["inputs"], 2)
        self.assertEqual(rep["outputs"], 2)
        self.assertEqual(rep["total"], 2)

    def test_named_variable_assignment_input(self):
        # "Infinite Coins" shipped `N = 2763\nC = 0` where the driver reads bare ints.
        cases = [case(1, "N = 2763\nC = 0\n", "false")]
        self.assertTrue(audit_io_shape(cases, "The first line contains an integer N."))

    def test_report_names_the_offending_cases(self):
        cases = [case(7, "1\n[8]\n", '["NO"]')]
        text = format_io_shape(audit_io_shape(cases, PLAIN_DESC))
        self.assertIn("order 7", text)
        self.assertIn("[8]", text)

    def test_sample_list_is_capped(self):
        cases = [case(i, f"1\n[{i}]\n", '["NO"]') for i in range(1, 21)]
        rep = audit_io_shape(cases, PLAIN_DESC, limit=3)
        self.assertEqual(rep["inputs"], 20)
        self.assertEqual(len(rep["samples"]), 3)


class TestNoFalsePositives(unittest.TestCase):
    def test_correct_raw_stdin_is_clean(self):
        cases = [case(1, "3\n1 2 3\n", "6"), case(2, "1\n8\n", "NO")]
        self.assertEqual(audit_io_shape(cases, PLAIN_DESC), {})

    def test_tree_level_order_brackets_are_legitimate(self):
        cases = [case(1, "[1, 2, 3, null, 4]\n", "4")]
        desc = "Given the level-order traversal of a binary tree, null for missing nodes."
        self.assertEqual(audit_io_shape(cases, desc), {})

    def test_linked_list_brackets_are_legitimate(self):
        cases = [case(1, "[1, 2, 3]\n", "3")]
        self.assertEqual(audit_io_shape(cases, "The linked list is given as a list."), {})

    def test_description_that_shows_brackets_sanctions_them(self):
        cases = [case(1, "[1, 2, 3]\n", "6")]
        desc = "Input Format\n[1, 2, 3]\nis given on a single line."
        self.assertEqual(audit_io_shape(cases, desc), {})

    def test_empty_collection_is_not_a_literal(self):
        self.assertEqual(audit_io_shape([case(1, "0\n[]\n", "0")], PLAIN_DESC), {})

    def test_negative_numbers_and_floats_are_clean(self):
        cases = [case(1, "3\n-1 2 -3\n", "-2"), case(2, "2\n1.5 2.5\n", "4.0")]
        self.assertEqual(audit_io_shape(cases, PLAIN_DESC), {})

    def test_multiline_string_payload_is_clean(self):
        cases = [case(1, "2\nabc\ndef\n", "abcdef")]
        self.assertEqual(audit_io_shape(cases, PLAIN_DESC), {})

    def test_empty_suite_and_empty_report(self):
        self.assertEqual(audit_io_shape([], PLAIN_DESC), {})
        self.assertEqual(format_io_shape({}), "")


if __name__ == "__main__":
    unittest.main()
