"""Regression tests for testcase grounding — the check that the reference solution
can actually read each generated `input` on stdin and print the stored `output`.

This guards against the input-format drift that made function-based problems fail:
the test-case inputs used a format (e.g. `arr = [1,2]` named assignments) the
reference solution's stdin parser could not read, so the solution crashed/echoed and
benchmark/harden flagged the problem as buggy.

testcase_manager_v4 imports heavyweight LLM clients at module load (httpx/openai/...),
prod deps not present in every test env, so we stub them with subclassable auto-classes
and skip cleanly if the import still fails (mirrors test_size_fix_rounds.py)."""

import json
import os
import sys
import tempfile
import types
import unittest


class _Auto(types.ModuleType):
    def __getattr__(self, name):
        # Return a real, subclassable class so `class X(dep.Base)` at import works.
        return type(name, (), {"__init__": lambda self, *a, **k: None})


def _import_manager():
    for dep in ("httpx", "openai", "anthropic", "requests", "tiktoken", "dotenv"):
        sys.modules.setdefault(dep, _Auto(dep))
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        import testcase_manager_v4  # noqa: E402
        return testcase_manager_v4
    except Exception:
        return None


_m = _import_manager()

# A reference solution that reads token stdin: first token n, then n array values,
# and prints them space-separated. Represents how real solutions parse input.
_TOKEN_SOLUTION = (
    "import sys\n"
    "def main():\n"
    "    data = sys.stdin.read().split()\n"
    "    n = int(data[0])\n"
    "    arr = data[1:1 + n]\n"
    "    sys.stdout.write(' '.join(arr))\n"
    "main()\n"
)


@unittest.skipIf(_m is None, "testcase_manager_v4 deps unavailable in this env")
class GroundingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sol = os.path.join(self.tmp.name, "PYTHON.py")
        with open(self.sol, "w") as f:
            f.write(_TOKEN_SOLUTION)
        self.out = os.path.join(self.tmp.name, "testcases.json")

    def tearDown(self):
        self.tmp.cleanup()

    def _write_suite(self, cases):
        with open(self.out, "w") as f:
            json.dump([{"test_cases": cases}], f)

    def test_normalize_strips_trailing_ws_and_blank_lines(self):
        self.assertEqual(_m._normalize_output("a \nb\n\n"), "a\nb")
        self.assertEqual(_m._normalize_output(None), "")

    def test_matching_format_passes(self):
        # Input in the solution's own stdin format -> runs clean, output matches.
        self._write_suite([{"input": "3\n1 2 3\n", "output": "1 2 3", "order": 1}])
        self.assertEqual(_m._ground_against_reference(self.out, self.sol), [])

    def test_named_assignment_format_is_flagged(self):
        # The drift format the solution cannot parse -> crash -> flagged as failure.
        self._write_suite([{"input": "arr = [1, 2, 3]\nn = 3\n", "output": "1 2 3", "order": 1}])
        fails = _m._ground_against_reference(self.out, self.sol)
        self.assertEqual(len(fails), 1)
        self.assertEqual(fails[0]["got"], "<error>")

    def test_wrong_expected_output_is_flagged(self):
        # Right format, but stored output disagrees with what the solution prints.
        self._write_suite([{"input": "2\n7 8\n", "output": "9 9", "order": 1}])
        fails = _m._ground_against_reference(self.out, self.sol)
        self.assertEqual(len(fails), 1)
        self.assertEqual(fails[0]["got"], "7 8")


if __name__ == "__main__":
    unittest.main()
