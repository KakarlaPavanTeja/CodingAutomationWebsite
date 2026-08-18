"""A checker nobody exercised is a checker that grades everyone wrong.

Two assertions, both of which fail SILENTLY without them:
  1. `reference_answer(input)` must equal the stored output — that is exactly what the
     driver prints, and cases 1-2 come from the description's worked examples, so a
     disagreement fails test case 1 for every student including a perfect solution.
  2. `is_valid_answer(input, stored_output)` must be True — a checker too strict to accept
     its own reference's answer rejects correct submissions.
"""

import io
import os
import sys
import tempfile
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "anthropic", "dotenv", "psycopg2", "requests", "tiktoken"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (), {"__init__": lambda self, *a, **k: None})
        sys.modules[_name] = _stub

from open_ended_checker import effective_output, load_checker  # noqa: E402

CHECKER_SRC = '''
def reference_answer(stdin_text):
    return "0 1"


def is_valid_answer(stdin_text, candidate_stdout):
    return candidate_stdout.strip() in ("0 1", "1 0")
'''

# A reference whose driver reads stdin at import time — the normalization prompt does not
# require a `if __name__ == "__main__"` guard, so this is the shape we actually get.
STDIN_PROBE_SRC = '''
import sys

SEEN = sys.stdin.read()


def reference_answer(stdin_text):
    return "0 1"


def is_valid_answer(stdin_text, candidate_stdout):
    return True
'''


class _TempSources(unittest.TestCase):
    def setUp(self):
        self._paths = []

    def tearDown(self):
        for p in self._paths:
            try:
                os.unlink(p)
            except OSError:
                pass

    def _write(self, src):
        fd, path = tempfile.mkstemp(suffix=".py")
        with os.fdopen(fd, "w") as f:
            f.write(src)
        self._paths.append(path)
        return path


class TestLoadChecker(_TempSources):
    def test_loads_both_functions(self):
        c = load_checker(self._write(CHECKER_SRC))
        self.assertIsNotNone(c)
        self.assertEqual(c.reference_answer("x"), "0 1")
        self.assertTrue(c.is_valid_answer("x", "1 0"))

    def test_a_source_without_a_checker_loads_as_none(self):
        self.assertIsNone(load_checker(self._write("def main():\n    pass\n")))

    def test_a_missing_file_loads_as_none(self):
        self.assertIsNone(load_checker("/nonexistent/nope.py"))

    def test_a_crashing_module_loads_as_none_rather_than_raising(self):
        self.assertIsNone(load_checker(self._write("raise RuntimeError('boom')\n")))

    def test_the_reference_is_imported_with_empty_stdin(self):
        """Importing a reference must never consume — or block on — the caller's stdin."""
        path = self._write(STDIN_PROBE_SRC)
        original = sys.stdin
        probe = io.StringIO("HELLO")
        sys.stdin = probe
        try:
            checker = load_checker(path)
            self.assertIs(sys.stdin, probe, "load_checker must restore sys.stdin")
        finally:
            sys.stdin = original
        self.assertIsNotNone(checker)
        self.assertEqual(checker.SEEN, "")
        self.assertEqual(probe.read(), "HELLO", "the caller's stdin must be untouched")


class TestEffectiveOutput(_TempSources):
    def setUp(self):
        super().setUp()
        self.checker = load_checker(self._write(CHECKER_SRC))

    def test_a_valid_but_different_answer_reads_as_the_stored_output(self):
        self.assertEqual(effective_output(self.checker, "x", "1 0", "0 1"), "0 1")

    def test_an_invalid_answer_reads_as_the_candidates_own_output(self):
        """The student must see what THEY produced in the failure, not a verdict."""
        self.assertEqual(effective_output(self.checker, "x", "5 5", "0 1"), "5 5")

    def test_no_checker_is_a_passthrough(self):
        self.assertEqual(effective_output(None, "x", "5 5", "0 1"), "5 5")

    def test_a_checker_that_raises_is_treated_as_rejecting(self):
        """A crashing checker must never silently accept everything."""
        class Boom:
            @staticmethod
            def is_valid_answer(a, b):
                raise ValueError("bad input")
        self.assertEqual(effective_output(Boom, "x", "5 5", "0 1"), "5 5")


class TestCheckerGrounding(_TempSources):
    def setUp(self):
        super().setUp()
        import testcase_manager_v4 as tm
        self.tm = tm
        self.checker = load_checker(self._write(CHECKER_SRC))

    def test_a_reference_answer_that_disagrees_with_the_stored_output_is_a_failure(self):
        cases = [{"order": 1, "input": "x\n", "output": "9 9"}]
        fails = self.tm._ground_checker(cases, self.checker)
        self.assertEqual(len(fails), 1)
        self.assertIn("reference_answer", fails[0]["detail"])

    def test_a_checker_that_rejects_its_own_reference_answer_is_a_failure(self):
        class TooStrict:
            @staticmethod
            def reference_answer(s):
                return "0 1"

            @staticmethod
            def is_valid_answer(s, c):
                return False
        fails = self.tm._ground_checker(
            [{"order": 1, "input": "x\n", "output": "0 1"}], TooStrict)
        self.assertEqual(len(fails), 1)
        self.assertIn("is_valid_answer", fails[0]["detail"])

    def test_a_reference_answer_that_raises_is_a_failure(self):
        class Boom:
            @staticmethod
            def reference_answer(s):
                raise ValueError("nope")

            @staticmethod
            def is_valid_answer(s, c):
                return True
        fails = self.tm._ground_checker(
            [{"order": 1, "input": "x\n", "output": "0 1"}], Boom)
        self.assertEqual(len(fails), 1)
        self.assertIn("raised ValueError", fails[0]["detail"])

    def test_a_consistent_checker_grounds_clean(self):
        cases = [{"order": 1, "input": "x\n", "output": "0 1"},
                 {"order": 2, "input": "y\n", "output": "0 1"}]
        self.assertEqual(self.tm._ground_checker(cases, self.checker), [])

    def test_no_checker_grounds_clean(self):
        self.assertEqual(
            self.tm._ground_checker([{"order": 1, "input": "x", "output": "1"}], None), [])


if __name__ == "__main__":
    unittest.main()
