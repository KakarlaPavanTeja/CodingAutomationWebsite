"""Regression tests for constraint-driven data type selection prompt rules."""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from Prompts.dataTypePrompt import get_data_type_selection_rules  # noqa: E402
from Prompts.conversionPrompt import get_conversion_prompt  # noqa: E402
from Prompts.splittingPrompt import get_splitting_prompt  # noqa: E402
from Prompts.normalizationPrompt import get_normalization_prompt  # noqa: E402


class TestDataTypePrompt(unittest.TestCase):
    def test_rules_mention_int32_bounds_and_cross_language_consistency(self):
        rules = get_data_type_selection_rules()
        self.assertIn("2,147,483,647", rules)
        self.assertIn("long long", rules)
        self.assertIn("cross-language consistent", rules)
        self.assertIn("10 ≤ n ≤ 10^9", rules)

    def test_conversion_prompt_includes_data_type_rules(self):
        prompt = get_conversion_prompt("C++", "class solution:\n    pass", "standard")
        self.assertIn("DATA TYPE SELECTION", prompt)
        self.assertIn('Do NOT upgrade to 64-bit just because a bound is "large"', prompt)

    def test_splitting_prompt_includes_signature_consistency(self):
        system_prompt, _ = get_splitting_prompt("C++", "int main() {}", desc_response="Constraints: 1 <= n <= 10^9")
        self.assertIn("SIGNATURE CONSISTENCY", system_prompt)
        self.assertIn("DATA TYPE SELECTION", system_prompt)

    def test_normalization_prompt_includes_data_type_rules(self):
        prompt = get_normalization_prompt("int main() {}", "cpp")
        self.assertIn("DATA TYPE SELECTION", prompt)


if __name__ == "__main__":
    unittest.main()
