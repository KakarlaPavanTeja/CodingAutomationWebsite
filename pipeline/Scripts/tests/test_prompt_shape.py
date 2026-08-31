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
            "MULTI-AXIS STRESS",
            "ADVERSARIAL",
            # Without this, the model reads the constraint bound as an instruction and
            # ships every non-example case at max magnitude (a whole BST suite of
            # 9-digit node values, examples excluded).
            "VALUE MAGNITUDE",
        ]:
            self.assertIn(marker, text, f"{marker!r} must survive — it defends a real failure")

    def test_dual_oracle_section_appears_when_a_brute_force_is_given(self):
        """Asserted against a prompt built WITH a brute force — the only mode in which
        dual-oracle cross-checking exists. Asserting it on a single-oracle prompt would
        pass only if the string were smuggled into some other header."""
        text = build(brute_force_code="print(sum(map(int, input().split())))\n")
        self.assertIn("DUAL-ORACLE", text)

    def test_single_oracle_mode_is_declared_when_no_brute_force_is_given(self):
        text = build()
        self.assertIn("SINGLE-ORACLE MODE", text)
        self.assertNotIn("DUAL-ORACLE", text,
                         "a single-oracle prompt must not claim a cross-check it lacks")

    def test_states_the_diagnostic_count_band(self):
        """The band is a DIAGNOSTIC on the coverage plan, not a per-difficulty quota.

        Difficulty used to pick the band (easy 80-120 / medium 120-180 / hard 180-250) and
        the band was the only number the model got — so it became a target, and when the
        genuine scenarios ran out the model padded with more max-size draws. A measured
        suite ended up with 35 stress cases covering 2 distinct shapes. Coverage now
        decides the count, so the SAME band is stated for every difficulty."""
        for difficulty in ("easy", "medium", "hard"):
            text = build(difficulty=difficulty)
            self.assertIn("80", text)
            self.assertIn("250", text)
            self.assertIn("DIAGNOSTIC", text,
                          "the band must be framed as a diagnostic, never as a target")
        self.assertNotIn("120", build(difficulty="medium"),
                         "difficulty must no longer select its own band")

    def test_magnitude_is_a_declared_field_with_an_absolute_cap(self):
        """Prose did not hold this line. A real run put 5-digit values on EVERY stress case
        while the prompt said "DEFAULT to 1-3 digits ... for the MAJORITY of cases" -- hedged
        language, buried in a bullet list, with no declared field to count. Magnitude is now
        a per-case field with an absolute budget, the same shape as the stress band's rule."""
        text = build()
        self.assertIn("`magnitude`", text, "magnitude must be a DECLARED per-case field")
        self.assertIn("magnitude", text.lower())
        self.assertIn("AT MOST 3", text, "the budget must be an absolute count, not a percentage")
        self.assertIn("MAGNITUDE BUDGET", text, "it must appear in the FINAL CHECK list")
        # the declared-keys line must list it, or the model will drop it
        self.assertIn("`scenario`, `magnitude`, `is_edge`", text)

    def test_exhaustive_mode_is_exempt_from_the_floor(self):
        """A small finite domain (backtracking/permutations, n <= 8-10) legitimately has
        fewer than 80 distinct legal inputs; the floor must not read as unconditional."""
        text = build(difficulty="easy")
        self.assertIn("exhaustive", text)
        self.assertIn("COMPLETE, not a shortfall", text)

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
