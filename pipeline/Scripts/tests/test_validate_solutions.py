"""Unit tests for the validate_solutions purpose + module (advisory SLM validation)."""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)


class TestValidateSolutionsRouting(unittest.TestCase):
    def setUp(self):
        # Ensure no env override leaks in from the shell.
        for k in ("OPENROUTER_MODEL_VALIDATE_SOLUTIONS", "OPENAI_REASONING_EFFORT_VALIDATE_SOLUTIONS"):
            os.environ.pop(k, None)

    def test_purpose_routes_to_gemini_flash_low(self):
        import llm_client as lc
        self.assertEqual(lc._resolve_model("validate_solutions"), "google/gemini-3.5-flash")
        self.assertEqual(lc._resolve_reasoning_effort("validate_solutions"), "low")


class TestValidatePrompt(unittest.TestCase):
    def test_builder_returns_two_strings_with_inputs(self):
        from Prompts.validatesolutionsprompt import get_validate_solutions_prompt
        system, user = get_validate_solutions_prompt(
            "Add two numbers. Read n then n ints.", "OPTCODE_MARKER", "BRUTECODE_MARKER"
        )
        self.assertIsInstance(system, str)
        self.assertIsInstance(user, str)
        # The optimal + brute + description must reach the model.
        self.assertIn("OPTCODE_MARKER", user)
        self.assertIn("BRUTECODE_MARKER", user)
        self.assertIn("Add two numbers", user)
        # The system prompt must mandate strict JSON, the format-inference job,
        # and the expected_output field.
        for token in ("STRICT JSON", "expected_output", "input format", "examples"):
            self.assertIn(token, system)


if __name__ == "__main__":
    unittest.main()
