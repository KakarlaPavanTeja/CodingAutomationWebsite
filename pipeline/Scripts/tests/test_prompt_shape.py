"""The prompt asks only for judgment calls; everything computable is derived.

Guards the sections that were deleted (they described arithmetic we now do
ourselves) and the ones that must survive (each defends against a real observed
failure, and the reply is executed as Python).
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from Prompts.testcasesprompt_v4 import get_testcases_prompt  # noqa: E402

DESCRIPTION = (
    "Sum an array.\n\nConstraints\n1 <= n <= 100000\n\n"
    "Example 1\nInput\n3\n1 2 3\nOutput\n6\n"
)
SOLUTION = "import sys\nd=sys.stdin.read().split()\nprint(sum(map(int,d[1:])))\n"


def build(**kw):
    system, user = get_testcases_prompt(DESCRIPTION, SOLUTION, **kw)
    return system + "\n" + user


class TestPromptShape(unittest.TestCase):
    def test_deleted_sections_are_gone(self):
        text = build()
        for marker in [
            "WEIGHT DISTRIBUTION",
            "HOW THE SIZE AUDIT ACTUALLY BUCKETS",
            "SELF-CHECK BEFORE WRITE",
            "PER-PROBLEM-TYPE REQUIRED SCENARIOS",
            "SOURCE MUST BE PURE ASCII",
            "partial-credit judge",
        ]:
            self.assertNotIn(marker, text, f"{marker!r} should have been deleted")

    def test_defensive_sections_survive(self):
        text = build()
        for marker in [
            "OUTPUT HYGIENE",
            "NEVER CRASH",
            "IMPORT CORRECTNESS",
            "DUAL-ORACLE",
            "MULTI-AXIS STRESS",
            "ADVERSARIAL",
        ]:
            self.assertIn(marker, text, f"{marker!r} must survive — it defends a real failure")

    def test_states_the_difficulty_count_band(self):
        self.assertIn("120", build(difficulty="medium"))
        self.assertIn("250", build(difficulty="hard"))

    def test_explicit_count_overrides_the_band(self):
        self.assertIn("exactly 42", build(num_testcases=42))

    def test_asks_for_a_semantic_subtask_name(self):
        text = build()
        self.assertIn("subtask", text.lower())
        self.assertIn("snake_case", text)

    def test_does_not_ask_for_size_tags_or_weights(self):
        text = build()
        self.assertNotIn("size_edge", text, "size tags are derived, not declared")
        self.assertNotIn("weightage", text, "weights are derived, not declared")

    def test_says_the_suite_ships_untrimmed(self):
        self.assertIn("final suite", build().lower())


if __name__ == "__main__":
    unittest.main()
