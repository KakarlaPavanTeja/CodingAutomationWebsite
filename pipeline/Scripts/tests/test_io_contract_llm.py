"""The small model proposes ONE stdin layout; execution decides whether it is right.

The model runs FIRST and is given the statement's declared Input/Output Format: the
graded stdin has to look like the layout the student was shown, and a mechanical
serialization that merely happens to parse is not good enough. The deterministic layouts
from `named_var_stdin_candidates` are the FALLBACK — free, and the only path that still
resolves the contract when no API key is configured.

The model reads the declared format and the reference solution's actual parser, so there
is no ambiguity left to hedge against with multiple blind candidates. On a mismatch it
gets ONE informed retry that sees its own wrong stdout against the expected one.
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

    def test_the_model_decides_the_layout_even_when_a_free_one_would_parse(self):
        """`nums = [1, 2, 3]` serializes to `1 2 3` verbatim and the reference accepts
        it — but the statement declares a trailing count line, and THAT is what the
        student is shown. The declared layout wins."""
        tm._run_reference_on_input = lambda path, stdin, timeout: ("6", "ok")
        llm = FakeLLM("1 2 3\n3\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm,
            io_format="Input Format:\n- Line 1: the values.\n- Line 2: their count.")
        self.assertEqual(stdin, "1 2 3\n3\n")
        self.assertEqual(stdout, "6")
        self.assertIsNone(detail)
        self.assertEqual(len(llm.prompts), 1)

    def test_the_prompt_carries_the_declared_io_format(self):
        """Without it the model can only guess a layout off the parser, which is how a
        contract gets frozen in a shape the description never showed."""
        tm._run_reference_on_input = lambda path, stdin, timeout: ("6", "ok")
        llm = FakeLLM("1 2 3\n")
        tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm,
            io_format="Input Format:\n- A single line of space-separated integers.")
        self.assertIn("space-separated integers", llm.prompts[0])

    def test_the_free_layouts_still_resolve_it_when_no_model_is_reachable(self):
        """No API key must not leave every function-type problem unverified."""
        tm._run_reference_on_input = lambda path, stdin, timeout: (
            ("6", "ok") if stdin == "1 2 3\n" else ("0", "ok"))

        def dead(system, user, purpose=None):
            raise RuntimeError("no API key")

        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=dead)
        self.assertEqual(stdin, "1 2 3\n")
        self.assertEqual(stdout, "6")
        self.assertIsNone(detail)

    def test_the_free_layouts_run_after_the_model_gives_up(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: (
            ("6", "ok") if stdin == "1 2 3\n" else ("0", "ok"))
        llm = FakeLLM("nope\n", "still nope\n")
        stdin, _, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "1 2 3\n")
        self.assertIsNone(detail)
        self.assertEqual(len(llm.prompts), 2)

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

    def test_gives_up_after_one_retry(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: ("999", "ok")
        llm = FakeLLM("a\n", "b\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1]", "6", 5.0, llm=llm)
        self.assertIsNone(stdin, "the free fallback must not rescue a wrong answer")
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


class TestLayoutCallRouting(unittest.TestCase):
    """The conversion is a cheap transcription that execution verifies, so it must
    NOT fall through _canonical_purpose to "chat" (gpt-5.4, effort=high) — which is
    what it silently did while `io_contract_layout` was an unregistered purpose."""

    def setUp(self):
        import llm_client
        self.L = llm_client

    def test_routed_to_a_cheap_model_at_low_effort(self):
        self.assertEqual(self.L._canonical_purpose("io_contract_layout"),
                         "io_contract_layout", "must not fall through to chat")
        self.assertNotEqual(self.L._resolve_model("io_contract_layout"),
                            self.L._resolve_model("chat"))
        self.assertEqual(self.L._resolve_reasoning_effort("io_contract_layout"), "low")

    def test_it_still_has_a_capacity_fallback_ladder(self):
        plan = self.L._resolve_fallback_plan("io_contract_layout")
        self.assertTrue(plan, "a 429 on the cheap model must not abort the contract")


if __name__ == "__main__":
    unittest.main()
