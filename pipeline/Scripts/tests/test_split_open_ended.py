"""The checker goes in the driver, and the driver prints an ANSWER — never a verdict.

`solution_code` and `default_code` are shown to the student (splittingPrompt.py:209-210), so
a checker leaking into either hands away the reference at a click. And a driver that prints
`VALID`/`INVALID` hides what the student actually produced, which is the one thing they need
when a case fails.
"""

import os
import sys
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

import code_splitter  # noqa: E402
from Prompts.splittingPrompt import get_splitting_prompt  # noqa: E402

GOOD = {
    "default_code": "class solution:\n    def f(self, a):\n        pass\n",
    "solution_code": "class solution:\n    def f(self, a):\n        return a\n",
    "driver_code": (
        "from solution import solution\nimport io, sys, time\n"
        "RAW_STDIN = sys.stdin.read()\nsys.stdin = io.StringIO(RAW_STDIN)\n"
        "def reference_answer(stdin_text):\n    return '0 1'\n"
        "def is_valid_answer(stdin_text, candidate_stdout):\n    return True\n"
        "start_time_ns = time.perf_counter_ns()\nresult = sol.f(a)\n"
        "end_time_ns = time.perf_counter_ns()\n"
        "_candidate = str(result)\n"
        "if is_valid_answer(RAW_STDIN, _candidate):\n"
        "    sys.stdout.write(reference_answer(RAW_STDIN) + '\\n')\n"
        "else:\n    sys.stdout.write(_candidate + '\\n')\n"
    ),
    "debugger_code": "N/A",
}


class TestSplitDefects(unittest.TestCase):
    def test_a_well_formed_open_ended_split_has_no_defects(self):
        self.assertEqual(code_splitter.split_defects("Python", GOOD, True), [])

    def test_a_driver_without_the_checker_is_a_defect(self):
        bad = dict(GOOD, driver_code=GOOD["driver_code"].replace("def reference_answer", "def ra"))
        self.assertIn("reference_answer", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_the_checker_leaking_into_solution_code_is_a_defect(self):
        bad = dict(GOOD, solution_code=GOOD["solution_code"] + "\ndef reference_answer(s):\n    return '0 1'\n")
        self.assertIn("solution_code", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_the_checker_leaking_into_default_code_is_a_defect(self):
        bad = dict(GOOD, default_code=GOOD["default_code"] + "\ndef reference_answer(s):\n    return '0 1'\n")
        self.assertIn("default_code", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_a_driver_that_prints_a_verdict_is_a_defect(self):
        bad = dict(GOOD, driver_code=GOOD["driver_code"] + "\nsys.stdout.write('VALID')\n")
        self.assertIn("verdict", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_every_verdict_word_is_caught_and_reported_once(self):
        """`\\bVALID\\b` must not also fire on `INVALID`, or every report is doubled."""
        for word in ("VALID", "INVALID", "CORRECT", "INCORRECT", "WRONG"):
            bad = dict(GOOD, driver_code=GOOD["driver_code"] + f"\nsys.stdout.write('{word}')\n")
            verdicts = [d for d in code_splitter.split_defects("Python", bad, True)
                        if "verdict" in d]
            self.assertEqual(len(verdicts), 1, f"{word}: {verdicts}")
            self.assertIn(word, verdicts[0])

    def test_a_checker_inside_the_timing_window_is_a_defect(self):
        bad = dict(GOOD, driver_code=GOOD["driver_code"].replace(
            "result = sol.f(a)", "result = sol.f(a)\nis_valid_answer(RAW_STDIN, '')"))
        self.assertIn("timing", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_a_single_answer_problem_is_not_checked_at_all(self):
        plain = dict(GOOD, driver_code="result = sol.f(a)\nprint(result)\n")
        self.assertEqual(code_splitter.split_defects("Python", plain, False), [])

    def test_phase_1_gates_python_only(self):
        """Task 9 owns C++/Java/Node.js. Until then the gate must not hard-fail a split it
        has no rules for — `def reference_answer` is Python syntax."""
        for lang in ("C++", "Java", "Node.js"):
            self.assertEqual(code_splitter.split_defects(lang, GOOD, True), [], lang)


class TestSplittingPrompt(unittest.TestCase):
    def test_the_checker_area_appears_only_when_open_ended(self):
        off, _ = get_splitting_prompt("Python", "code", desc_response="d")
        on, _ = get_splitting_prompt("Python", "code", desc_response="d", open_ended=True)
        self.assertNotIn("Checker Area Start", off)
        self.assertIn("Checker Area Start", on)

    def test_the_prompt_forbids_printing_a_verdict(self):
        on, _ = get_splitting_prompt("Python", "code", desc_response="d", open_ended=True)
        self.assertIn("VALID", on)
        self.assertIn("RAW_STDIN", on)

    def test_the_existing_markers_are_untouched(self):
        """`# Output Area Start ` carries a trailing space in the template; a plan that
        'tidied' it would silently change the template the model is asked to follow."""
        on, _ = get_splitting_prompt("Python", "code", desc_response="d", open_ended=True)
        self.assertIn("# Output Area Start ", on)
        self.assertIn("# Function Call Area Start", on)

    def test_python_only_rules_never_reach_another_languages_prompt(self):
        """The block is Python source (`sys.stdin.read()`, `io.StringIO`). Task 9 adds the
        C++/Java/Node.js forms; until then it must not be pasted into their prompts."""
        for lang in ("C++", "Java", "Node.js"):
            on, _ = get_splitting_prompt(lang, "code", desc_response="d", open_ended=True)
            self.assertNotIn("Checker Area Start", on, lang)


if __name__ == "__main__":
    unittest.main()
