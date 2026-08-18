"""Regressions for the pre-testcase-generation audit (2026-08-18).

Each test pins one defect found by auditing everything that runs BEFORE
generate_testcases. They share a theme: a check that looked like it ran but didn't, or a
step that looked like it succeeded but hadn't. The functions were all individually fine —
368 tests passed while every one of these was live — so what is pinned here is the WIRING.

generate_full_question imports LLM prompt/client modules at load time (prod deps are not
present in every test env), so stub them and skip cleanly if the import still fails
(mirrors test_working_code_file.py).
"""

import json
import os
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code_cleaner import strip_code_fence  # noqa: E402


class _Auto(types.ModuleType):
    def __getattr__(self, name):
        return type(name, (), {"__init__": lambda self, *a, **k: None})


_BASE = tempfile.TemporaryDirectory()


def _import_gfq():
    for dep in ("httpx", "openai", "anthropic", "requests", "tiktoken", "dotenv"):
        sys.modules.setdefault(dep, _Auto(dep))
    os.environ["PIPELINE_BASE_DIR"] = _BASE.name
    try:
        import generate_full_question
        return generate_full_question
    except Exception:
        return None


_gfq = _import_gfq()


class StripCodeFenceTest(unittest.TestCase):
    """P2-8. The old idiom `text.split('\\n', 1)[1].rsplit('\\n', 1)[0]` raised
    IndexError on a single-line reply, killing the step with a bare traceback."""

    def test_single_line_fence_does_not_raise(self):
        # The exact shape that crashed: a fence opener and nothing else.
        self.assertEqual(strip_code_fence("```"), "")
        # ````python` carries no content, so there is no right answer — the
        # contract is only that it returns a string instead of raising. The caller
        # (json.loads / clean_generated_code) then fails loudly on the garbage.
        self.assertIsInstance(strip_code_fence("```python"), str)

    def test_single_line_fenced_code_is_still_unwrapped(self):
        # Why the no-newline branch strips 3 chars rather than bailing out.
        self.assertEqual(strip_code_fence("```print(1)```"), "print(1)")

    def test_no_newline_anywhere(self):
        self.assertEqual(strip_code_fence("print(1)"), "print(1)")

    def test_strips_language_tag_and_trailing_fence(self):
        self.assertEqual(strip_code_fence("```python\nprint(1)\n```"), "print(1)")

    def test_bare_fence_opener(self):
        self.assertEqual(strip_code_fence("```\nprint(1)\n```"), "print(1)")

    def test_unfenced_multiline_is_untouched(self):
        self.assertEqual(strip_code_fence("a\nb"), "a\nb")

    def test_none_and_empty(self):
        self.assertEqual(strip_code_fence(None), "")
        self.assertEqual(strip_code_fence(""), "")

    def test_old_idiom_would_have_raised(self):
        """Documents the bug so nobody reintroduces the one-liner."""
        with self.assertRaises(IndexError):
            "```".split("\n", 1)[1]


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class DetectUserSolutionTest(unittest.TestCase):
    """P0-2. Non-Python references were accepted, then died three steps later on a
    missing PYTHON.py, because there is no translate_python sub-step to produce it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = _gfq.INPUT_DIR
        _gfq.INPUT_DIR = self.tmp.name

    def tearDown(self):
        _gfq.INPUT_DIR = self._saved
        self.tmp.cleanup()

    def _write(self, name, body="x"):
        with open(os.path.join(self.tmp.name, name), "w", encoding="utf-8") as f:
            f.write(body)

    def test_prefers_solution_py_over_other_py_files(self):
        self._write("helper.py")
        self._write("solution.py")
        path, lang = _gfq.detect_user_solution()
        self.assertEqual(os.path.basename(path), "solution.py")
        self.assertEqual(lang, "python")

    def test_cpp_reference_is_rejected_not_accepted(self):
        self._write("solution.cpp")
        with self.assertRaises(SystemExit) as cm:
            _gfq.detect_user_solution()
        self.assertEqual(cm.exception.code, 1)

    def test_java_and_js_are_rejected_too(self):
        for name in ("Solution.java", "solution.js"):
            with self.subTest(name=name):
                self._write(name)
                with self.assertRaises(SystemExit):
                    _gfq.detect_user_solution()
                os.remove(os.path.join(self.tmp.name, name))

    def test_python_wins_when_both_present(self):
        self._write("solution.cpp")
        self._write("solution.py")
        _, lang = _gfq.detect_user_solution()
        self.assertEqual(lang, "python")

    def test_empty_inputs_exits(self):
        with self.assertRaises(SystemExit):
            _gfq.detect_user_solution()


class ContractPairsTest(unittest.TestCase):
    """P0-3. The optimal-vs-brute crosscheck seeded itself from example blocks that are
    always skipped on function problems, so it compared ZERO inputs and printed PASSED.
    io_contract.json's verified pairs are the executable stdins it should use."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._cwd = os.getcwd()
        os.makedirs(os.path.join(self.tmp.name, "Outputs"), exist_ok=True)
        os.chdir(self.tmp.name)
        import generate_brute_force
        self.gbf = generate_brute_force

    def tearDown(self):
        os.chdir(self._cwd)
        self.tmp.cleanup()

    def _write_contract(self, payload):
        with open(os.path.join("Outputs", "io_contract.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def test_missing_file_returns_empty(self):
        self.assertEqual(self.gbf._verified_contract_pairs(), [])

    def test_a_stored_contract_is_not_trusted_when_it_can_be_derived(self):
        """A stored contract is frozen against the PRE-normalization reference.

        On 2026-08-18 a reference parsed the `name = value` display form and so verified
        at description time; naming then rewrote it to read raw tokens, leaving a
        contract whose `stdin` was display text. Testing the current reference against it
        reported "the reference FAILS its own worked examples" — confidently, and wrongly.
        """
        self._write_contract({
            "verified": True,
            "pairs": [{"example": 1, "stdin": "n = 3\na = [1, 2, 3]\n", "stdout": "6",
                       "expected": "6"}],
            "mismatches": [], "reason": "",
        })
        # A reference that reads RAW tokens, as normalization would have left it.
        code = "import sys\nd=sys.stdin.read().split()\nprint(sum(map(int,d[1:])))\n"
        opt = os.path.join("Outputs", "PY.py")
        with open(opt, "w", encoding="utf-8") as f:
            f.write(code)
        desc = ("**Example 1:**\n\n**Input:**\n\n```\nn = 3\na = [1, 2, 3]\n```\n\n"
                "**Output:**\n\n```\n6\n```\n")

        pairs = self.gbf._verified_contract_pairs(desc, opt)
        for p in pairs:
            self.assertNotIn("=", p["stdin"],
                             "a derived contract must carry raw stdin, not display text")

    def test_unverified_contract_is_not_used(self):
        # An unverified contract's stdin values are guesses — no layout reproduced the
        # stated answer — so seeding a sweep from them is worse than skipping.
        self._write_contract({
            "verified": False,
            "pairs": [{"example": 1, "stdin": "3\n1 2 3\n", "expected": "6"}],
            "mismatches": [], "reason": "",
        })
        self.assertEqual(self.gbf._verified_contract_pairs(), [])

    def test_verified_contract_yields_pairs(self):
        self._write_contract({
            "verified": True,
            "pairs": [{"example": 1, "stdin": "3\n1 2 3\n", "stdout": "6",
                       "expected": "6"}],
            "mismatches": [], "reason": "",
        })
        pairs = self.gbf._verified_contract_pairs()
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["stdin"], "3\n1 2 3\n")

    def test_blank_stdin_pairs_are_dropped(self):
        self._write_contract({
            "verified": True,
            "pairs": [{"example": 1, "stdin": "   ", "expected": "6"},
                      {"example": 2, "stdin": "2\n1 2\n", "expected": "3"}],
            "mismatches": [], "reason": "",
        })
        self.assertEqual(len(self.gbf._verified_contract_pairs()), 1)

    def test_corrupt_json_returns_empty_not_raise(self):
        with open(os.path.join("Outputs", "io_contract.json"), "w", encoding="utf-8") as f:
            f.write("{not json")
        self.assertEqual(self.gbf._verified_contract_pairs(), [])


class ContractGroundTruthTest(unittest.TestCase):
    """P0-3, second half: the ground-truth comparison must tolerate the display form.
    The description states a RETURN value (`[1, 2]`) and the solution PRINTS it (`1 2`),
    so a byte comparison would brand every correct function solution buggy."""

    def setUp(self):
        import generate_brute_force
        self.gbf = generate_brute_force

    def test_display_form_counts_as_a_match(self):
        code = "import sys\nprint(' '.join(sys.stdin.read().split()))\n"
        pairs = [{"stdin": "1 2\n", "expected": "[1, 2]"}]
        self.assertEqual(self.gbf._contract_ground_truth_failures(code, pairs), [])

    def test_genuinely_wrong_answer_is_reported(self):
        code = "print(999)\n"
        pairs = [{"stdin": "1 2\n", "expected": "[1, 2]"}]
        fails = self.gbf._contract_ground_truth_failures(code, pairs)
        self.assertEqual(len(fails), 1)
        self.assertIn("999", fails[0]["got"])

    def test_crashing_reference_is_reported_as_error(self):
        code = "import sys\nsys.exit(3)\n"
        pairs = [{"stdin": "1\n", "expected": "1"}]
        fails = self.gbf._contract_ground_truth_failures(code, pairs)
        self.assertEqual(len(fails), 1)
        self.assertTrue(fails[0]["got"].startswith("<"))


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class StaleSignatureFileTest(unittest.TestCase):
    """P2-10. description_signature.json is the ONLY function-vs-STDIN signal, and nothing
    removed it — so a problem switched function -> nonfunction kept the old file and got
    function-style cases anyway."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = _gfq.OUTPUT_DIR
        _gfq.OUTPUT_DIR = self.tmp.name

    def tearDown(self):
        _gfq.OUTPUT_DIR = self._saved
        self.tmp.cleanup()

    def _write_signature(self):
        with open(_gfq._signature_path(), "w", encoding="utf-8") as f:
            json.dump({"function_name": "oldName", "parameters": ["a"],
                       "return_type": "int"}, f)

    def test_nonfunction_run_removes_the_stale_file(self):
        self._write_signature()
        self.assertTrue(os.path.exists(_gfq._signature_path()))
        _gfq.run_naming_step("P", "standard", "nonfunction", "x = 1", "python")
        self.assertFalse(os.path.exists(_gfq._signature_path()),
                         "a nonfunction run must not leave a signature behind — "
                         "testcase_manager_v4 would read it and build function cases")

    def test_nonfunction_run_is_fine_when_no_file_exists(self):
        _gfq.run_naming_step("P", "standard", "nonfunction", "x = 1", "python")
        self.assertFalse(os.path.exists(_gfq._signature_path()))


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class TopicsStepTest(unittest.TestCase):
    """P2-9. Topics used to warn-and-continue on unparseable JSON, leaving the step GREEN
    with no generated_topics.json.

    These EXECUTE run_topics_step rather than asserting on its source. The first version of
    the fix called `_strip_code_fence` (a name that does not exist — the import is
    `strip_code_fence`), and every unit test passed because none of them ran the function.
    A live run caught it. Executing the step is the point of these tests.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._out, self._in = _gfq.OUTPUT_DIR, _gfq.INPUT_DIR
        _gfq.OUTPUT_DIR = os.path.join(self.tmp.name, "Outputs")
        _gfq.INPUT_DIR = os.path.join(self.tmp.name, "Inputs")
        os.makedirs(_gfq.OUTPUT_DIR)
        os.makedirs(_gfq.INPUT_DIR)
        with open(_gfq._description_path(), "w", encoding="utf-8") as f:
            f.write("**Your Task**\n- Complete `foo`.\n")
        with open(os.path.join(_gfq.INPUT_DIR, "topics_list.txt"), "w",
                  encoding="utf-8") as f:
            f.write("arrays\ngraphs\n")
        self._call_llm = _gfq.call_llm
        self._track = _gfq._track_llm_usage
        _gfq._track_llm_usage = lambda *a, **k: None

    def tearDown(self):
        _gfq.call_llm = self._call_llm
        _gfq._track_llm_usage = self._track
        _gfq.OUTPUT_DIR, _gfq.INPUT_DIR = self._out, self._in
        self.tmp.cleanup()

    def _topics_path(self):
        return os.path.join(_gfq.OUTPUT_DIR, "generated_topics.json")

    def test_fenced_json_is_parsed_and_written(self):
        _gfq.call_llm = lambda *a, **k: ('```json\n{"topics": ["graphs"]}\n```', {})
        _gfq.run_topics_step("P", "x = 1", "python")
        with open(self._topics_path(), encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"topics": ["graphs"]})

    def test_bare_json_is_parsed(self):
        _gfq.call_llm = lambda *a, **k: ('{"topics": ["arrays"]}', {})
        _gfq.run_topics_step("P", "x = 1", "python")
        self.assertTrue(os.path.exists(self._topics_path()))

    def test_unparseable_json_exits_rather_than_warning(self):
        _gfq.call_llm = lambda *a, **k: ("I could not determine the topics.", {})
        with self.assertRaises(SystemExit) as cm:
            _gfq.run_topics_step("P", "x = 1", "python")
        self.assertEqual(cm.exception.code, 1)
        self.assertFalse(os.path.exists(self._topics_path()))

    def test_single_line_fence_reply_does_not_crash_with_indexerror(self):
        # The old fence-strip idiom raised IndexError here instead of exiting cleanly.
        _gfq.call_llm = lambda *a, **k: ("```", {})
        with self.assertRaises(SystemExit):
            _gfq.run_topics_step("P", "x = 1", "python")


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class NamingStepTest(unittest.TestCase):
    """P1-4, P1-5 and the io_contract invalidation.

    These EXECUTE run_naming_step on the FUNCTION path. Until now the only tests that
    called it took the nonfunction early return, so none of this was covered.
    """

    RAW = "def two_sum(nums, target):\n    return []\n"
    REPAIRED = "import sys\n\ndef two_sum(nums, target):\n    return [0, 1]\n"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._out = _gfq.OUTPUT_DIR
        _gfq.OUTPUT_DIR = os.path.join(self.tmp.name, "Outputs")
        os.makedirs(os.path.join(_gfq.OUTPUT_DIR, "generatedFullCode"))
        with open(_gfq._description_path(), "w", encoding="utf-8") as f:
            f.write("**Your Task**\n\n- Complete `twoSum` that takes `nums`, `target`.\n")
        # The working copy the description step left behind: a REPAIRED reference that
        # differs from Inputs/. Naming must build on this, not on the raw input.
        with open(_gfq._working_code_path("python"), "w", encoding="utf-8") as f:
            f.write(self.REPAIRED)
        self._call_llm = _gfq.call_llm
        self._track = _gfq._track_llm_usage
        _gfq._track_llm_usage = lambda *a, **k: None
        self.prompts = []

    def tearDown(self):
        _gfq.call_llm = self._call_llm
        _gfq._track_llm_usage = self._track
        _gfq.OUTPUT_DIR = self._out
        self.tmp.cleanup()

    def _llm(self, sig_reply, code_reply):
        """Stub: first call is signature extraction, second is normalization."""
        replies = iter([sig_reply, code_reply])

        def call(system, user="", **kw):
            self.prompts.append(system)
            return next(replies), {}
        _gfq.call_llm = call

    GOOD_SIG = '{"function_name": "twoSum", "parameters": ["nums", "target"]}'
    GOOD_CODE = ("class solution:\n    def twoSum(self, nums, target):\n"
                 "        return [0, 1]\n\n"
                 "import sys\n\n\ndef main():\n"
                 "    data = sys.stdin.read().split()\n\n\nmain()\n")

    def test_normalization_prompt_gets_the_WORKING_copy_not_the_raw_input(self):
        # The whole point of P1-4: the description step may have repaired the reference,
        # and normalizing from Inputs/ silently threw that repair away.
        self._llm(self.GOOD_SIG, self.GOOD_CODE)
        _gfq.run_naming_step("P", "standard", "function", self.RAW, "python")
        refactor_prompt = self.prompts[1]
        self.assertIn("return [0, 1]", refactor_prompt,
                      "naming must normalize the repaired working copy")
        self.assertNotIn("    return []\n", refactor_prompt,
                         "the raw Inputs/ body must not be what gets normalized")

    def test_success_invalidates_a_stale_io_contract(self):
        # The contract was verified against the PRE-normalization reference; normalization
        # is entitled to change how stdin is read, so it must not survive.
        contract = os.path.join(_gfq.OUTPUT_DIR, "io_contract.json")
        with open(contract, "w", encoding="utf-8") as f:
            json.dump({"verified": True, "pairs": [{"stdin": "n = 3\n"}]}, f)
        self._llm(self.GOOD_SIG, self.GOOD_CODE)
        _gfq.run_naming_step("P", "standard", "function", self.RAW, "python")
        self.assertFalse(os.path.exists(contract),
                         "a contract frozen before normalization must be invalidated")

    def test_missing_signature_exits_1_rather_than_reporting_success(self):
        # Used to warn and return 0: description_signature.json was never written, so
        # testcase_manager_v4 built a STDIN/STDOUT suite for a function problem, and the
        # rename plus both static gates never ran.
        self._llm("I could not find a signature.", self.GOOD_CODE)
        with self.assertRaises(SystemExit) as cm:
            _gfq.run_naming_step("P", "standard", "function", self.RAW, "python")
        self.assertEqual(cm.exception.code, 1)
        self.assertFalse(os.path.exists(_gfq._signature_path()))

    def test_missing_description_exits_1(self):
        os.remove(_gfq._description_path())
        with self.assertRaises(SystemExit) as cm:
            _gfq.run_naming_step("P", "standard", "function", self.RAW, "python")
        self.assertEqual(cm.exception.code, 1)

    def test_a_reference_that_parses_the_display_form_is_rejected(self):
        # The stdin gate, now unconditional. A reference splitting on "=" reproduces every
        # stated answer, so it grounds and verifies clean, then scores zero on the driver.
        bad = ("class solution:\n    def twoSum(self, nums, target):\n        return []\n"
               "import sys\nfor ln in sys.stdin:\n    k, v = ln.split(\"=\")\n")
        self._llm(self.GOOD_SIG, bad)
        with self.assertRaises(SystemExit) as cm:
            _gfq.run_naming_step("P", "standard", "function", self.RAW, "python")
        self.assertEqual(cm.exception.code, 1)

    def test_open_ended_problem_rejects_a_malformed_checker(self):
        with open(os.path.join(_gfq.OUTPUT_DIR, "problem_flags.json"), "w",
                  encoding="utf-8") as f:
            json.dump({"open_ended": True, "reason": "many valid answers"}, f)
        # GOOD_CODE has no reference_answer / is_valid_answer at all.
        self._llm(self.GOOD_SIG, self.GOOD_CODE)
        with self.assertRaises(SystemExit) as cm:
            _gfq.run_naming_step("P", "standard", "function", self.RAW, "python")
        self.assertEqual(cm.exception.code, 1)


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class ProblemMdEncodingTest(unittest.TestCase):
    """parse_problem_md read with the platform default encoding, so a statement carrying
    ≤ ≥ × · (which the notation-normalization rules produce) made the step's success
    depend on the machine's locale."""

    def test_non_ascii_notation_survives_parsing(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "problem.md")
            body = ("# Problem: Bounded Sums\n# Type: standard\n"
                    "# Question Type: function\n# Scenario Level: none\n\n"
                    "Given `n` with 1 ≤ n ≤ 10^5, compute 2 × n · 3.\n")
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            name, structure, kind, level, content = _gfq.parse_problem_md(p)
            self.assertEqual(name, "Bounded Sums")
            self.assertEqual(kind, "function")
            self.assertEqual(level, "none")
            for ch in ("≤", "×", "·"):
                self.assertIn(ch, content)


class DedupeFailuresTest(unittest.TestCase):
    """Both ground-truth sources can name the same input, making one defect look like two
    in a banner that says the reference is buggy."""

    def setUp(self):
        import generate_brute_force
        self.gbf = generate_brute_force

    def test_identical_failures_collapse(self):
        f = {"input": "1 2\n", "expected": "3", "got": ""}
        self.assertEqual(len(self.gbf._dedupe_failures([f, dict(f)])), 1)

    def test_order_is_preserved(self):
        a = {"input": "a", "expected": "1", "got": "x"}
        b = {"input": "b", "expected": "2", "got": "y"}
        self.assertEqual(
            [f["input"] for f in self.gbf._dedupe_failures([a, b, dict(a)])], ["a", "b"])

    def test_same_input_different_output_is_kept(self):
        a = {"input": "1\n", "expected": "3", "got": ""}
        b = {"input": "1\n", "expected": "3", "got": "<timeout>"}
        self.assertEqual(len(self.gbf._dedupe_failures([a, b])), 2)

    def test_empty_list(self):
        self.assertEqual(self.gbf._dedupe_failures([]), [])


def _import_tm():
    """testcase_manager_v4 with its LLM deps stubbed (mirrors test_io_contract.py)."""
    for dep in ("httpx", "openai", "anthropic", "requests", "tiktoken", "dotenv"):
        sys.modules.setdefault(dep, _Auto(dep))
    try:
        import testcase_manager_v4
        return testcase_manager_v4
    except Exception:
        return None


_tm = _import_tm()
_TM_SOURCE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "testcase_manager_v4.py")


@unittest.skipIf(_tm is None, "testcase_manager_v4 deps unavailable in this env")
class IoContractGateTest(unittest.TestCase):
    """P2-7. The checkpoint printed its verdict and generation continued regardless, so
    "NOT VERIFIED" scrolled past in a long log and a whole suite got built on a
    description and a reference that disagree — surfacing three steps later as 0/150."""

    def test_a_verified_contract_passes(self):
        self.assertIsNone(_tm.enforce_io_contract(
            {"verified": True, "pairs": [{"stdin": "2\n1 2\n", "stdout": "3"}],
             "mismatches": [], "reason": ""}))

    def test_a_disagreement_aborts(self):
        with self.assertRaises(SystemExit) as cm:
            _tm.enforce_io_contract({
                "verified": False, "pairs": [],
                "mismatches": [{"example": 1, "stdin": "2\n1 2\n", "expected": "3",
                                "got": "4"}],
                "reason": ""})
        self.assertEqual(cm.exception.code, 1)

    def test_a_description_with_no_parseable_examples_aborts(self):
        # Not a pass-by-default: no examples means nothing anchors the format at all.
        with self.assertRaises(SystemExit):
            _tm.enforce_io_contract({"verified": False, "pairs": [], "mismatches": [],
                                     "reason": "the description states no parseable Examples"})

    def test_an_unconvertible_display_block_aborts(self):
        with self.assertRaises(SystemExit):
            _tm.enforce_io_contract({
                "verified": False, "pairs": [],
                "mismatches": [{"example": 1, "got": _tm.UNCONVERTIBLE}], "reason": ""})

    def test_verification_end_to_end_against_a_disagreeing_reference(self):
        """verify_io_contract itself, no LLM: raw-stdin Examples resolve by subprocess."""
        with tempfile.TemporaryDirectory() as d:
            opt = os.path.join(d, "PY.py")
            with open(opt, "w", encoding="utf-8") as f:
                f.write("import sys\nd=sys.stdin.read().split()\n"
                        "print(sum(map(int,d[1:])) + 1)\n")   # off by one
            desc = ("Add.\n\n**Example 1:**\n\n**Input:**\n\n```\n2\n1 2\n```\n\n"
                    "**Output:**\n\n```\n3\n```\n")
            contract = _tm.verify_io_contract(desc, opt, d)
            self.assertFalse(contract["verified"])
            self.assertEqual(contract["mismatches"][0]["expected"], "3")
            self.assertEqual(contract["mismatches"][0]["got"], "4")
            with self.assertRaises(SystemExit):
                _tm.enforce_io_contract(contract)

    def test_main_actually_calls_the_gate(self):
        """The guard is worthless if main() stops invoking it.

        A source-level check because main() imports llm_client and drives the whole step,
        so exercising it needs the pipeline's own interpreter. Cheap insurance against the
        gate being silently unwired — which is how it read BEFORE this change: the verdict
        was printed and nothing acted on it.
        """
        with open(_TM_SOURCE, encoding="utf-8") as f:
            src = f.read()
        main_body = src[src.index("def main()"):]
        self.assertIn("enforce_io_contract(io_contract)", main_body)
        self.assertIn("format_io_contract(io_contract)", main_body,
                      "the report must still be printed before aborting")


class SignatureExtractionPromptTest(unittest.TestCase):
    """P1-5, second half. The prompt told the model to look for a "Function Signature"
    heading, which the description format deliberately never emits. The name actually
    lives in the **Your Task** bullet, and the parameters in **Input Format**."""

    def setUp(self):
        from Prompts.signatureExtractionPrompt import get_signature_extraction_prompt
        self.prompt = get_signature_extraction_prompt("**Your Task**\n- Complete `foo`.")

    def test_points_at_the_sections_that_actually_exist(self):
        self.assertIn("**Your Task**", self.prompt)
        self.assertIn("**Input Format**", self.prompt)

    def test_no_longer_hunts_for_a_signature_heading(self):
        self.assertNotIn('Look for sections like', self.prompt)
        # It must say so explicitly, not merely omit it — the model would otherwise
        # still default to hunting for a signature block.
        self.assertIn("deliberately contains neither", self.prompt)

    def test_forbids_placeholder_names(self):
        # A placeholder would satisfy _parse_signature and silently rename the reference
        # solution's entry point to something the description never mentions.
        for bad in ("solve", "main", "functionName"):
            self.assertIn(bad, self.prompt)


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class ParseSignatureTest(unittest.TestCase):
    """The old extractor used `re.search(r'\\{.*\\}', ..., re.DOTALL)` — greedy, so it
    spanned the FIRST `{` to the LAST `}`. Harmless while a parse failure only warned;
    now that naming hard-fails it would block the pipeline on a good reply."""

    def test_plain_object(self):
        sig = _gfq._parse_signature('{"function_name": "findPairs", "parameters": ["a"]}')
        self.assertEqual(sig["function_name"], "findPairs")
        self.assertEqual(sig["parameters"], ["a"])

    def test_fenced_object(self):
        raw = '```json\n{"function_name": "find_pairs", "parameters": ["a", "b"]}\n```'
        self.assertEqual(_gfq._parse_signature(raw)["function_name"], "findPairs")

    def test_object_followed_by_prose_containing_braces(self):
        # The greedy regex spanned into the note and produced invalid JSON.
        raw = ('{"function_name": "findPairs", "parameters": ["a"]}\n\n'
               'Note: the driver calls it as {func}(a) at grading time.')
        sig = _gfq._parse_signature(raw)
        self.assertIsNotNone(sig, "prose with braces after the object must not break it")
        self.assertEqual(sig["function_name"], "findPairs")

    def test_two_objects_prefers_the_one_with_a_function_name(self):
        raw = ('{"note": "here is the signature"}\n'
               '{"function_name": "arrangeCourseSequence", "parameters": ["n"]}')
        self.assertEqual(_gfq._parse_signature(raw)["function_name"],
                         "arrangeCourseSequence")

    def test_nested_object_is_not_truncated(self):
        raw = '{"function_name": "foo", "parameters": ["a"], "meta": {"x": {"y": 1}}}'
        self.assertEqual(_gfq._parse_signature(raw)["function_name"], "foo")

    def test_no_json_returns_none(self):
        self.assertIsNone(_gfq._parse_signature("I could not find a signature."))
        self.assertIsNone(_gfq._parse_signature(""))
        self.assertIsNone(_gfq._parse_signature("```"))

    def test_empty_function_name_returns_none(self):
        # Must be None, not a dict with a blank name — naming exits 1 on None, whereas a
        # blank name would rename the reference's entry point to nothing.
        self.assertIsNone(_gfq._parse_signature('{"function_name": "", "parameters": []}'))


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class RendererSafePassTest(unittest.TestCase):
    """P2-11. The pass ran only at scenario_level == "none", so light/moderate/heavy
    descriptions relied on the model having obeyed the no-headings/no-tables rules."""

    def test_reconcile_normalizes_at_every_scenario_level(self):
        # reconcile_description no longer takes scenario_level at all: there is one
        # behaviour, so there is no level at which the pass can be skipped.
        import inspect
        params = inspect.signature(_gfq.reconcile_description).parameters
        self.assertNotIn("scenario_level", params)

    def test_atx_headings_and_tables_are_converted(self):
        raw = ("## Input Format\n\n---\n\n```python\ncode\n```\n\n"
               "| a | b |\n|---|---|\n| 1 | 2 |\n")
        out = _gfq.normalize_renderer_safe(raw)
        self.assertNotIn("## ", out)
        self.assertIn("**Input Format**", out)
        self.assertNotIn("```python", out)
        self.assertNotIn("|---|", out)
        self.assertIn("1", out)      # values preserved
        self.assertIn("2", out)

    def test_values_inside_fences_are_untouched(self):
        raw = "```\n# not a heading\n| not | a table |\n```\n"
        self.assertIn("# not a heading", _gfq.normalize_renderer_safe(raw))


class IndexedNamedVarBlockTest(unittest.TestCase):
    """A description that renders a list of pairs one element per line —
    `prerequisites[0] = [2, 0]` — is still showing named variables.

    _NAMED_VAR_LINE_RE rejected the index, so the block failed
    is_named_var_example_block, was taken for RAW STDIN, and the display text was piped
    to the reference. It printed nothing, and the pipeline announced that the reference
    "FAILS the description's own worked examples" — a false accusation against a correct
    solution. Caught by a live run, where the model happened to pick this rendering.
    """

    BLOCK = ("numCourses = 6\nm = 6\n"
             "prerequisites[0] = [2, 0]\nprerequisites[1] = [2, 1]\n"
             "prerequisites[2] = [3, 1]")

    def _desc(self, block, out):
        return (f"**Example 1:**\n\n**Input:**\n\n```\n{block}\n```\n\n"
                f"**Output:**\n\n```\n{out}\n```\n")

    def test_indexed_assignments_count_as_a_named_var_block(self):
        from benchmark_suite import is_named_var_example_block
        self.assertTrue(is_named_var_example_block(self.BLOCK))

    def test_plain_named_vars_still_count(self):
        from benchmark_suite import is_named_var_example_block
        self.assertTrue(is_named_var_example_block("n = 4\na = [1, 2]"))

    def test_raw_stdin_blocks_are_still_not_named_var(self):
        from benchmark_suite import is_named_var_example_block
        self.assertFalse(is_named_var_example_block("6\n6\n2 0\n2 1"))

    def test_display_block_is_never_offered_as_raw_stdin(self):
        from benchmark_suite import extract_example_io, extract_named_var_example_io
        desc = self._desc(self.BLOCK, "0 1 2 3 4 5")
        self.assertEqual(extract_example_io(desc), [],
                         "piping the display form to the reference falsely brands it buggy")
        self.assertEqual(len(extract_named_var_example_io(desc)), 1)

    def test_indexed_lines_survive_parsing_into_stdin(self):
        from benchmark_suite import named_var_stdin_candidates
        # Losing the indexed lines would yield a candidate with the counts but no data.
        self.assertEqual(named_var_stdin_candidates(self.BLOCK)[0],
                         "6\n6\n2 0\n2 1\n3 1\n")

    def test_variable_names_keep_their_index(self):
        from benchmark_suite import parse_named_var_block
        names = [n for n, _ in parse_named_var_block(self.BLOCK)]
        self.assertEqual(names,
                         ["numCourses", "m", "prerequisites[0]",
                          "prerequisites[1]", "prerequisites[2]"])


class CrosscheckNoiseTest(unittest.TestCase):
    """The sweep reported disagreements on synthesized inputs the reference could not
    parse. structured_random_inputs cannot reproduce a nested "count then N pairs"
    shape, so the reference printed nothing and the brute printed -1."""

    def test_empty_reference_output_is_not_a_disagreement(self):
        from benchmark_suite import crosscheck_optimal_brute
        # Reference prints nothing; brute prints -1. Malformed input, not a defect.
        optimal = "import sys\nsys.stdin.read()\n"
        brute = "import sys\nsys.stdin.read()\nprint(-1)\n"
        self.assertEqual(
            crosscheck_optimal_brute(optimal, brute, ["1 2\n"], count=0), [])

    def test_empty_BRUTE_output_is_not_a_disagreement_either(self):
        """The filter must not be one-sided.

        Both directions were seen live on the same problem: first `optimal='' brute=-1`,
        then after other fixes `optimal=-1 brute=''`. Nothing can be concluded from an
        oracle that produced no output, whichever oracle it is.
        """
        from benchmark_suite import crosscheck_optimal_brute
        optimal = "import sys\nsys.stdin.read()\nprint(-1)\n"
        brute = "import sys\nsys.stdin.read()\n"
        self.assertEqual(
            crosscheck_optimal_brute(optimal, brute, ["1 2\n"], count=0), [])

    def test_a_real_disagreement_is_still_reported(self):
        from benchmark_suite import crosscheck_optimal_brute
        optimal = "import sys\nsys.stdin.read()\nprint(1)\n"
        brute = "import sys\nsys.stdin.read()\nprint(2)\n"
        found = crosscheck_optimal_brute(optimal, brute, ["1 2\n"], count=0)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["optimal"], "1")
        self.assertEqual(found[0]["brute"], "2")


class PromptFormatAgreementTest(unittest.TestCase):
    """P1-6. descriptionPrompt said write `[1, 2, 3]`; normalizationPrompt said print
    `[1,2,3]`. verify_io_contract then compared the two byte-for-byte."""

    def test_normalizer_demands_the_compact_output_form(self):
        from Prompts.normalizationPrompt import get_normalization_prompt

        self.assertIn("[1,2,3]", get_normalization_prompt("x = 1", "python"))

    def test_scenario_prompts_scope_the_array_rule_to_where_it_appears(self):
        """The rule must be scoped to WHERE the array sits.

        Both SCENARIO prompt bodies used to state a blanket rule — "ALWAYS format arrays
        with spaces after commas" (function) and "Arrays with spaces after commas"
        (non-function) — which the normalizer then flatly contradicts for stdout. On
        non-function problems verify_io_contract compares stdout byte-for-byte, so the
        disagreement burned repair attempts; on function problems it merely shipped a
        statement that lied about the printed answer.

        `scenario_level="none"` is deliberately NOT tested here: it routes to
        get_structure_only_prompt / get_nonfunction_structure_only_prompt, which carry no
        array-spacing rule at all and so never conflicted.
        """
        from Prompts.descriptionPrompt import (get_description_prompt,
                                               get_nonfunction_description_prompt)

        for name, prompt in (
            ("function", get_description_prompt("P", "standard", "x = 1", "moderate")),
            ("nonfunction",
             get_nonfunction_description_prompt("P", "standard", "x = 1", "moderate")),
        ):
            with self.subTest(prompt=name):
                self.assertNotIn("ALWAYS format arrays with spaces", prompt)
                # Both forms must be demonstrated. Matched structurally: the two prompts
                # use different sample arrays ([1,2,3,4,5] vs [1,2,3]), and pinning the
                # element count would make this test fail on a harmless wording change.
                self.assertRegex(prompt, r"\[\d+(,\d+)+\]", "no compact array example")
                self.assertRegex(prompt, r"\[\d+(, \d+)+\]", "no spaced array example")
                # And the compact form must be the one tied to the Output block.
                self.assertIn("NO spaces after commas", prompt)
                self.assertIn("**Output:**", prompt)

    def test_structure_only_prompts_state_no_conflicting_array_rule(self):
        """These two bodies are used when scenario_level == "none"."""
        from Prompts.descriptionPrompt import (get_structure_only_prompt,
                                               get_nonfunction_structure_only_prompt)

        for name, prompt in (
            ("function", get_structure_only_prompt("P", "standard", "x = 1")),
            ("nonfunction",
             get_nonfunction_structure_only_prompt("P", "standard", "x = 1")),
        ):
            with self.subTest(prompt=name):
                self.assertNotIn("spaces after commas", prompt)


if __name__ == "__main__":
    unittest.main()
