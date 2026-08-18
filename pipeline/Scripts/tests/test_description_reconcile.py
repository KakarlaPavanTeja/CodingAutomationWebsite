"""Execution decides the worked examples; the model only writes prose.

`sync_example_testcases` forces test cases 1-2 to equal the description's Examples. If the
model invents an output the reference does not produce, case 1 fails for EVERY student
including a perfect solution — silently, three steps downstream. So the description step
runs the reference against its own Examples and reconciles.

Repairing the description and repairing the code are OPPOSITE fixes for symptoms that look
alike, so they get separate paths and the loop is bounded.
"""

import os
import sys
import tempfile
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

# generate_full_question -> llm_client -> httpx. No network call happens here (the LLM is
# injected), so stub the deps this checkout may not have installed.
for _name in ("httpx", "openai", "anthropic", "tiktoken", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

# BASE_DIR/OUTPUT_DIR are resolved at import time; keep this suite off the real Outputs/.
_BASE = tempfile.TemporaryDirectory()
os.environ.setdefault("PIPELINE_BASE_DIR", _BASE.name)

import generate_full_question as gfq  # noqa: E402


class FakeLLM:
    """Returns queued replies; records the prompts it was given. Never touches a network."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    def __call__(self, system, user, **kwargs):
        self.prompts.append((system, user))
        return self.replies.pop(0), {"prompt_tokens": 1, "completion_tokens": 1,
                                     "model": "fake", "cost": 0.0}


def ok(_desc, _path, _dir="Outputs", llm=None):
    return {"verified": True, "pairs": [{"example": 1, "stdin": "1\n", "stdout": "1",
                                         "expected": "1"}],
            "mismatches": [], "reason": ""}


def disagrees(_desc, _path, _dir="Outputs", llm=None):
    """The reference RAN and printed something else -> the description is wrong."""
    return {"verified": False, "pairs": [],
            "mismatches": [{"example": 1, "stdin": "1\n", "expected": "9", "got": "1"}],
            "reason": ""}


def crashes(_desc, _path, _dir="Outputs", llm=None):
    """The reference did not run -> the CODE is wrong, not the description."""
    return {"verified": False, "pairs": [],
            "mismatches": [{"example": 1, "stdin": "1\n", "expected": "9",
                            "got": "<error>", "detail": "ZeroDivisionError"}],
            "reason": ""}


def unparseable(_desc, _path, _dir="Outputs", llm=None):
    return {"verified": False, "pairs": [], "mismatches": [],
            "reason": "the description states no parseable Examples"}


class TestReconcileDescription(unittest.TestCase):
    def setUp(self):
        # update_usage posts to the internal API and falls back to writing Outputs/ JSON.
        # Record the calls instead: tracking is asserted, side effects are not wanted.
        self.tracked = []
        self._orig_track = gfq._track_llm_usage
        gfq._track_llm_usage = lambda usage, label, purpose="chat": self.tracked.append(label)
        self.tmp = tempfile.TemporaryDirectory()
        self.optimal = os.path.join(self.tmp.name, "sol.py")
        with open(self.optimal, "w", encoding="utf-8") as f:
            f.write("print(1)\n")

    def tearDown(self):
        gfq._track_llm_usage = self._orig_track
        self.tmp.cleanup()

    def test_agreement_costs_one_generation_and_no_repair(self):
        llm = FakeLLM("DESC v1")
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", self.optimal, self.tmp.name, "moderate", llm=llm, verifier=ok)
        self.assertEqual(desc, "DESC v1")
        self.assertTrue(info["verified"])
        self.assertEqual(info["attempts"], 1)
        self.assertEqual(info["repairs"], [], "the common case must not repair anything")
        self.assertEqual(len(llm.prompts), 1)

    def test_a_disagreement_repairs_the_description_not_the_code(self):
        seq = iter([disagrees, ok])
        llm = FakeLLM("DESC v1", "DESC v2")
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", self.optimal, self.tmp.name, "moderate", llm=llm,
            verifier=lambda *a, **k: next(seq)(*a, **k))
        self.assertEqual(desc, "DESC v2")
        self.assertEqual(info["repairs"], ["description"])
        repair_prompt = llm.prompts[1][1]
        self.assertIn("1", repair_prompt, "the repair must show what the reference printed")
        self.assertIn("9", repair_prompt, "and what the statement claimed")
        # The statement was repaired, so the reference on disk is untouched.
        with open(self.optimal, encoding="utf-8") as f:
            self.assertEqual(f.read(), "print(1)\n")

    def test_a_crash_repairs_the_code_and_never_edits_the_statement(self):
        seq = iter([crashes, ok])
        llm = FakeLLM("DESC v1", "def solve():\n    return 1\n")
        written = {}
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", self.optimal, self.tmp.name, "moderate", llm=llm,
            verifier=lambda *a, **k: next(seq)(*a, **k), code_writer=written.__setitem__)
        self.assertEqual(info["repairs"], ["code"])
        self.assertEqual(desc, "DESC v1", "a crashing reference must NOT rewrite the statement")
        self.assertIn("code", written, "the repaired reference must be written back")
        self.assertIn("return 1", written["code"])
        # The code-repair prompt shows the crashing source and how it failed.
        self.assertIn("print(1)", llm.prompts[1][1])
        self.assertIn("ZeroDivisionError", llm.prompts[1][1])

    def test_the_default_code_writer_writes_the_reference_back(self):
        seq = iter([crashes, ok])
        gfq.reconcile_description(
            "P", "SYS", "raw", self.optimal, self.tmp.name, "moderate",
            llm=FakeLLM("DESC v1", "```python\nprint(2)\n```"),
            verifier=lambda *a, **k: next(seq)(*a, **k))
        with open(self.optimal, encoding="utf-8") as f:
            self.assertEqual(f.read().strip(), "print(2)", "fences must not reach the file")

    def test_the_loop_is_bounded_and_names_the_side_it_was_repairing(self):
        llm = FakeLLM("v1", "v2", "v3")
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", self.optimal, self.tmp.name, "moderate", llm=llm,
            verifier=disagrees, max_attempts=3)
        self.assertFalse(info["verified"])
        self.assertEqual(info["attempts"], 3, "never more than max_attempts generations")
        self.assertEqual(len(llm.prompts), 3)
        self.assertIn("description", info["reason"])

    def test_nothing_parseable_to_reconcile_is_not_a_repairable_defect(self):
        llm = FakeLLM("DESC v1")
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", self.optimal, self.tmp.name, "moderate", llm=llm,
            verifier=unparseable)
        self.assertFalse(info["verified"])
        self.assertEqual(info["attempts"], 1, "an unparseable statement must not burn retries")
        self.assertEqual(info["repairs"], [])
        self.assertEqual(desc, "DESC v1")

    def test_usage_is_recorded_for_every_call_including_repairs(self):
        seq = iter([disagrees, ok])
        gfq.reconcile_description(
            "P", "SYS", "raw", self.optimal, self.tmp.name, "moderate",
            llm=FakeLLM("v1", "v2"),
            verifier=lambda *a, **k: next(seq)(*a, **k))
        self.assertEqual(len(self.tracked), 2,
                         "every LLM call must be tracked, repairs included")


class TestMismatchSide(unittest.TestCase):
    """The two symptoms look alike and have opposite fixes."""

    def test_an_error_or_timeout_blames_the_code(self):
        for got in ("<error>", "<timeout>"):
            self.assertEqual(
                gfq._mismatch_side({"mismatches": [{"got": got}]}), "code", got)

    def test_a_real_stdout_blames_the_description(self):
        self.assertEqual(
            gfq._mismatch_side({"mismatches": [{"got": "42"}]}), "description")

    def test_one_crashing_example_outranks_a_disagreeing_one(self):
        contract = {"mismatches": [{"got": "42"}, {"got": "<error>"}]}
        self.assertEqual(gfq._mismatch_side(contract), "code",
                         "a reference that cannot run is never fixed by editing prose")


if __name__ == "__main__":
    unittest.main()
