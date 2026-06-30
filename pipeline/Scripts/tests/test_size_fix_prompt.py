"""Regression tests for get_size_fix_prompt (size-diversity feedback loop).

When a generator script runs but emits the wrong size mix (almost always all-small),
the manager re-prompts the LLM to repair the size ladder ONLY. get_size_fix_prompt
builds that (system, user) pair from a size audit. These tests guard that the prompt
actually carries the audit signal (which buckets are short/over), the script, and the
constraint description — and that it keeps the output-hygiene contract that lets the
response be written verbatim to an executable .py file.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import audit_size_distribution  # noqa: E402
from Prompts.testcasesprompt_v4 import get_size_fix_prompt  # noqa: E402

DESC = "Given an array. Constraints: 1 <= n <= 100000"
SCRIPT = "import json\n# UNIQUE_GENERATOR_MARKER\nprint('hi')\n"


def _all_small_audit():
    cases = [{"input": f"{n}\n{' '.join(['1'] * min(n, 5))}\n", "output": str(n)}
             for n in range(2, 22)]
    return audit_size_distribution(cases, DESC)


class GetSizeFixPromptTest(unittest.TestCase):
    def setUp(self):
        self.audit = _all_small_audit()
        self.system, self.user = get_size_fix_prompt(SCRIPT, DESC, self.audit)

    def test_returns_two_nonempty_strings(self):
        self.assertIsInstance(self.system, str)
        self.assertIsInstance(self.user, str)
        self.assertTrue(self.system.strip())
        self.assertTrue(self.user.strip())

    def test_user_prompt_embeds_script_and_description(self):
        self.assertIn("UNIQUE_GENERATOR_MARKER", self.user)
        self.assertIn("100000", self.user)  # constraint from DESC, for MAX_N parsing

    def test_user_prompt_names_deficient_buckets(self):
        # The all-small suite is short on large (and edge); the prompt must say so.
        self.assertIn("size_large", self.user)
        deficient_buckets = {d["bucket"] for d in self.audit["deficient"]}
        self.assertIn("large", deficient_buckets)

    def test_user_prompt_reports_excessive_buckets(self):
        self.assertTrue(self.audit["excessive"])  # small is over-represented here
        self.assertIn("size_small", self.user)

    def test_system_prompt_keeps_output_hygiene_contract(self):
        # The reply is written verbatim to a .py file and executed — it must forbid
        # markdown fences / preamble so the first character is valid Python.
        low = self.system.lower()
        self.assertIn("markdown", low)
        self.assertTrue("first character" in low or "verbatim" in low)


if __name__ == "__main__":
    unittest.main()
