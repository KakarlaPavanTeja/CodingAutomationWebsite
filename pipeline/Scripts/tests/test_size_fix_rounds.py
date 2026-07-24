"""Regression tests for _size_fix_rounds — the bound on size-diversity re-prompts.

Each round is an extra LLM call + script run, so the loop must be cheap to cap and to
turn off entirely. _size_fix_rounds reads TESTCASE_SIZE_FIX_ROUNDS: default 0 (disabled),
clamp negatives to 0, ignore garbage. testcase_manager_v4 imports heavyweight LLM clients at
module load (httpx/openai/...), which are prod deps not present in every test env, so we
stub them with auto-attribute modules and skip cleanly if the import still fails.
"""

import os
import sys
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

_ENV = "TESTCASE_SIZE_FIX_ROUNDS"


class _AutoStub(types.ModuleType):
    """Module whose every attribute resolves to a throwaway class, so
    `from <dep> import Whatever` succeeds without the real package."""

    def __getattr__(self, name):
        return type(name, (), {})


def _import_manager():
    for dep in ("httpx", "openai", "anthropic", "requests", "tiktoken", "dotenv"):
        sys.modules.setdefault(dep, _AutoStub(dep))
    import testcase_manager_v4  # noqa: E402
    return testcase_manager_v4


try:
    _m = _import_manager()
except Exception:  # pragma: no cover - depends on optional deps
    _m = None


@unittest.skipIf(_m is None, "testcase_manager_v4 deps unavailable in this env")
class SizeFixRoundsTest(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.get(_ENV)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop(_ENV, None)
        else:
            os.environ[_ENV] = self._saved

    def _with(self, value):
        if value is None:
            os.environ.pop(_ENV, None)
        else:
            os.environ[_ENV] = value
        return _m._size_fix_rounds()

    def test_default_is_zero_when_unset(self):
        self.assertEqual(self._with(None), 0)

    def test_explicit_value_is_used(self):
        self.assertEqual(self._with("3"), 3)

    def test_zero_disables(self):
        self.assertEqual(self._with("0"), 0)

    def test_negative_clamped_to_zero(self):
        self.assertEqual(self._with("-5"), 0)

    def test_non_integer_falls_back_to_default(self):
        self.assertEqual(self._with("abc"), 0)

    def test_blank_falls_back_to_default(self):
        self.assertEqual(self._with("   "), 0)


if __name__ == "__main__":
    unittest.main()
