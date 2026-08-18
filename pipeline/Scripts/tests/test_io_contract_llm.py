"""The small model proposes ONE stdin layout; execution decides whether it is right.

This module covers the MODEL stage only. It runs second: the deterministic layouts from
`named_var_stdin_candidates` are tried first and cost nothing, so every fixture here uses
a layout no mechanical serialization of the block can emit (the size line AFTER the data)
— otherwise the pre-check resolves it and the model is never consulted.

The model reads the reference solution's actual parser, so there is no ambiguity left
to hedge against with multiple blind candidates. On a mismatch it gets ONE informed
retry that sees its own wrong stdout against the expected one.
"""

import os
import sys
import tempfile
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

# testcase_manager_v4 -> llm_client -> httpx. No network call happens here (the LLM is
# injected), so stub the deps this checkout may not have installed rather than depending
# on another test module having stubbed them first.
for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

import testcase_manager_v4 as tm  # noqa: E402

SOLUTION = "import sys\nd=sys.stdin.read().split()\nprint(sum(map(int,d[1:])))\n"


class FakeLLM:
    """Returns queued replies; records the prompts it was given."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    def __call__(self, system, user, purpose=None):
        self.prompts.append(user)
        return self.replies.pop(0), {"prompt_tokens": 1, "completion_tokens": 1,
                                     "model": "fake", "cost": 0.0}


class TestResolveExampleStdin(unittest.TestCase):
    def setUp(self):
        self._orig = tm._run_reference_on_input
        fd, self.sol = tempfile.mkstemp(suffix=".py")
        with os.fdopen(fd, "w") as f:
            f.write(SOLUTION)

    def tearDown(self):
        tm._run_reference_on_input = self._orig
        os.unlink(self.sol)

    def test_the_deterministic_layouts_are_tried_before_the_model(self):
        """The common case must not cost a token. `nums = [1, 2, 3]` serializes to
        `1 2 3` verbatim; if the reference accepts it, the model is never consulted."""
        tm._run_reference_on_input = lambda path, stdin, timeout: (
            ("6", "ok") if stdin == "1 2 3\n" else ("0", "ok"))
        llm = FakeLLM("should never be asked\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "1 2 3\n")
        self.assertEqual(stdout, "6")
        self.assertIsNone(detail)
        self.assertEqual(llm.prompts, [], "no LLM call when a free layout already works")

    def test_accepts_a_layout_the_reference_reproduces(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: (
            ("6", "ok") if stdin == "1 2 3\n3\n" else ("0", "ok"))
        llm = FakeLLM("1 2 3\n3\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "1 2 3\n3\n")
        self.assertEqual(stdout, "6")
        self.assertIsNone(detail)
        self.assertEqual(len(llm.prompts), 1, "one call on the happy path")

    def test_retries_once_with_the_wrong_output_fed_back(self):
        def fake_run(path, stdin, timeout):
            return ("6", "ok") if stdin == "1 2 3\n3\n" else ("0", "ok")

        tm._run_reference_on_input = fake_run
        llm = FakeLLM("9 9\n", "1 2 3\n3\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "1 2 3\n3\n")
        self.assertEqual(len(llm.prompts), 2, "exactly one retry")
        self.assertIn("0", llm.prompts[1], "retry must show what the layout printed")
        self.assertIn("6", llm.prompts[1], "retry must show what was expected")

    def test_the_first_prompt_names_the_layouts_the_pre_check_disproved(self):
        """Otherwise the model re-proposes `1 2 3`, which execution has already rejected,
        and burns both attempts on a dead end."""
        tm._run_reference_on_input = lambda path, stdin, timeout: (
            ("6", "ok") if stdin == "1 2 3\n3\n" else ("0", "ok"))
        llm = FakeLLM("1 2 3\n3\n")
        tm.resolve_example_stdin(self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertIn("already tried", llm.prompts[0])
        self.assertIn("1 2 3", llm.prompts[0])

    def test_gives_up_after_one_retry(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: ("999", "ok")
        llm = FakeLLM("a\n", "b\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1]", "6", 5.0, llm=llm)
        self.assertIsNone(stdin)
        self.assertIsNotNone(detail)
        self.assertEqual(len(llm.prompts), 2, "never more than two calls")

    def test_a_crashing_reference_is_reported_not_accepted(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: ("", "error")
        llm = FakeLLM("x\n", "y\n")
        stdin, _, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1]", "6", 5.0, llm=llm)
        self.assertIsNone(stdin)
        self.assertIn("error", detail)

    def test_strips_markdown_fences_from_the_proposal(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: (
            ("6", "ok") if stdin == "1 2 3\n3\n" else ("0", "ok"))
        llm = FakeLLM("```\n1 2 3\n3\n```")
        stdin, _, _ = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "1 2 3\n3\n")


if __name__ == "__main__":
    unittest.main()
