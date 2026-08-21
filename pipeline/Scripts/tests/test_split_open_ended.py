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
from Prompts.conversionPrompt import get_conversion_prompt  # noqa: E402
from Prompts.splittingPrompt import get_splitting_prompt  # noqa: E402
from problem_flags import translated_checker_defects  # noqa: E402

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


# One well-formed split per language. Each is the smallest driver that satisfies the rules
# splittingPrompt hands the model: both declarations present, raw stdin replayed, and the
# checker called only after the timing window closes.
BY_LANG = {
    "Python": GOOD,
    "C++": {
        "default_code": "class solution {\n public:\n  string f(int n) {}\n};\n",
        "solution_code": "class solution {\n public:\n  string f(int n) { return \"1\"; }\n};\n",
        "driver_code": (
            '#include "solution.cpp"\n'
            "// Checker Area Start\n"
            "string referenceAnswer(const string& stdinText) { return \"1\"; }\n"
            "bool isValidAnswer(const string& stdinText, const string& candidateStdout) { return true; }\n"
            "// Checker Area End\n"
            "int main() {\n"
            "  string RAW_STDIN((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());\n"
            "  istringstream _replay(RAW_STDIN);\n"
            "  cin.rdbuf(_replay.rdbuf());\n"
            "  auto start = high_resolution_clock::now();\n"
            "  auto result = sol.f(n);\n"
            "  auto stop = high_resolution_clock::now();\n"
            "  ostringstream _out; _out << result;\n"
            "  string _candidate = _out.str();\n"
            "  if (isValidAnswer(RAW_STDIN, _candidate)) { cout << referenceAnswer(RAW_STDIN) << \"\\n\"; }\n"
            "  else { cout << _candidate << \"\\n\"; }\n"
            "}\n"
        ),
        "debugger_code": "N/A",
    },
    "Java": {
        "default_code": "public class Solution {\n    public String f(int n) { }\n}\n",
        "solution_code": "public class Solution {\n    public String f(int n) { return \"1\"; }\n}\n",
        "driver_code": (
            "public class Main {\n"
            "    // Checker Area Start\n"
            "    static String referenceAnswer(String stdinText) { return \"1\"; }\n"
            "    static boolean isValidAnswer(String stdinText, String candidateStdout) { return true; }\n"
            "    // Checker Area End\n"
            "    public static void main(String[] args) throws IOException {\n"
            "        String RAW_STDIN = new String(System.in.readAllBytes());\n"
            "        System.setIn(new java.io.ByteArrayInputStream(RAW_STDIN.getBytes()));\n"
            "        FastReader sc = new FastReader();\n"
            "        long start_time = System.nanoTime();\n"
            "        String result = sol.f(n);\n"
            "        long end_time = System.nanoTime();\n"
            "        String _candidate = String.valueOf(result);\n"
            "        if (isValidAnswer(RAW_STDIN, _candidate)) { System.out.println(referenceAnswer(RAW_STDIN)); }\n"
            "        else { System.out.println(_candidate); }\n"
            "    }\n"
            "}\n"
        ),
        "debugger_code": "N/A",
    },
    "Node.js": {
        "default_code": "class Solution {\n    static f(n) { }\n}\n",
        "solution_code": "class Solution {\n    static f(n) { return \"1\"; }\n}\n",
        "driver_code": (
            "// Checker Area Start\n"
            "function referenceAnswer(stdinText) { return \"1\"; }\n"
            "function isValidAnswer(stdinText, candidateStdout) { return true; }\n"
            "// Checker Area End\n"
            "async function main() {\n"
            '    const RAW_STDIN = fs.readFileSync(0, "utf8");\n'
            "    const startTime = process.hrtime.bigint();\n"
            "    const result = Solution.f(n);\n"
            "    const endTime = process.hrtime.bigint();\n"
            "    const _candidate = String(result);\n"
            '    if (isValidAnswer(RAW_STDIN, _candidate)) { process.stdout.write(referenceAnswer(RAW_STDIN) + "\\n"); }\n'
            '    else { process.stdout.write(_candidate + "\\n"); }\n'
            "}\n"
        ),
        "debugger_code": "N/A",
    },
}


class TestEveryLanguageIsGated(unittest.TestCase):
    """Phase 2: C++, Java and Node.js grade with the checker too, so the gate that keeps the
    Python split honest has to hold for them as well. A language that fell through the gate
    would ship a driver comparing against the ONE stored answer, and every valid alternative
    a student wrote in that language would be marked wrong."""

    def test_a_well_formed_split_has_no_defects(self):
        for lang, split in BY_LANG.items():
            self.assertEqual(code_splitter.split_defects(lang, split, True), [], lang)

    def test_a_driver_without_the_checker_is_a_defect(self):
        for lang, split in BY_LANG.items():
            bad = dict(split, driver_code=split["driver_code"]
                       .replace("referenceAnswer", "refAns")
                       .replace("reference_answer", "ref_ans"))
            self.assertIn("missing", " ".join(
                code_splitter.split_defects(lang, bad, True)), lang)

    def test_the_checker_leaking_to_the_student_is_a_defect(self):
        for lang, split in BY_LANG.items():
            for key in ("solution_code", "default_code"):
                bad = dict(split, **{key: split[key] + split["driver_code"]})
                self.assertIn(key, " ".join(
                    code_splitter.split_defects(lang, bad, True)), f"{lang}/{key}")

    def test_a_checker_inside_the_timing_window_is_a_defect(self):
        call = {"Python": "is_valid_answer(RAW_STDIN, '')",
                "C++": "isValidAnswer(RAW_STDIN, _c);",
                "Java": "isValidAnswer(RAW_STDIN, _c);",
                "Node.js": "isValidAnswer(RAW_STDIN, _c);"}
        hook = {"Python": "result = sol.f(a)",
                "C++": "auto result = sol.f(n);",
                "Java": "String result = sol.f(n);",
                "Node.js": "const result = Solution.f(n);"}
        for lang, split in BY_LANG.items():
            bad = dict(split, driver_code=split["driver_code"].replace(
                hook[lang], hook[lang] + "\n" + call[lang]))
            self.assertIn("timing", " ".join(
                code_splitter.split_defects(lang, bad, True)), lang)

    def test_a_driver_that_prints_a_verdict_is_a_defect(self):
        for lang, split in BY_LANG.items():
            bad = dict(split, driver_code=split["driver_code"] + "\n// INVALID\n")
            self.assertIn("verdict", " ".join(
                code_splitter.split_defects(lang, bad, True)), lang)

    def test_a_single_answer_problem_is_never_checked(self):
        for lang, split in BY_LANG.items():
            self.assertEqual(code_splitter.split_defects(lang, split, False), [], lang)


class TestTranslatedChecker(unittest.TestCase):
    """The conversion step drops anything it reads as dead code, and the two checker
    functions look exactly like that. If they are gone by the time the split runs there is
    nothing to move into the driver, so the drop is caught where it happens."""

    def test_a_translation_carrying_the_checker_is_clean(self):
        for lang, split in BY_LANG.items():
            if lang == "Python":
                continue
            self.assertEqual(
                translated_checker_defects(lang, split["driver_code"]), [], lang)

    def test_a_dropped_checker_is_a_defect(self):
        for lang in ("C++", "Java", "Node.js"):
            defects = translated_checker_defects(lang, "class Solution {}")
            self.assertEqual(len(defects), 2, lang)
            self.assertIn("missing", defects[0])

    def test_an_unknown_language_is_not_second_guessed(self):
        self.assertEqual(translated_checker_defects("Rust", "fn main() {}"), [])


class TestConversionPrompt(unittest.TestCase):
    def test_the_checker_is_only_requested_when_open_ended(self):
        for lang in ("C++", "Java", "Node.js"):
            on = get_conversion_prompt(lang, "code", "standard", open_ended=True)
            off = get_conversion_prompt(lang, "code", "standard")
            self.assertIn("isValidAnswer", on, lang)
            self.assertNotIn("isValidAnswer", off, lang)

    def test_the_prompt_asks_for_the_declaration_the_gate_checks_for(self):
        """The prompt and `CHECKER_DECLS` are two halves of one contract. If they drift, the
        gate passes code that was never asked for — or fails code that was."""
        import re
        from problem_flags import CHECKER_DECLS
        for lang in ("C++", "Java", "Node.js"):
            prompt = get_conversion_prompt(lang, "code", "standard", open_ended=True)
            for name, pattern in CHECKER_DECLS[lang].items():
                self.assertTrue(re.search(pattern, prompt), f"{lang}/{name}")


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

    def test_each_language_gets_its_own_checker_block(self):
        """Every block is source in its own language: pasting Python's `sys.stdin.read()`
        into the C++ prompt asks the model to emit Python."""
        foreign = {"Python": "istreambuf_iterator", "C++": "sys.stdin.read",
                   "Java": "sys.stdin.read", "Node.js": "istreambuf_iterator"}
        for lang in ("Python", "C++", "Java", "Node.js"):
            on, _ = get_splitting_prompt(lang, "code", desc_response="d", open_ended=True)
            self.assertIn("Checker Area Start", on, lang)
            # Slice the block out: the prompt carries ALL FOUR driver templates further
            # down, so searching the whole string would find every language in every prompt.
            block = on[on.index("OPEN-ENDED PROBLEM"):on.index("(Output Format):")]
            self.assertNotIn(foreign[lang], block, lang)

    def test_the_block_names_the_language_s_own_timing_markers(self):
        """Rule 6 tells the model which window to stay out of, and `split_defects` then
        gates on that same window. Both read `CHECKER_TIMING_WINDOW`'s markers."""
        from problem_flags import CHECKER_TIMING_WINDOW
        for lang in ("Python", "C++", "Java", "Node.js"):
            on, _ = get_splitting_prompt(lang, "code", desc_response="d", open_ended=True)
            block = on[on.index("OPEN-ENDED PROBLEM"):on.index("(Output Format):")]
            for marker in CHECKER_TIMING_WINDOW[lang]:
                self.assertIn(marker.split(" = ")[0], block, f"{lang}/{marker}")


if __name__ == "__main__":
    unittest.main()
