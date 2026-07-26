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


if __name__ == "__main__":
    unittest.main()
