"""The I/O format is raw stdin tokens, and the reference must read them.

A reference that parses the description's `name = value` DISPLAY form is the one defect
no execution-based check can see. Observed end to end on 2026-08-18 with a topological
ordering problem: the normalized reference split its input on "=", the I/O contract asked
a model to match that parser, the model proposed the assignment form, the reference
reproduced the stated answer, and

    the contract VERIFIED
    grounding PASSED
    the checker grounded clean on all 120 cases

...while the suite would have scored zero on the platform, because the driver writes raw
tokens. Every execution-based check agreed with every other one about a format that never
reaches the process. Only the text audit dissented, and it was a warning.

Hence two gates, both static: reject the parser at the source, and refuse the suite.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from problem_flags import stdin_parsing_defects  # noqa: E402

RAW_READER = '''
import sys

def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    print(sum(map(int, data[1:1 + n])))
'''

DISPLAY_FORM_READER = '''
import sys

def main():
    data = [l.strip() for l in sys.stdin.read().splitlines() if l.strip()]
    numCourses = int(data[0].split("=", 1)[1].strip())
    print(numCourses)
'''


class TestReferenceMustReadRawStdin(unittest.TestCase):
    def test_a_raw_token_reader_is_clean(self):
        self.assertEqual(stdin_parsing_defects(RAW_READER), [])

    def test_splitting_input_on_equals_is_a_defect(self):
        """The exact shape the naming step produced on 2026-08-18."""
        defects = stdin_parsing_defects(DISPLAY_FORM_READER)
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("raw stdin", defects[0])

    def test_single_quoted_equals_is_caught_too(self):
        """A model picks either quote style; the gate must not depend on which."""
        src = "x = line.split('=', 1)[1]\n"
        self.assertTrue(stdin_parsing_defects(src))

    def test_whitespace_inside_the_call_is_caught(self):
        self.assertTrue(stdin_parsing_defects('v = line.split( "=" , 1)[1]\n'))

    def test_an_equals_sign_in_a_string_is_not_a_defect(self):
        """Only a SPLIT on '=' is the signature. Printing or comparing one is ordinary
        code, and flagging it would fail honest references."""
        src = 'print("total = ", total)\nif a == b:\n    pass\n'
        self.assertEqual(stdin_parsing_defects(src), [])

    def test_splitting_on_something_else_is_not_a_defect(self):
        src = 'parts = line.split(",")\nother = line.split()\n'
        self.assertEqual(stdin_parsing_defects(src), [])

    def test_empty_source_is_clean_rather_than_crashing(self):
        for value in ("", "   ", None):
            self.assertEqual(stdin_parsing_defects(value), [])


class TestTheAuditThatBlocksIsWiredUp(unittest.TestCase):
    """The shape audit is the only check that dissented, so it must now stop the run.

    Asserted on the source of `main()` rather than by driving it: reaching that line
    needs a generated suite, an LLM and a reference on disk, none of which belong in a
    unit test. What is worth pinning is that the branch raises instead of printing.
    """

    def test_the_shape_audit_raises_instead_of_warning(self):
        path = os.path.join(SCRIPT_DIR, "testcase_manager_v4.py")
        with open(path, encoding="utf-8") as f:
            source = f.read()
        # Window generous enough to survive the rationale comment above the raise —
        # a tight slice made this test fail on correct code.
        after_audit = source.split("io_shape = format_io_shape(")[1][:1800]
        self.assertIn("raise SystemExit(1)", after_audit,
                      "a display-form suite must stop the run, not print a warning")
        self.assertNotIn('print(f"WARNING: {io_shape}")', source,
                         "the warning-only path was the 2026-08-18 failure")


if __name__ == "__main__":
    unittest.main()
