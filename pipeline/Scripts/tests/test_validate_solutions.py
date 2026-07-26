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


class TestValidateSolutionsLLM(unittest.TestCase):
    def _fake_call(self, content):
        def _c(system, user, purpose="chat", **kw):
            self.assertEqual(purpose, "validate_solutions")
            return content, {"prompt_tokens": 1, "completion_tokens": 1, "model": "fake", "cost": 0.0}
        return _c

    def test_clean_json_parses(self):
        from validate_solutions import validate_solutions_llm
        payload = '{"examples": [{"input": "1\\n", "expected_output": "1\\n"}], "optimal": {"ok": true, "input_format_ok": true, "issues": []}, "brute": {"ok": true, "independent": true, "issues": []}}'
        out = validate_solutions_llm("d", "o", "b", _call=self._fake_call(payload))
        self.assertEqual(len(out["examples"]), 1)
        self.assertTrue(out["optimal"]["ok"])

    def test_fenced_json_parses(self):
        from validate_solutions import validate_solutions_llm
        payload = '```json\n{"examples": [], "optimal": {"ok": true, "input_format_ok": true, "issues": []}, "brute": {"ok": true, "independent": true, "issues": []}}\n```'
        out = validate_solutions_llm("d", "o", "b", _call=self._fake_call(payload))
        self.assertEqual(out["examples"], [])

    def test_malformed_json_returns_none(self):
        from validate_solutions import validate_solutions_llm
        out = validate_solutions_llm("d", "o", "b", _call=self._fake_call("not json at all"))
        self.assertIsNone(out)

    def test_call_raises_returns_none(self):
        from validate_solutions import validate_solutions_llm
        def _boom(system, user, purpose="chat", **kw):
            raise RuntimeError("network")
        out = validate_solutions_llm("d", "o", "b", _call=_boom)
        self.assertIsNone(out)


if __name__ == "__main__":
    unittest.main()
