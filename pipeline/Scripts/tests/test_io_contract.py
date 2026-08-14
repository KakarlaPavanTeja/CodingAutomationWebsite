"""CHECKPOINT: the I/O contract is frozen and verified BEFORE testcases are generated.

Root cause of every I/O failure on 2026-07-29: no artifact OWNS the I/O contract. The
description, the normalized solution, each per-language driver and the testcases all
re-derive it independently, so they disagree silently. "T primes" shipped `[8]` /
`["NO"]` and scored 0/150 in Python, C++ and Java; "Infinite Coins" shipped `N = 2763`.

`verify_io_contract` runs the reference solution on the description's own Examples and
compares stdout byte-for-byte. Two subprocess runs, at the cheapest point in the pipeline.

Named-variable example blocks (`N = 2763`) — the form EVERY function-type description
uses — used to make the checkpoint report "skipped", because `extract_example_io` drops
them as display-only. They are now CONVERTED: a small model reads the reference solution's
own parser and proposes ONE raw-stdin layout, which is accepted only when the reference
reproduces the stated answer. Execution, not the model, decides. That conversion is the
piece nobody in the pipeline owned.
"""

import importlib.util
import os
import sys
import tempfile
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

NL = "\n"
FENCE = "```"


def _load_manager():
    for name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.__getattr__ = lambda n: type(n, (Exception,), {})
            sys.modules[name] = mod
    path = os.path.join(SCRIPT_DIR, "testcase_manager_v4.py")
    spec = importlib.util.spec_from_file_location("tm_contract", path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        return None
    return mod


_m = _load_manager()

RAW_DESC = NL.join([
    "## Example 1", "**Input:**", FENCE, "1", "8", FENCE,
    "**Output:**", FENCE, "NO", FENCE, "",
])

NAMED_VAR_DESC = NL.join([
    "## Example 1", "**Input:**", FENCE, "N = 2763", "C = 0", FENCE,
    "**Output:**", FENCE, "false", FENCE, "",
])


class FakeLLM:
    """Hands back queued stdin proposals so the conversion runs without a network call."""

    def __init__(self, *replies):
        self.replies = list(replies)

    def __call__(self, system, user, purpose=None):
        return self.replies.pop(0), {"prompt_tokens": 0, "completion_tokens": 0,
                                     "model": "fake", "cost": 0.0}


@unittest.skipIf(_m is None, "testcase_manager_v4 deps unavailable in this env")
class TestVerifyIoContract(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.out = self._tmp.name
        self._scripts = []

    def tearDown(self):
        for p in self._scripts:
            os.unlink(p)
        self._tmp.cleanup()

    def script(self, body):
        fh = tempfile.NamedTemporaryFile("w", suffix=".py", delete=False)
        fh.write(body)
        fh.close()
        self._scripts.append(fh.name)
        return fh.name

    def test_correct_reference_verifies_and_freezes_the_pair(self):
        ref = self.script(
            "import sys" + NL
            + "d = sys.stdin.read().split()" + NL
            + "print('\\n'.join(['NO'] * int(d[0])))" + NL
        )
        contract = _m.verify_io_contract(RAW_DESC, ref, outputs_dir=self.out)
        self.assertTrue(contract["verified"], contract)
        self.assertEqual(contract["pairs"][0]["stdin"], "1\n8\n")
        self.assertEqual(contract["pairs"][0]["stdout"], "NO")
        self.assertEqual(contract["mismatches"], [])

    def test_literal_printing_reference_is_caught(self):
        # The exact "T primes" shape: prints ["NO"] where the statement says NO.
        ref = self.script(
            "import sys, json" + NL
            + "sys.stdin.read()" + NL
            + "print(json.dumps(['NO']))" + NL
        )
        contract = _m.verify_io_contract(RAW_DESC, ref, outputs_dir=self.out)
        self.assertFalse(contract["verified"])
        self.assertEqual(contract["mismatches"][0]["expected"], "NO")
        self.assertEqual(contract["mismatches"][0]["got"], '["NO"]')

    def test_crashing_reference_is_caught_not_silent(self):
        ref = self.script("import sys" + NL + "raise SystemExit(1)" + NL)
        contract = _m.verify_io_contract(RAW_DESC, ref, outputs_dir=self.out)
        self.assertFalse(contract["verified"])
        self.assertIn("error", contract["mismatches"][0]["got"])

    def test_artifact_is_written(self):
        ref = self.script("import sys" + NL + "sys.stdin.read()" + NL + "print('NO')" + NL)
        _m.verify_io_contract(RAW_DESC, ref, outputs_dir=self.out)
        self.assertTrue(os.path.exists(os.path.join(self.out, "io_contract.json")))

    def test_named_var_example_is_converted_to_raw_stdin(self):
        """The 2026-07-29 gap, now closed: `N = 2763` / `C = 0` is display-only, but the
        checkpoint derives the stdin the reference actually reads and freezes the pair."""
        ref = self.script(
            "import sys" + NL
            + "n, c = map(int, sys.stdin.read().split())" + NL
            + "print('false' if c == 0 else 'true')" + NL
        )
        contract = _m.verify_io_contract(NAMED_VAR_DESC, ref, outputs_dir=self.out,
                                         llm=FakeLLM("2763\n0\n"))
        self.assertTrue(contract["verified"], contract)
        self.assertEqual(contract["pairs"][0]["stdin"], "2763\n0\n")
        self.assertEqual(contract["pairs"][0]["stdout"], "false")
        self.assertEqual(contract["pairs"][0]["converted_from"], "named-variable block")

    def test_named_var_conversion_picks_the_layout_the_solution_reads(self):
        """A solution that reads a length line the block did not declare still resolves:
        the size-prefixed layout is tried and the reference confirms it by reproducing
        the answer."""
        desc = NL.join([
            "## Example 1", "**Input:**", FENCE, "values = [4, 1, 7]", FENCE,
            "**Output:**", FENCE, "[12]", FENCE, "",
        ])
        ref = self.script(
            "import sys" + NL
            + "d = sys.stdin.read().split()" + NL
            + "n = int(d[0])" + NL
            + "print(sum(map(int, d[1:1 + n])))" + NL
        )
        contract = _m.verify_io_contract(desc, ref, outputs_dir=self.out,
                                         llm=FakeLLM("3\n4 1 7\n"))
        self.assertTrue(contract["verified"], contract)
        self.assertEqual(contract["pairs"][0]["stdin"], "3\n4 1 7\n")
        self.assertEqual(contract["pairs"][0]["stdout"], "12")

    def test_deterministic_layout_resolves_without_spending_an_llm_call(self):
        """The common case costs zero tokens and needs no API key.

        `llm` here raises if touched, so a regression that reorders the stages — model
        first, deterministic second — fails loudly instead of quietly billing for every
        function-type problem.
        """
        def explode(system, user, purpose=None):
            raise AssertionError("the deterministic layouts should have resolved this")

        ref = self.script(
            "import sys" + NL
            + "n, c = map(int, sys.stdin.read().split())" + NL
            + "print('false' if c == 0 else 'true')" + NL
        )
        contract = _m.verify_io_contract(NAMED_VAR_DESC, ref, outputs_dir=self.out,
                                         llm=explode)
        self.assertTrue(contract["verified"], contract)
        self.assertEqual(contract["pairs"][0]["stdin"], "2763\n0\n")

    def test_model_resolves_what_the_deterministic_layouts_cannot(self):
        """The fallback earns its keep: this solution reads the scalar BEFORE the array,
        an order no mechanical serialization of the block produces."""
        desc = NL.join([
            "## Example 1", "**Input:**", FENCE, "arr = [1, 2, 3]", "k = 2", FENCE,
            "**Output:**", FENCE, "12", FENCE, "",
        ])
        ref = self.script(
            "import sys" + NL
            + "d = sys.stdin.read().split()" + NL
            + "k = int(d[0])" + NL
            + "n = int(d[1])" + NL
            + "print(sum(map(int, d[2:2 + n])) * k)" + NL
        )
        contract = _m.verify_io_contract(desc, ref, outputs_dir=self.out,
                                         llm=FakeLLM("2\n3\n1 2 3\n"))
        self.assertTrue(contract["verified"], contract)
        self.assertEqual(contract["pairs"][0]["stdin"], "2\n3\n1 2 3\n")
        self.assertEqual(contract["pairs"][0]["stdout"], "12")

    def test_the_model_is_told_which_layouts_already_failed(self):
        """Without this the model re-proposes the verbatim layout the pre-check just
        disproved, burning both attempts on the same dead end."""
        seen = {}

        def capture(system, user, purpose=None):
            seen["user"] = user
            return "2\n3\n1 2 3\n", {"prompt_tokens": 0, "completion_tokens": 0,
                                     "model": "fake", "cost": 0.0}

        desc = NL.join([
            "## Example 1", "**Input:**", FENCE, "arr = [1, 2, 3]", "k = 2", FENCE,
            "**Output:**", FENCE, "12", FENCE, "",
        ])
        ref = self.script(
            "import sys" + NL
            + "d = sys.stdin.read().split()" + NL
            + "print(int(d[0]) * int(d[1]) * int(d[2]))" + NL
        )
        _m.verify_io_contract(desc, ref, outputs_dir=self.out, llm=capture)
        self.assertIn("already tried", seen["user"])
        self.assertIn("1 2 3", seen["user"])

    def test_named_var_conversion_failure_is_reported_not_silent(self):
        """No proposed layout reproduces the stated answer -> a loud NOT VERIFIED with
        the layouts tried, never a silent pass that ships `N = 2763` as a graded input."""
        ref = self.script("import sys" + NL + "sys.stdin.read()" + NL + "print('MAYBE')" + NL)
        contract = _m.verify_io_contract(NAMED_VAR_DESC, ref, outputs_dir=self.out,
                                         llm=FakeLLM("2763\n0\n", "2763 0\n"))
        self.assertFalse(contract["verified"])
        self.assertEqual(contract["pairs"], [])
        self.assertEqual(contract["mismatches"][0]["got"], _m.UNCONVERTIBLE)
        self.assertIn("MAYBE", contract["mismatches"][0]["detail"])
        report = _m.format_io_contract(contract)
        self.assertIn("could not derive the raw stdin", report)

    def test_no_examples_reports_a_reason_and_does_not_crash(self):
        ref = self.script("print('x')" + NL)
        contract = _m.verify_io_contract("No examples here at all.", ref, outputs_dir=self.out)
        self.assertFalse(contract["verified"])
        self.assertTrue(contract["reason"])


@unittest.skipIf(_m is None, "testcase_manager_v4 deps unavailable in this env")
class TestFormatIoContract(unittest.TestCase):
    def test_verified_report_shows_the_pair(self):
        text = _m.format_io_contract({
            "verified": True,
            "pairs": [{"example": 1, "stdin": "1\n8\n", "stdout": "NO"}],
            "mismatches": [],
        })
        self.assertIn("verified", text)
        self.assertIn("1\\n8\\n", text)

    def test_mismatch_report_names_expected_and_got(self):
        text = _m.format_io_contract({
            "verified": False, "pairs": [],
            "mismatches": [{"example": 1, "stdin": "1\n", "expected": "NO",
                            "got": '["NO"]'}],
        })
        self.assertIn("NOT VERIFIED", text)
        self.assertIn('["NO"]', text)

    def test_skipped_report_carries_the_reason(self):
        text = _m.format_io_contract({"verified": False, "pairs": [], "mismatches": [],
                                      "reason": "no parseable Examples"})
        self.assertIn("skipped", text)
        self.assertIn("no parseable Examples", text)


if __name__ == "__main__":
    unittest.main()
