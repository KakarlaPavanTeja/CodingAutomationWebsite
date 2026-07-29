"""Pre-flight guards on the LLM-generated testcase script.

The bugs these guard, all from real runs on 2026-07-29 where 12 of 32
generate_testcases runs spent an extra LLM call repairing the script:

  * `SyntaxError: invalid character '-' (U+2013)` — an en-dash in an expression.
    Deterministically fixable, so it must never reach an LLM.
  * `SyntaxError: unterminated string literal` / `closing parenthesis '}' does not
    match opening parenthesis '('` / `invalid syntax` — a script that cannot parse
    must be reported with a location, not executed for its traceback.
  * Repair calls shipped a ~294-token stub while the primary call shipped ~6.4k, so
    a repair could drift off the I/O-format contract while fixing a crash.

testcase_manager_v4 imports heavyweight LLM clients at module load (httpx/openai),
so stub them rather than require them in the test environment.
"""

import importlib.util
import os
import sys
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)


def _load_manager():
    for name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.__getattr__ = lambda n: type(n, (Exception,), {})
            sys.modules[name] = mod
    path = os.path.join(SCRIPT_DIR, "testcase_manager_v4.py")
    spec = importlib.util.spec_from_file_location("tm_preflight", path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        return None
    return mod


_m = _load_manager()


@unittest.skipIf(_m is None, "testcase_manager_v4 deps unavailable in this env")
class TestAsciifyPunctuation(unittest.TestCase):
    def test_en_dash_in_expression_becomes_parseable(self):
        fixed = _m._asciify_punctuation("x = 5 – 3\n")
        self.assertEqual(fixed, "x = 5 - 3\n")
        self.assertIsNone(_m._syntax_error_of(fixed))

    def test_curly_quotes_and_glyphs(self):
        fixed = _m._asciify_punctuation("a = ‘x’ if n ≤ 3 else “y”")
        self.assertEqual(fixed, "a = 'x' if n <= 3 else \"y\"")

    def test_sanitize_asciifies_through_the_fence_path(self):
        self.assertEqual(
            _m._sanitize_generated_script("```python\nn = 4 – 1\n```"),
            "n = 4 - 1",
        )

    def test_clean_ascii_source_is_untouched(self):
        src = "import sys\nprint(sys.argv)\n"
        self.assertEqual(_m._asciify_punctuation(src), src)


@unittest.skipIf(_m is None, "testcase_manager_v4 deps unavailable in this env")
class TestSyntaxPreflight(unittest.TestCase):
    def test_valid_source_reports_no_error(self):
        self.assertIsNone(_m._syntax_error_of("x = 1\ndef f():\n    return x\n"))

    def test_unterminated_string_is_caught_with_a_location(self):
        err = _m._syntax_error_of("s = '''abc\n")
        self.assertIn("unterminated", err)
        self.assertIn("line 1", err)

    def test_mismatched_bracket_is_caught(self):
        self.assertIn("does not match", _m._syntax_error_of("print(1}\n"))

    def test_invalid_syntax_is_caught(self):
        self.assertIn("SyntaxError", _m._syntax_error_of("def f(:\n"))


@unittest.skipIf(_m is None, "testcase_manager_v4 deps unavailable in this env")
class TestRepairCarriesContract(unittest.TestCase):
    def setUp(self):
        self._saved = _m._PRIMARY_SYSTEM_PROMPT

    def tearDown(self):
        _m._PRIMARY_SYSTEM_PROMPT = self._saved

    def test_repair_prompt_includes_the_primary_contract(self):
        _m._PRIMARY_SYSTEM_PROMPT = "IO FORMAT RULES + SIZE LADDER + METADATA SPEC"
        prompt = _m._repair_system_prompt("fix the crash")
        self.assertIn("IO FORMAT RULES", prompt)      # contract survives the repair
        self.assertIn("REPAIR TASK", prompt)          # and the task is still stated
        self.assertIn("fix the crash", prompt)

    def test_falls_back_to_bare_instructions_when_unset(self):
        _m._PRIMARY_SYSTEM_PROMPT = ""
        self.assertEqual(_m._repair_system_prompt("fix the crash"), "fix the crash")


if __name__ == "__main__":
    unittest.main()
