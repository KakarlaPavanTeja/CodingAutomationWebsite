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

    def test_purpose_routes_to_v4_flash_low(self):
        # Advisory judge: cheapest capable reasoner, with the previous model
        # (gemini-3.5-flash) kept as the first fallback.
        import llm_client as lc
        self.assertEqual(lc._resolve_model("validate_solutions"), "deepseek/deepseek-v4-flash")
        self.assertEqual(lc._resolve_reasoning_effort("validate_solutions"), "low")
        self.assertEqual(
            [e["model"] for e in lc._resolve_fallback_plan("validate_solutions")],
            ["google/gemini-3.5-flash", "openai/gpt-5.4"],
        )


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


class TestValidateExamples(unittest.TestCase):
    def test_flags_format_error_and_mismatch_and_brute_disagreement(self):
        from validate_solutions import validate_examples
        examples = [
            {"input": "1\n", "expected_output": "1\n"},   # ok, matches, brute agrees
            {"input": "bad\n", "expected_output": "9\n"},  # optimal errors -> format flag
            {"input": "2\n", "expected_output": "2\n"},    # optimal ok but wrong output
        ]

        def fake_batch(code, inputs):
            if code == "OPT":
                return [("1\n", "ok"), ("", "error"), ("5\n", "ok")]
            return [("1\n", "ok"), ("", "error"), ("2\n", "ok")]  # BRUTE disagrees on case 3

        res = validate_examples(examples, "OPT", "BRUTE", "Add numbers.", _batch=fake_batch)
        rows = res["example_results"]
        self.assertEqual(len(rows), 3)
        self.assertTrue(rows[0]["input_format_ok"] and rows[0]["matches_expected"] and rows[0]["brute_agrees"])
        self.assertFalse(rows[1]["input_format_ok"])          # optimal errored
        self.assertFalse(rows[2]["matches_expected"])         # 5 != 2
        self.assertFalse(rows[2]["brute_agrees"])             # brute 2 != optimal 5
        self.assertFalse(res["optimal_ok"])
        self.assertFalse(res["brute_ok"])

    def test_the_checker_decides_open_ended_agreement(self):
        """Open-endedness used to short-circuit `brute_agrees` to True — the check
        passed without being run. The checker answers the same question for real."""
        from validate_solutions import validate_examples
        examples = [{"input": "1\n", "expected_output": "1\n"}]

        class Checker:
            @staticmethod
            def reference_answer(stdin_text):
                return "1"

            @staticmethod
            def is_valid_answer(stdin_text, candidate_stdout):
                return candidate_stdout.strip() in ("1", "99")

        def fake_batch(code, inputs):
            return [("1\n", "ok")] if code == "OPT" else [("99\n", "ok")]

        accepted = validate_examples(examples, "OPT", "BRUTE", "Return any valid answer.",
                                     _batch=fake_batch, checker=Checker)
        self.assertTrue(accepted["example_results"][0]["brute_agrees"])
        self.assertTrue(accepted["brute_ok"])

        def rejected_batch(code, inputs):
            return [("1\n", "ok")] if code == "OPT" else [("7\n", "ok")]

        rejected = validate_examples(examples, "OPT", "BRUTE", "Return any valid answer.",
                                     _batch=rejected_batch, checker=Checker)
        self.assertFalse(rejected["example_results"][0]["brute_agrees"],
                         "an answer the checker rejects is a real disagreement")
        self.assertFalse(rejected["brute_ok"])

    def test_no_examples_is_ok(self):
        from validate_solutions import validate_examples
        res = validate_examples([], "OPT", "BRUTE", "d", _batch=lambda c, i: [])
        self.assertEqual(res["example_results"], [])
        self.assertTrue(res["optimal_ok"] and res["brute_ok"])


class TestMergeMarker(unittest.TestCase):
    def test_merge_preserves_existing_keys_and_adds_slm(self):
        import json, tempfile
        import generate_brute_force as gbf
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as d:
            os.chdir(d)
            try:
                os.makedirs("Outputs", exist_ok=True)
                with open("Outputs/optimal_brute_check.json", "w", encoding="utf-8") as f:
                    json.dump({"status": "ok", "reason": "r", "mismatches": []}, f)
                gbf._merge_slm_into_marker({"examples_count": 2, "optimal": {"ok": True}})
                with open("Outputs/optimal_brute_check.json", encoding="utf-8") as f:
                    data = json.load(f)
                self.assertEqual(data["status"], "ok")          # preserved
                self.assertEqual(data["slm"]["examples_count"], 2)  # added
            finally:
                os.chdir(cwd)


if __name__ == "__main__":
    unittest.main()
