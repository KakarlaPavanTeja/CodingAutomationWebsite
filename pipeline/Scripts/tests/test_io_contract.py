"""CHECKPOINT: the I/O contract is frozen and verified BEFORE testcases are generated.

Root cause of every I/O failure on 2026-07-29: no artifact OWNS the I/O contract. The
description, the normalized solution, each per-language driver and the testcases all
re-derive it independently, so they disagree silently. "T primes" shipped `[8]` /
`["NO"]` and scored 0/150 in Python, C++ and Java; "Infinite Coins" shipped `N = 2763`.

`verify_io_contract` runs the reference solution on the description's own Examples and
compares stdout byte-for-byte. Two subprocess runs, at the cheapest point in the pipeline.

KNOWN LIMITATION, pinned by test_named_var_examples_are_not_yet_convertible below:
`benchmark_suite.extract_example_io` deliberately skips named-variable example blocks
(`N = 2763`), which is the form EVERY function-type description uses — so for those the
checkpoint reports "skipped" instead of verifying. Converting that display form into raw
stdin is the missing piece, and it is exactly the conversion nobody in the pipeline owns.
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

    def test_named_var_examples_are_not_yet_convertible(self):
        """Pins the gap: `N = 2763` is display-only, so extract_example_io skips it and
        the checkpoint has nothing to verify. Converting it to raw stdin is the missing
        piece — when that lands, this test should assert `verified` instead."""
        ref = self.script("import sys" + NL + "sys.stdin.read()" + NL + "print('false')" + NL)
        contract = _m.verify_io_contract(NAMED_VAR_DESC, ref, outputs_dir=self.out)
        self.assertFalse(contract["verified"])
        self.assertEqual(contract["pairs"], [])
        self.assertIn("Example", contract["reason"])

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
