"""The verdict must survive the step that produced it.

Every number in this file was already being computed before this test existed. What
was missing was persistence: `print_report` worked out pass/fail into a local and
returned None, and `run_annotation` returned a dict that `__main__` dropped. So a
suite that killed 40% of injected bugs and one that killed 100% left the pipeline
looking identical, and nothing downstream -- not the orchestrator, not the
unattended runner -- could tell them apart.

These tests pin the two properties that make the verdict actionable:
  1. it is returned and written, on pass, fail AND crash
  2. an unmeasurable suite never reads as a good one
"""

import io
import json
import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from benchmark_suite import (  # noqa: E402
    BenchmarkReport,
    DEFAULT_MIN_KILL,
    gate_verdict,
    print_report,
)
from gate_report import (  # noqa: E402
    ERROR,
    FAIL,
    PASS,
    gate_path,
    write_gate,
)


def _read(path: str) -> dict:
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def _report(**kw) -> BenchmarkReport:
    """A report with every gate clean, so each test perturbs exactly one thing."""
    base = dict(
        kill_rate=1.0,
        b1={"kill_rate": 1.0, "killed": 10, "non_equivalent_total": 10, "survivors": []},
        b2={"hard_fail": False, "wrong_files": 3},
        b3={"hard_fail": False, "issues": [], "total": 40},
        b4={"disagreements": []},
        hard_failures=[],
        warnings=[],
    )
    base.update(kw)
    return BenchmarkReport(**base)


class TestBlockingSignals(unittest.TestCase):
    def test_a_clean_suite_passes(self):
        self.assertTrue(gate_verdict(_report(), DEFAULT_MIN_KILL)["passed"])

    def test_kill_rate_below_the_minimum_is_blocking(self):
        v = gate_verdict(
            _report(kill_rate=0.62, b1={"kill_rate": 0.62, "survivors": [{"id": "m1"}]}),
            DEFAULT_MIN_KILL,
        )
        self.assertFalse(v["passed"])
        self.assertTrue(any(b.startswith("B1") for b in v["blocking"]), v["blocking"])

    def test_a_surviving_wrong_solution_is_blocking(self):
        v = gate_verdict(
            _report(b2={"hard_fail": True, "reason": "w1.py passes every case"}),
            DEFAULT_MIN_KILL,
        )
        self.assertFalse(v["passed"])
        self.assertTrue(any(b.startswith("B2") for b in v["blocking"]), v["blocking"])

    def test_an_unmeasured_suite_does_not_read_as_a_strong_one(self):
        """No b1 means nobody scored the suite. That must not resolve to PASS."""
        v = gate_verdict(_report(kill_rate=0.0, b1={}), DEFAULT_MIN_KILL)
        self.assertFalse(v["passed"], "an absent kill rate must block, not pass")

    def test_a_retuned_minimum_is_honoured(self):
        r = _report(kill_rate=0.7, b1={"kill_rate": 0.7})
        self.assertFalse(gate_verdict(r, 0.90)["passed"])
        self.assertTrue(gate_verdict(r, 0.60)["passed"])


class TestAdvisorySignals(unittest.TestCase):
    """B3/B4 are recorded, never blocking -- nothing can act on a shape gap while
    the suite ships exactly as generated. Recording them is what makes promoting
    them a decision with evidence behind it."""

    def test_coverage_shape_issues_are_advisory(self):
        v = gate_verdict(
            _report(b3={"hard_fail": True, "issues": ["subtask 3 has 1 case"]}),
            DEFAULT_MIN_KILL,
        )
        self.assertTrue(v["passed"], "B3 must not fail the step")
        self.assertTrue(any("B3" in a for a in v["advisory"]), v["advisory"])

    def test_a_real_fuzz_disagreement_is_recorded_as_not_yet_blocking(self):
        v = gate_verdict(_report(b4={"disagreements": [{"input": "3"}]}), DEFAULT_MIN_KILL)
        self.assertTrue(v["passed"])
        self.assertTrue(any("B4" in a for a in v["advisory"]), v["advisory"])


class TestPrintReportReturnsTheVerdict(unittest.TestCase):
    """The regression that started this: the verdict existed for one line, then went
    out of scope."""

    def _silently(self, report, min_kill, report_only):
        held, sys.stdout = sys.stdout, io.StringIO()
        try:
            return print_report(report, min_kill, report_only=report_only)
        finally:
            sys.stdout = held

    def test_report_only_mode_returns_it(self):
        v = self._silently(_report(kill_rate=0.5, b1={"kill_rate": 0.5}), DEFAULT_MIN_KILL, True)
        self.assertIsNotNone(v, "report_only used to return None")
        self.assertFalse(v["passed"])

    def test_gate_mode_returns_it_too(self):
        v = self._silently(_report(), DEFAULT_MIN_KILL, False)
        self.assertIsNotNone(v)
        self.assertTrue(v["passed"])


class TestWriteGate(unittest.TestCase):
    def test_writes_a_readable_verdict_and_creates_the_directory(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "Outputs")
            path = write_gate(
                "select_testcases", FAIL, outputs_dir=out,
                numbers={"total": 40, "kill_rate": 0.62},
                gates={"b1": {"survivors": [{"id": "m1", "bug_class": "off_by_one"}]}},
                blocking=["B1: mutation kill 62.0% is below the 90% minimum"],
                advisory=["B3: subtask 3 has 1 case"],
            )
            self.assertEqual(path, gate_path("select_testcases", out))
            got = _read(path)

            self.assertEqual(got["verdict"], FAIL)
            self.assertEqual(got["step"], "select_testcases")
            self.assertEqual(got["numbers"]["kill_rate"], 0.62)
            self.assertEqual(got["blocking"], ["B1: mutation kill 62.0% is below the 90% minimum"])
            self.assertEqual(got["advisory"], ["B3: subtask 3 has 1 case"])
            self.assertTrue(got["written_at"])

    def test_survivors_are_kept_in_full_not_truncated(self):
        """The log caps survivors at 10. This file is the only place the whole list
        lives, and it is the input to improving the testcase prompt."""
        survivors = [{"id": f"m{i}", "bug_class": "off_by_one"} for i in range(25)]
        with tempfile.TemporaryDirectory() as d:
            path = write_gate(
                "select_testcases", FAIL, outputs_dir=os.path.join(d, "Outputs"),
                gates={"b1": {"survivors": survivors}},
            )
            got = _read(path)
            self.assertEqual(len(got["gates"]["b1"]["survivors"]), 25)

    def test_an_error_verdict_is_writable(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_gate(
                "select_testcases", ERROR, outputs_dir=os.path.join(d, "Outputs"),
                blocking=["benchmark did not run: TimeoutError: compiler unreachable"],
            )
            self.assertEqual(_read(path)["verdict"], ERROR)

    def test_an_unknown_verdict_is_refused(self):
        """Only three verdicts exist. A typo must not become a fourth, silently."""
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                write_gate("select_testcases", "green", outputs_dir=d)

    def test_a_pass_is_recorded_too_not_only_failures(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_gate("select_testcases", PASS, outputs_dir=os.path.join(d, "Outputs"))
            self.assertEqual(_read(path)["verdict"], PASS)


class TestGateSettings(unittest.TestCase):
    """Blocking is opt-in; the threshold is tunable. Both are read from the
    environment so a rollout needs no code change."""

    def setUp(self):
        import testcase_annotate
        self.mod = testcase_annotate
        self._saved = {k: os.environ.get(k) for k in ("PIPELINE_MIN_KILL", "PIPELINE_GATE_BLOCKING")}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_recording_only_by_default(self):
        os.environ.pop("PIPELINE_GATE_BLOCKING", None)
        os.environ.pop("PIPELINE_MIN_KILL", None)
        min_kill, blocking = self.mod._gate_settings()
        self.assertFalse(blocking, "B1 must not block until explicitly switched on")
        self.assertEqual(min_kill, DEFAULT_MIN_KILL)

    def test_blocking_can_be_switched_on(self):
        os.environ["PIPELINE_GATE_BLOCKING"] = "1"
        self.assertTrue(self.mod._gate_settings()[1])

    def test_the_threshold_can_be_retuned(self):
        os.environ["PIPELINE_MIN_KILL"] = "0.75"
        self.assertEqual(self.mod._gate_settings()[0], 0.75)

    def test_a_junk_threshold_falls_back_instead_of_crashing_the_step(self):
        os.environ["PIPELINE_MIN_KILL"] = "ninety percent"
        self.assertEqual(self.mod._gate_settings()[0], DEFAULT_MIN_KILL)


if __name__ == "__main__":
    unittest.main()
