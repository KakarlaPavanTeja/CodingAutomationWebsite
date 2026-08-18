"""Regressions for the pre-testcase-generation audit (2026-08-18).

Each test pins one defect found by auditing everything that runs BEFORE
generate_testcases. They share a theme: a check that looked like it ran but didn't, or a
step that looked like it succeeded but hadn't. The functions were all individually fine —
368 tests passed while every one of these was live — so what is pinned here is the WIRING.

generate_full_question imports LLM prompt/client modules at load time (prod deps are not
present in every test env), so stub them and skip cleanly if the import still fails
(mirrors test_working_code_file.py).
"""

import json
import os
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code_cleaner import strip_code_fence  # noqa: E402


class _Auto(types.ModuleType):
    def __getattr__(self, name):
        return type(name, (), {"__init__": lambda self, *a, **k: None})


_BASE = tempfile.TemporaryDirectory()


def _import_gfq():
    for dep in ("httpx", "openai", "anthropic", "requests", "tiktoken", "dotenv"):
        sys.modules.setdefault(dep, _Auto(dep))
    os.environ["PIPELINE_BASE_DIR"] = _BASE.name
    try:
        import generate_full_question
        return generate_full_question
    except Exception:
        return None


_gfq = _import_gfq()


class StripCodeFenceTest(unittest.TestCase):
    """P2-8. The old idiom `text.split('\\n', 1)[1].rsplit('\\n', 1)[0]` raised
    IndexError on a single-line reply, killing the step with a bare traceback."""

    def test_single_line_fence_does_not_raise(self):
        # The exact shape that crashed: a fence opener and nothing else.
        self.assertEqual(strip_code_fence("```"), "")
        # ````python` carries no content, so there is no right answer — the
        # contract is only that it returns a string instead of raising. The caller
        # (json.loads / clean_generated_code) then fails loudly on the garbage.
        self.assertIsInstance(strip_code_fence("```python"), str)

    def test_single_line_fenced_code_is_still_unwrapped(self):
        # Why the no-newline branch strips 3 chars rather than bailing out.
        self.assertEqual(strip_code_fence("```print(1)```"), "print(1)")

    def test_no_newline_anywhere(self):
        self.assertEqual(strip_code_fence("print(1)"), "print(1)")

    def test_strips_language_tag_and_trailing_fence(self):
        self.assertEqual(strip_code_fence("```python\nprint(1)\n```"), "print(1)")

    def test_bare_fence_opener(self):
        self.assertEqual(strip_code_fence("```\nprint(1)\n```"), "print(1)")

    def test_unfenced_multiline_is_untouched(self):
        self.assertEqual(strip_code_fence("a\nb"), "a\nb")

    def test_none_and_empty(self):
        self.assertEqual(strip_code_fence(None), "")
        self.assertEqual(strip_code_fence(""), "")

    def test_old_idiom_would_have_raised(self):
        """Documents the bug so nobody reintroduces the one-liner."""
        with self.assertRaises(IndexError):
            "```".split("\n", 1)[1]


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class DetectUserSolutionTest(unittest.TestCase):
    """P0-2. Non-Python references were accepted, then died three steps later on a
    missing PYTHON.py, because there is no translate_python sub-step to produce it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = _gfq.INPUT_DIR
        _gfq.INPUT_DIR = self.tmp.name

    def tearDown(self):
        _gfq.INPUT_DIR = self._saved
        self.tmp.cleanup()

    def _write(self, name, body="x"):
        with open(os.path.join(self.tmp.name, name), "w", encoding="utf-8") as f:
            f.write(body)

    def test_prefers_solution_py_over_other_py_files(self):
        self._write("helper.py")
        self._write("solution.py")
        path, lang = _gfq.detect_user_solution()
        self.assertEqual(os.path.basename(path), "solution.py")
        self.assertEqual(lang, "python")

    def test_cpp_reference_is_rejected_not_accepted(self):
        self._write("solution.cpp")
        with self.assertRaises(SystemExit) as cm:
            _gfq.detect_user_solution()
        self.assertEqual(cm.exception.code, 1)

    def test_java_and_js_are_rejected_too(self):
        for name in ("Solution.java", "solution.js"):
            with self.subTest(name=name):
                self._write(name)
                with self.assertRaises(SystemExit):
                    _gfq.detect_user_solution()
                os.remove(os.path.join(self.tmp.name, name))

    def test_python_wins_when_both_present(self):
        self._write("solution.cpp")
        self._write("solution.py")
        _, lang = _gfq.detect_user_solution()
        self.assertEqual(lang, "python")

    def test_empty_inputs_exits(self):
        with self.assertRaises(SystemExit):
            _gfq.detect_user_solution()


class ContractPairsTest(unittest.TestCase):
    """P0-3. The optimal-vs-brute crosscheck seeded itself from example blocks that are
    always skipped on function problems, so it compared ZERO inputs and printed PASSED.
    io_contract.json's verified pairs are the executable stdins it should use."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._cwd = os.getcwd()
        os.makedirs(os.path.join(self.tmp.name, "Outputs"), exist_ok=True)
        os.chdir(self.tmp.name)
        import generate_brute_force
        self.gbf = generate_brute_force

    def tearDown(self):
        os.chdir(self._cwd)
        self.tmp.cleanup()

    def _write_contract(self, payload):
        with open(os.path.join("Outputs", "io_contract.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def test_missing_file_returns_empty(self):
        self.assertEqual(self.gbf._verified_contract_pairs(), [])

    def test_unverified_contract_is_not_used(self):
        # An unverified contract's stdin values are guesses — no layout reproduced the
        # stated answer — so seeding a sweep from them is worse than skipping.
        self._write_contract({
            "verified": False,
            "pairs": [{"example": 1, "stdin": "3\n1 2 3\n", "expected": "6"}],
            "mismatches": [], "reason": "",
        })
        self.assertEqual(self.gbf._verified_contract_pairs(), [])

    def test_verified_contract_yields_pairs(self):
        self._write_contract({
            "verified": True,
            "pairs": [{"example": 1, "stdin": "3\n1 2 3\n", "stdout": "6",
                       "expected": "6"}],
            "mismatches": [], "reason": "",
        })
        pairs = self.gbf._verified_contract_pairs()
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["stdin"], "3\n1 2 3\n")

    def test_blank_stdin_pairs_are_dropped(self):
        self._write_contract({
            "verified": True,
            "pairs": [{"example": 1, "stdin": "   ", "expected": "6"},
                      {"example": 2, "stdin": "2\n1 2\n", "expected": "3"}],
            "mismatches": [], "reason": "",
        })
        self.assertEqual(len(self.gbf._verified_contract_pairs()), 1)

    def test_corrupt_json_returns_empty_not_raise(self):
        with open(os.path.join("Outputs", "io_contract.json"), "w", encoding="utf-8") as f:
            f.write("{not json")
        self.assertEqual(self.gbf._verified_contract_pairs(), [])


class ContractGroundTruthTest(unittest.TestCase):
    """P0-3, second half: the ground-truth comparison must tolerate the display form.
    The description states a RETURN value (`[1, 2]`) and the solution PRINTS it (`1 2`),
    so a byte comparison would brand every correct function solution buggy."""

    def setUp(self):
        import generate_brute_force
        self.gbf = generate_brute_force

    def test_display_form_counts_as_a_match(self):
        code = "import sys\nprint(' '.join(sys.stdin.read().split()))\n"
        pairs = [{"stdin": "1 2\n", "expected": "[1, 2]"}]
        self.assertEqual(self.gbf._contract_ground_truth_failures(code, pairs), [])

    def test_genuinely_wrong_answer_is_reported(self):
        code = "print(999)\n"
        pairs = [{"stdin": "1 2\n", "expected": "[1, 2]"}]
        fails = self.gbf._contract_ground_truth_failures(code, pairs)
        self.assertEqual(len(fails), 1)
        self.assertIn("999", fails[0]["got"])

    def test_crashing_reference_is_reported_as_error(self):
        code = "import sys\nsys.exit(3)\n"
        pairs = [{"stdin": "1\n", "expected": "1"}]
        fails = self.gbf._contract_ground_truth_failures(code, pairs)
        self.assertEqual(len(fails), 1)
        self.assertTrue(fails[0]["got"].startswith("<"))


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class StaleSignatureFileTest(unittest.TestCase):
    """P2-10. description_signature.json is the ONLY function-vs-STDIN signal, and nothing
    removed it — so a problem switched function -> nonfunction kept the old file and got
    function-style cases anyway."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = _gfq.OUTPUT_DIR
        _gfq.OUTPUT_DIR = self.tmp.name

    def tearDown(self):
        _gfq.OUTPUT_DIR = self._saved
        self.tmp.cleanup()

    def _write_signature(self):
        with open(_gfq._signature_path(), "w", encoding="utf-8") as f:
            json.dump({"function_name": "oldName", "parameters": ["a"],
                       "return_type": "int"}, f)

    def test_nonfunction_run_removes_the_stale_file(self):
        self._write_signature()
        self.assertTrue(os.path.exists(_gfq._signature_path()))
        _gfq.run_naming_step("P", "standard", "nonfunction", "x = 1", "python")
        self.assertFalse(os.path.exists(_gfq._signature_path()),
                         "a nonfunction run must not leave a signature behind — "
                         "testcase_manager_v4 would read it and build function cases")

    def test_nonfunction_run_is_fine_when_no_file_exists(self):
        _gfq.run_naming_step("P", "standard", "nonfunction", "x = 1", "python")
        self.assertFalse(os.path.exists(_gfq._signature_path()))


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class TopicsStepTest(unittest.TestCase):
    """P2-9. Topics used to warn-and-continue on unparseable JSON, leaving the step GREEN
    with no generated_topics.json.

    These EXECUTE run_topics_step rather than asserting on its source. The first version of
    the fix called `_strip_code_fence` (a name that does not exist — the import is
    `strip_code_fence`), and every unit test passed because none of them ran the function.
    A live run caught it. Executing the step is the point of these tests.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._out, self._in = _gfq.OUTPUT_DIR, _gfq.INPUT_DIR
        _gfq.OUTPUT_DIR = os.path.join(self.tmp.name, "Outputs")
        _gfq.INPUT_DIR = os.path.join(self.tmp.name, "Inputs")
        os.makedirs(_gfq.OUTPUT_DIR)
        os.makedirs(_gfq.INPUT_DIR)
        with open(_gfq._description_path(), "w", encoding="utf-8") as f:
            f.write("**Your Task**\n- Complete `foo`.\n")
        with open(os.path.join(_gfq.INPUT_DIR, "topics_list.txt"), "w",
                  encoding="utf-8") as f:
            f.write("arrays\ngraphs\n")
        self._call_llm = _gfq.call_llm
        self._track = _gfq._track_llm_usage
        _gfq._track_llm_usage = lambda *a, **k: None

    def tearDown(self):
        _gfq.call_llm = self._call_llm
        _gfq._track_llm_usage = self._track
        _gfq.OUTPUT_DIR, _gfq.INPUT_DIR = self._out, self._in
        self.tmp.cleanup()

    def _topics_path(self):
        return os.path.join(_gfq.OUTPUT_DIR, "generated_topics.json")

    def test_fenced_json_is_parsed_and_written(self):
        _gfq.call_llm = lambda *a, **k: ('```json\n{"topics": ["graphs"]}\n```', {})
        _gfq.run_topics_step("P", "x = 1", "python")
        with open(self._topics_path(), encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"topics": ["graphs"]})

    def test_bare_json_is_parsed(self):
        _gfq.call_llm = lambda *a, **k: ('{"topics": ["arrays"]}', {})
        _gfq.run_topics_step("P", "x = 1", "python")
        self.assertTrue(os.path.exists(self._topics_path()))

    def test_unparseable_json_exits_rather_than_warning(self):
        _gfq.call_llm = lambda *a, **k: ("I could not determine the topics.", {})
        with self.assertRaises(SystemExit) as cm:
            _gfq.run_topics_step("P", "x = 1", "python")
        self.assertEqual(cm.exception.code, 1)
        self.assertFalse(os.path.exists(self._topics_path()))

    def test_single_line_fence_reply_does_not_crash_with_indexerror(self):
        # The old fence-strip idiom raised IndexError here instead of exiting cleanly.
        _gfq.call_llm = lambda *a, **k: ("```", {})
        with self.assertRaises(SystemExit):
            _gfq.run_topics_step("P", "x = 1", "python")


class SignatureExtractionPromptTest(unittest.TestCase):
    """P1-5, second half. The prompt told the model to look for a "Function Signature"
    heading, which the description format deliberately never emits. The name actually
    lives in the **Your Task** bullet, and the parameters in **Input Format**."""

    def setUp(self):
        from Prompts.signatureExtractionPrompt import get_signature_extraction_prompt
        self.prompt = get_signature_extraction_prompt("**Your Task**\n- Complete `foo`.")

    def test_points_at_the_sections_that_actually_exist(self):
        self.assertIn("**Your Task**", self.prompt)
        self.assertIn("**Input Format**", self.prompt)

    def test_no_longer_hunts_for_a_signature_heading(self):
        self.assertNotIn('Look for sections like', self.prompt)
        # It must say so explicitly, not merely omit it — the model would otherwise
        # still default to hunting for a signature block.
        self.assertIn("deliberately contains neither", self.prompt)

    def test_forbids_placeholder_names(self):
        # A placeholder would satisfy _parse_signature and silently rename the reference
        # solution's entry point to something the description never mentions.
        for bad in ("solve", "main", "functionName"):
            self.assertIn(bad, self.prompt)


class PromptFormatAgreementTest(unittest.TestCase):
    """P1-6. descriptionPrompt said write `[1, 2, 3]`; normalizationPrompt said print
    `[1,2,3]`. verify_io_contract then compared the two byte-for-byte."""

    def test_normalizer_demands_the_compact_output_form(self):
        from Prompts.normalizationPrompt import get_normalization_prompt

        self.assertIn("[1,2,3]", get_normalization_prompt("x = 1", "python"))

    def test_scenario_prompts_scope_the_array_rule_to_where_it_appears(self):
        """The rule must be scoped to WHERE the array sits.

        Both SCENARIO prompt bodies used to state a blanket rule — "ALWAYS format arrays
        with spaces after commas" (function) and "Arrays with spaces after commas"
        (non-function) — which the normalizer then flatly contradicts for stdout. On
        non-function problems verify_io_contract compares stdout byte-for-byte, so the
        disagreement burned repair attempts; on function problems it merely shipped a
        statement that lied about the printed answer.

        `scenario_level="none"` is deliberately NOT tested here: it routes to
        get_structure_only_prompt / get_nonfunction_structure_only_prompt, which carry no
        array-spacing rule at all and so never conflicted.
        """
        from Prompts.descriptionPrompt import (get_description_prompt,
                                               get_nonfunction_description_prompt)

        for name, prompt in (
            ("function", get_description_prompt("P", "standard", "x = 1", "moderate")),
            ("nonfunction",
             get_nonfunction_description_prompt("P", "standard", "x = 1", "moderate")),
        ):
            with self.subTest(prompt=name):
                self.assertNotIn("ALWAYS format arrays with spaces", prompt)
                # Both forms must be demonstrated. Matched structurally: the two prompts
                # use different sample arrays ([1,2,3,4,5] vs [1,2,3]), and pinning the
                # element count would make this test fail on a harmless wording change.
                self.assertRegex(prompt, r"\[\d+(,\d+)+\]", "no compact array example")
                self.assertRegex(prompt, r"\[\d+(, \d+)+\]", "no spaced array example")
                # And the compact form must be the one tied to the Output block.
                self.assertIn("NO spaces after commas", prompt)
                self.assertIn("**Output:**", prompt)

    def test_structure_only_prompts_state_no_conflicting_array_rule(self):
        """These two bodies are used when scenario_level == "none"."""
        from Prompts.descriptionPrompt import (get_structure_only_prompt,
                                               get_nonfunction_structure_only_prompt)

        for name, prompt in (
            ("function", get_structure_only_prompt("P", "standard", "x = 1")),
            ("nonfunction",
             get_nonfunction_structure_only_prompt("P", "standard", "x = 1")),
        ):
            with self.subTest(prompt=name):
                self.assertNotIn("spaces after commas", prompt)


if __name__ == "__main__":
    unittest.main()
