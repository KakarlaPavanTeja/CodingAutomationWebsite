"""Non-function problems have no driver, so they ship every valid answer instead.

Two rules, both silently fatal:
  - A stored list must be provably exhaustive. A partial list marks correct answers wrong,
    which is the exact bug this design exists to remove.
  - The answer printed in the problem statement MUST appear in the list. Otherwise the
    student who copies the worked example fails.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import multi_answer_defects, sync_example_testcases  # noqa: E402
from Prompts.testcasesprompt_v4 import get_testcases_prompt  # noqa: E402

DESC = """**Example 1:**

**Input:**

```
3
1 2 3
```

**Output:**

```
1 3 2
```
"""


def multi(order, outputs):
    return {"order": order, "input": "3\n1 2 3\n", "multiple_possible_output": True,
            "outputs": list(outputs), "subtask": "example", "scenario": "example_one",
            "is_edge": False, "size_metric": 3}


class TestMultiAnswerDefects(unittest.TestCase):
    def test_a_case_with_the_example_answer_in_the_list_is_clean(self):
        self.assertEqual(multi_answer_defects([multi(1, ["1 3 2", "2 1 3"])], DESC), [])

    def test_the_example_answer_missing_from_the_list_is_a_defect(self):
        defects = multi_answer_defects([multi(1, ["2 1 3", "3 2 1"])], DESC)
        self.assertTrue(defects)
        self.assertIn("Example 1", " ".join(defects))

    def test_an_empty_outputs_list_is_a_defect(self):
        self.assertIn("empty", " ".join(multi_answer_defects([multi(1, [])], DESC)))

    def test_duplicate_answers_are_a_defect(self):
        """A duplicated entry means the enumeration double-counted, so 'exhaustive' is
        not something it actually established."""
        self.assertIn("duplicate", " ".join(
            multi_answer_defects([multi(1, ["1 3 2", "1 3 2"])], DESC)))

    def test_a_case_carrying_both_output_and_outputs_is_a_defect(self):
        tc = multi(1, ["1 3 2"])
        tc["output"] = "1 3 2"
        self.assertIn("both", " ".join(multi_answer_defects([tc], DESC)))

    def test_ordinary_single_answer_cases_are_untouched(self):
        plain = [{"order": 1, "input": "3\n1 2 3\n", "output": "1 3 2"}]
        self.assertEqual(multi_answer_defects(plain, DESC), [])

    def test_only_cases_1_and_2_are_checked_against_the_statement(self):
        """Case 7 is not a worked example, so its list has nothing to agree with."""
        self.assertEqual(multi_answer_defects([multi(7, ["9 9 9"])], DESC), [])


class TestExampleSyncLeavesMultiAnswerCasesAlone(unittest.TestCase):
    """`sync_example_testcases` runs on every suite (via `derive_and_normalize`) and
    writes `output` on cases 1-2. On a multi-answer case that would manufacture the
    `both output and outputs` defect on every single open-ended non-function run."""

    def test_the_sync_writes_the_input_but_never_an_output(self):
        tc = multi(1, ["1 3 2", "2 1 3"])
        tc["input"] = "wrong\n"
        sync_example_testcases([tc], DESC)
        self.assertEqual(tc["input"], "3\n1 2 3\n")
        self.assertNotIn("output", tc)
        self.assertEqual(multi_answer_defects([tc], DESC), [])


class TestTestcasesPrompt(unittest.TestCase):
    def test_the_enumeration_block_appears_only_when_open_ended_and_non_function(self):
        off, _ = get_testcases_prompt("d", "s", is_function=False)
        on, _ = get_testcases_prompt("d", "s", is_function=False, open_ended=True)
        self.assertNotIn("multiple_possible_output", off)
        self.assertIn("multiple_possible_output", on)

    def test_function_based_problems_never_get_the_enumeration_block(self):
        """Function problems are graded by the driver's checker; enumerating for them
        would ship a second, competing grading mechanism."""
        on, _ = get_testcases_prompt("d", "s", is_function=True, open_ended=True)
        self.assertNotIn("multiple_possible_output", on)

    def test_stress_cases_are_required_to_have_a_unique_answer(self):
        on, _ = get_testcases_prompt("d", "s", is_function=False, open_ended=True)
        self.assertIn("MUST have a UNIQUE answer", on)


if __name__ == "__main__":
    unittest.main()
