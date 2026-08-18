"""The checker must be module-level and self-contained, or grading breaks silently.

The driver does `from solution import solution` — at grading time that is the STUDENT's
class. A checker written as a method of `solution`, or a `reference_answer` that delegates
to it, would grade every student against their own (possibly wrong) answer and mark
everyone correct. Nothing downstream would notice, so it is checked statically here.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from problem_flags import checker_defects  # noqa: E402
from Prompts.normalizationPrompt import get_normalization_prompt  # noqa: E402

GOOD = '''
class solution:
    def twoSum(self, nums, k):
        return [0, 1]


def reference_answer(stdin_text):
    parts = stdin_text.split()
    return "0 1"


def is_valid_answer(stdin_text, candidate_stdout):
    return candidate_stdout.strip() in ("0 1", "1 0")
'''


class TestCheckerDefects(unittest.TestCase):
    def test_a_well_formed_checker_has_no_defects(self):
        self.assertEqual(checker_defects(GOOD), [])

    def test_a_missing_function_is_a_defect(self):
        src = GOOD.replace("def is_valid_answer", "def isValidAnswer")
        self.assertIn("is_valid_answer", " ".join(checker_defects(src)))

    def test_a_checker_nested_in_the_solution_class_is_a_defect(self):
        src = '''
class solution:
    def reference_answer(self, stdin_text):
        return "0 1"

    def is_valid_answer(self, stdin_text, candidate_stdout):
        return True
'''
        defects = checker_defects(src)
        self.assertTrue(defects, "a method is not reachable from the driver")
        self.assertIn("module-level", " ".join(defects))

    def test_a_reference_answer_that_delegates_to_solution_is_a_defect(self):
        src = GOOD.replace('    return "0 1"\n\n\ndef is_valid',
                           '    return solution().twoSum([], 0)\n\n\ndef is_valid')
        self.assertIn("self-contained", " ".join(checker_defects(src)))

    def test_wrong_arity_is_a_defect(self):
        src = GOOD.replace("def reference_answer(stdin_text):",
                           "def reference_answer(a, b, c):")
        self.assertIn("reference_answer", " ".join(checker_defects(src)))

    def test_unparseable_source_is_reported_not_crashed(self):
        self.assertTrue(checker_defects("def (:"))


class TestNormalizationPrompt(unittest.TestCase):
    def test_the_checker_block_appears_only_when_open_ended(self):
        off = get_normalization_prompt("x", "python", None, "desc", "standard")
        on = get_normalization_prompt("x", "python", None, "desc", "standard",
                                      open_ended=True)
        self.assertNotIn("reference_answer", off)
        self.assertIn("reference_answer", on)
        self.assertIn("is_valid_answer", on)

    def test_the_prompt_states_both_silently_fatal_rules(self):
        on = get_normalization_prompt("x", "python", None, "desc", "standard",
                                      open_ended=True)
        self.assertIn("module-level", on)
        self.assertIn("self-contained", on)

    def test_only_python_gets_the_python_shaped_checker_block(self):
        """Phase 1 is Python-only. A Python `def` block pasted into a C++/Java
        normalization would corrupt the reference; Task 8 adds the other languages."""
        for lang in ("c++", "java", "node.js"):
            on = get_normalization_prompt("x", lang, None, "desc", "standard",
                                          open_ended=True)
            self.assertNotIn("reference_answer", on, lang)


if __name__ == "__main__":
    unittest.main()
