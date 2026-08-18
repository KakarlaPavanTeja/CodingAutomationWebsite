"""B2 judges open-ended problems instead of abstaining, because a checker exists now.

The regex it replaces matched `if there are multiple ... return the smallest first index` —
the exact wording a description MUST use when it DOES pin an answer down — so the better a
description followed the rules the more likely B2 stopped running. Abstention was never a
pass; it shipped suites with no blocking quality gate at all.

Kill scoring now asks the checker the same question the driver will ask at grading time: a
wrong solution that happens to print a valid-but-different answer on a case is NOT killed by
that case, because the driver would have accepted it too. The same applies to a multi-answer
case, which stores every valid answer in `outputs` and no `output` at all — comparing those
against `""` marked EVERY solution killed by that case and inflated the only evidence B2
blocks on.

Nothing here runs a subprocess or the compiler: the batch runners are injected/patched.
"""

import json
import os
import sys
import tempfile
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

import benchmark_suite as bs  # noqa: E402
import testcase_annotate as ta  # noqa: E402


class Checker:
    """Accepts either order of the two indices."""

    @staticmethod
    def reference_answer(stdin_text):
        return "0 1"

    @staticmethod
    def is_valid_answer(stdin_text, candidate_stdout):
        return candidate_stdout.strip() in ("0 1", "1 0")


def cases():
    return [{"input": "a\n", "output": "0 1", "kills": set()},
            {"input": "b\n", "output": "0 1", "kills": set()}]


class _PatchedBatch:
    """Replace benchmark_suite.run_solutions_batch so no subprocess and no compiler
    call can happen — `_use_compiler()` would otherwise route a test at the live API."""

    def __init__(self, table):
        self.table = table

    def __enter__(self):
        self.original = bs.run_solutions_batch
        bs.run_solutions_batch = lambda code, inputs, timeout=None: [
            (self.table[code], "ok") for _ in inputs
        ]
        return self

    def __exit__(self, *exc):
        bs.run_solutions_batch = self.original
        return False


class TestDetectorIsGone(unittest.TestCase):
    def test_the_regex_no_longer_exists(self):
        self.assertFalse(hasattr(bs, "is_open_ended_problem"))
        self.assertFalse(hasattr(bs, "_OPEN_ENDED_RE"))

    def test_b2_judges_an_open_ended_description_instead_of_abstaining(self):
        v = bs.b2_verdict(2, [{"file": "w1.py"}], cases(),
                          "Return any valid arrangement of the letters.")
        self.assertFalse(v["cannot_judge"], "abstention is not a pass; it must judge")
        self.assertTrue(v["hard_fail"], "a surviving wrong solution still blocks")

    def test_a_description_with_a_tie_break_also_judges(self):
        """The old regex fired on this wording and switched the gate off."""
        v = bs.b2_verdict(1, [], cases(),
                          "If there are multiple pairs, print the smallest first index.")
        self.assertFalse(v["cannot_judge"])
        self.assertFalse(v["hard_fail"])


class TestKillScoringThroughTheChecker(unittest.TestCase):
    def test_a_valid_but_different_answer_does_not_kill(self):
        c = cases()
        runner = lambda code, inputs: [("1 0", "ok") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=Checker)
        self.assertEqual(c[0]["kills"], set(),
                         "the driver would have accepted this, so the case does not kill")

    def test_an_invalid_answer_still_kills(self):
        c = cases()
        runner = lambda code, inputs: [("5 5", "ok") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=Checker)
        self.assertEqual(c[0]["kills"], {"w1.py"})

    def test_a_crash_still_kills_even_with_a_checker(self):
        c = cases()
        runner = lambda code, inputs: [("", "error") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=Checker)
        self.assertEqual(c[0]["kills"], {"w1.py"})

    def test_without_a_checker_comparison_stays_exact_text(self):
        c = cases()
        runner = lambda code, inputs: [("1 0", "ok") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=None)
        self.assertEqual(c[0]["kills"], {"w1.py"})


class TestMultiAnswerCasesDoNotInflateKills(unittest.TestCase):
    """A non-function open-ended suite has NO checker — it enumerates `outputs` instead.

    Such a case carries no `output` key at all, so the pool's `output` was `""` and every
    wrong solution "failed" it. Kill counts were inflated and B2 — the only blocking gate —
    passed on evidence that was not real.
    """

    def _pool(self):
        suite = {"test_cases": [
            {"order": 1, "input": "2\n7 8\n", "multiple_possible_output": True,
             "outputs": ["7 8", "8 7"]},
            {"order": 2, "input": "1\n5\n", "output": "5"},
        ]}
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "testcases.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(suite, f)
            cases, _max_n = ta.load_cases(path, "desc")
        return cases

    def test_an_enumerated_answer_does_not_kill(self):
        c = self._pool()
        runner = lambda code, inputs: [("8 7", "ok"), ("5", "ok")]
        ta.annotate_kills(c, [("w1.py", "src")], runner)
        self.assertEqual(c[0]["kills"], set(),
                         "'8 7' is in `outputs`; the platform would accept it")
        self.assertEqual(c[1]["kills"], set())

    def test_an_answer_outside_the_enumeration_still_kills(self):
        c = self._pool()
        runner = lambda code, inputs: [("9 9", "ok"), ("6", "ok")]
        ta.annotate_kills(c, [("w1.py", "src")], runner)
        self.assertEqual(c[0]["kills"], {"w1.py"})
        self.assertEqual(c[1]["kills"], {"w1.py"})


class TestCheckerIsWiredToTheAuthoredFlag(unittest.TestCase):
    """The glue every restored check depends on. If `checker_for` looked in the wrong
    place it would return None forever and each check would silently fall back to exact
    text — passing its tests and grading open-ended problems wrong in production."""

    CHECKER_SRC = ("def reference_answer(stdin_text):\n    return '0 1'\n\n"
                   "def is_valid_answer(stdin_text, candidate_stdout):\n"
                   "    return candidate_stdout.strip() in ('0 1', '1 0')\n")

    def _outputs_dir(self, tmp, open_ended):
        os.makedirs(os.path.join(tmp, "generatedFullCode"), exist_ok=True)
        with open(os.path.join(tmp, "generatedFullCode", "PYTHON.py"), "w",
                  encoding="utf-8") as f:
            f.write(self.CHECKER_SRC)
        with open(os.path.join(tmp, "problem_flags.json"), "w", encoding="utf-8") as f:
            json.dump({"open_ended": open_ended, "reason": ""}, f)
        return tmp

    def test_it_loads_the_reference_checker_when_the_flag_is_set(self):
        from open_ended_checker import accepts, checker_for
        with tempfile.TemporaryDirectory() as tmp:
            checker = checker_for(self._outputs_dir(tmp, True))
        self.assertIsNotNone(checker, "the flag is set; the checker must be found")
        self.assertTrue(accepts(checker, "a\n", "1 0"))

    def test_a_single_answer_problem_gets_no_checker(self):
        from open_ended_checker import checker_for
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(checker_for(self._outputs_dir(tmp, False)))

    def test_a_missing_flags_file_gets_no_checker(self):
        from open_ended_checker import checker_for
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(checker_for(tmp))


class TestCrosscheckThroughTheChecker(unittest.TestCase):
    def test_a_valid_but_different_brute_answer_is_not_a_disagreement(self):
        with _PatchedBatch({"OPT": "0 1", "BRU": "1 0"}):
            self.assertEqual(
                bs.crosscheck_optimal_brute("OPT", "BRU", ["a\n"], count=0,
                                            checker=Checker), [])

    def test_an_invalid_brute_answer_is_still_a_disagreement(self):
        with _PatchedBatch({"OPT": "0 1", "BRU": "5 5"}):
            self.assertTrue(
                bs.crosscheck_optimal_brute("OPT", "BRU", ["a\n"], count=0,
                                            checker=Checker))

    def test_without_a_checker_any_difference_is_still_a_disagreement(self):
        with _PatchedBatch({"OPT": "0 1", "BRU": "1 0"}):
            self.assertTrue(
                bs.crosscheck_optimal_brute("OPT", "BRU", ["a\n"], count=0))


class TestDifferentialFuzzThroughTheChecker(unittest.TestCase):
    """B4 in `run_benchmark` runs `run_differential_fuzz`, NOT `crosscheck_optimal_brute`.

    Without a checker here every open-ended problem reports fake B4 disagreements — the
    reason the deleted regex forced B4 to stay a hard fail on exactly those problems.
    """

    def _fuzz(self, brute_out, **kw):
        # run_differential_fuzz writes Outputs/differential_fuzz_cases.json relative to
        # the CWD; run it from a temp dir so the repo gets nothing.
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as d, _PatchedBatch({"OPT": "0 1", "BRU": brute_out}):
            try:
                os.chdir(d)
                return bs.run_differential_fuzz(
                    "OPT", "BRU", "desc", test_cases=[{"input": "a\n", "output": "0 1"}],
                    count=1, **kw)
            finally:
                os.chdir(cwd)

    def test_a_valid_but_different_brute_answer_is_not_a_disagreement(self):
        self.assertEqual(self._fuzz("1 0", checker=Checker)["disagreements"], [])

    def test_an_invalid_brute_answer_still_fails_b4(self):
        self.assertTrue(self._fuzz("5 5", checker=Checker)["disagreements"])

    def test_without_a_checker_any_difference_still_fails_b4(self):
        self.assertTrue(self._fuzz("1 0")["disagreements"])


class TestB4KeepsItsTighteningPolarity(unittest.TestCase):
    """The one site where the deleted regex TIGHTENED a check instead of relaxing it.

    `run_benchmark` downgrades a B4 disagreement to advisory when the optimal
    reproduces every worked example — EXCEPT on an open-ended problem, where it stays a
    hard fail. Sourcing that from the deleted regex and not replacing it would make the
    downgrade unconditional and weaken B4 forever, silently: the report still prints,
    still says PASS, and nothing else notices.
    """

    def _run(self, open_ended):
        with tempfile.TemporaryDirectory() as tmp:
            outputs = os.path.join(tmp, "Outputs")
            os.makedirs(os.path.join(outputs, "generatedFullCode"))
            optimal = os.path.join(outputs, "generatedFullCode", "PYTHON.py")
            brute = os.path.join(outputs, "generatedFullCode", "BRUTE_FORCE.py")
            for path in (optimal, brute):
                with open(path, "w", encoding="utf-8") as f:
                    f.write("print('0 1')\n")
            with open(os.path.join(outputs, "problem_flags.json"), "w", encoding="utf-8") as f:
                json.dump({"open_ended": open_ended, "reason": ""}, f)
            tc_path = os.path.join(outputs, "testcases.json")
            with open(tc_path, "w", encoding="utf-8") as f:
                json.dump({"test_cases": [{"input": "a\n", "output": "0 1", "order": 1}]}, f)

            patched = {
                "run_mutation_benchmark": lambda *a, **k: {"kill_rate": 1.0, "killed": 1,
                                                           "non_equivalent_total": 1},
                "audit_coverage_shape": lambda *a, **k: {"hard_fail": False, "warnings": [],
                                                         "total": 1, "subtask_count": 1,
                                                         "problem_type": "x"},
                # One real disagreement the checker does NOT explain away.
                "run_differential_fuzz": lambda *a, **k: {
                    "runs": 1, "hard_fail": True,
                    "disagreements": [{"input": "a\n", "optimal": "0 1", "brute": "9 9"}]},
                "optimal_example_failures": lambda *a, **k: [],
            }
            originals = {name: getattr(bs, name) for name in patched}
            for name, fake in patched.items():
                setattr(bs, name, fake)
            try:
                return bs.run_benchmark(optimal_path=optimal, testcases_path=tc_path,
                                        brute_path=brute, precomputed_b2={"skipped": True})
            finally:
                for name, original in originals.items():
                    setattr(bs, name, original)

    def test_an_open_ended_problem_keeps_b4_as_a_hard_fail(self):
        report = self._run(open_ended=True)
        self.assertTrue(report.b4["hard_fail"])
        self.assertFalse(report.b4.get("advisory"))
        self.assertTrue(report.hard_failures)

    def test_a_single_answer_problem_still_downgrades_to_advisory(self):
        report = self._run(open_ended=False)
        self.assertFalse(report.b4["hard_fail"])
        self.assertTrue(report.b4.get("advisory"))
        self.assertFalse(report.hard_failures)


if __name__ == "__main__":
    unittest.main()
