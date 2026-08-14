import json
import os
import tempfile
import unittest

from testcase_annotate import (
    load_cases,
    determine_size_model,
    annotate_kills,
    annotate_tle,
    count_dead_cases,
    ship_order,
)


def _write_tc(path, cases, wrapped=True):
    body = {"test_cases": cases}
    with open(path, "w", encoding="utf-8") as f:
        json.dump([body] if wrapped else body, f)


class TestLoadCases(unittest.TestCase):
    def test_adapts_tags_to_record_fields(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "testcases.json")
            _write_tc(p, [
                {"order": 1, "input": "3\n1 2 3", "output": "6",
                 "tags": ["subtask_1", "size_small", "example"], "weightage": 5},
                {"order": 2, "input": "1\n5", "output": "5",
                 "tags": ["subtask_2", "size_edge", "duplicates"], "weightage": 5},
            ])
            cases, max_n = load_cases(p, description="1 <= n <= 100000")
            self.assertEqual(cases[0]["id"], "c0001")
            self.assertEqual(cases[0]["subtask"], "S1")
            self.assertEqual(cases[0]["scenario"], "example")
            self.assertTrue(cases[0]["is_edge"])          # example -> always-keep
            self.assertEqual(cases[0]["size_metric"], 3)  # first int of stdin
            self.assertEqual(cases[1]["scenario"], "duplicates")
            # A `size_edge` TAG must NOT make a case must-keep: it is a distribution
            # label, and treating it as a keep marker once shipped a 10531-case suite.
            self.assertFalse(cases[1]["is_edge"])
            self.assertEqual(max_n, 100000)

    def test_size_edge_tag_is_not_a_keep_marker(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "testcases.json")
            _write_tc(p, [
                {"order": 1, "input": "N = 7\nC = 0", "output": "false",
                 "tags": ["subtask_1", "size_edge"], "size_metric": 7},
                {"order": 2, "input": "N = 8\nC = 0", "output": "false",
                 "tags": ["subtask_1", "size_edge"], "size_metric": 8,
                 "is_edge": True},
            ])
            cases, _ = load_cases(p, description="1 <= N <= 10000")
            self.assertFalse(cases[0]["is_edge"])   # tag alone: not an edge
            self.assertTrue(cases[1]["is_edge"])    # explicit field: still honored

    def test_example_tag_outranks_a_per_case_declared_scenario(self):
        """Everything that treats examples specially matches `scenario == "example"`.

        Regression (problem 66f6b0a9): the generator declared per-case names
        ("example_1", "example_2") alongside the `example` tag. Taking the declared
        name verbatim made every such match miss, and both public examples were
        dropped from the shipped suite once the cap filled.
        """
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "testcases.json")
            _write_tc(p, [
                {"order": 1, "input": "4\n7\n10\n1\n29\n", "output": "yes\nno\nno\nyes",
                 "tags": ["size_small", "example", "example_1"], "scenario": "example_1"},
                {"order": 2, "input": "5\n2\n9\n97\n100\n49\n",
                 "output": "yes\nno\nyes\nno\nno",
                 "tags": ["example", "example_2", "size_medium"], "scenario": "example_2"},
            ])
            cases, _ = load_cases(p, description="1 <= T <= 20")
            self.assertEqual([c["scenario"] for c in cases], ["example", "example"])
            self.assertTrue(all(c["is_edge"] for c in cases))

    def test_prefers_declared_size_metric(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "testcases.json")
            _write_tc(p, [{"order": 1, "input": "x", "output": "y",
                           "size_metric": 42, "subtask": "S3",
                           "scenario": "answer_end", "is_edge": True}])
            cases, _ = load_cases(p, description="n <= 1000")
            self.assertEqual(cases[0]["size_metric"], 42)
            self.assertEqual(cases[0]["subtask"], "S3")
            self.assertEqual(cases[0]["scenario"], "answer_end")

    def test_dict_wrapped_shape(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "testcases.json")
            _write_tc(p, [{"order": 1, "input": "2\n1 1", "output": "2",
                           "tags": ["subtask_1"]}], wrapped=False)
            cases, _ = load_cases(p, description="n <= 10")
            self.assertEqual(len(cases), 1)

    def test_reads_root_size_model_and_max_n(self):
        # New generator: root carries size_model/space_mode; declared max_n wins.
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "testcases.json")
            body = {"test_cases": [{"order": 1, "input": "abc", "output": "3",
                                    "size_metric": 3, "scenario": "s", "tags": ["subtask_1"]}],
                    "size_model": {"kind": "grid", "max_n": 999},
                    "space_mode": "exhaustive"}
            with open(p, "w") as f:
                json.dump([body], f)
            cases, max_n = load_cases(p, description="1 <= n <= 50")  # description says 50
            self.assertEqual(max_n, 999)                    # declared max_n wins over parse
            self.assertEqual(cases[0]["size_kind"], "grid")
            self.assertEqual(cases[0]["space_mode"], "exhaustive")
            kind, space = determine_size_model(cases, max_n)
            self.assertEqual((kind, space), ("grid", "exhaustive"))


class TestSizeModel(unittest.TestCase):
    def test_none_when_no_dimension(self):
        cases = [{"size_metric": 0, "_raw": {}}, {"size_metric": 1, "_raw": {}}]
        kind, mode = determine_size_model(cases, max_n=0)
        self.assertEqual(kind, "none")
        self.assertEqual(mode, "sampled")

    def test_count_when_dimension_present(self):
        cases = [{"size_metric": 50, "_raw": {}}, {"size_metric": 2, "_raw": {}}]
        kind, mode = determine_size_model(cases, max_n=100)
        self.assertEqual(kind, "count")

    def test_declared_model_wins(self):
        cases = [{"size_metric": 0, "_raw": {"size_kind": "grid", "space_mode": "exhaustive"}}]
        kind, mode = determine_size_model(cases, max_n=0)
        self.assertEqual(kind, "grid")
        self.assertEqual(mode, "exhaustive")


class TestAnnotateKills(unittest.TestCase):
    def _cases(self):
        return [
            {"id": "c1", "input": "a", "output": "1", "kills": set()},
            {"id": "c2", "input": "b", "output": "2", "kills": set()},
        ]

    def test_case_kills_when_output_differs(self):
        cases = self._cases()
        # wrong "w1": correct on c1 ("1"), wrong on c2 ("9" != "2")
        def batch(code, inputs):
            return [("1", "ok"), ("9", "ok")]
        wrong_ids = annotate_kills(cases, [("w1", "code")], batch)
        self.assertEqual(wrong_ids, {"w1"})
        self.assertEqual(cases[0]["kills"], set())
        self.assertEqual(cases[1]["kills"], {"w1"})

    def test_timeout_and_error_count_as_kill(self):
        cases = self._cases()
        def batch(code, inputs):
            return [("", "timeout"), ("boom", "error")]
        annotate_kills(cases, [("w1", "c")], batch)
        self.assertEqual(cases[0]["kills"], {"w1"})
        self.assertEqual(cases[1]["kills"], {"w1"})

    def test_normalization_trailing_ws(self):
        cases = [{"id": "c1", "input": "a", "output": "1\n", "kills": set()}]
        def batch(code, inputs):
            return [("1", "ok")]        # "1" vs stored "1\n" -> equal after normalize
        annotate_kills(cases, [("w1", "c")], batch)
        self.assertEqual(cases[0]["kills"], set())


class TestAnnotateTle(unittest.TestCase):
    def test_timeout_on_large_marks_tle(self):
        cases = [
            {"id": "c1", "input": "big", "size_metric": 100, "is_tle": False},
            {"id": "c2", "input": "small", "size_metric": 2, "is_tle": False},
        ]
        # batch runner: receives only the large-case inputs, returns aligned statuses
        def batch(code, inputs):
            return [("", "timeout") if i == "big" else ("ok", "ok") for i in inputs]
        n = annotate_tle(cases, "brute", batch, max_n=100, size_kind="count")
        self.assertEqual(n, 1)
        self.assertTrue(cases[0]["is_tle"])   # large -> timed out
        self.assertFalse(cases[1]["is_tle"])  # small -> not even sent to the batch

    def test_no_brute_is_na(self):
        cases = [{"id": "c1", "input": "x", "size_metric": 100, "is_tle": False}]
        n = annotate_tle(cases, None, lambda c, ins: [("", "timeout")], max_n=100)
        self.assertEqual(n, 0)

    def test_size_none_skips_tle(self):
        cases = [{"id": "c1", "input": "x", "size_metric": 100, "is_tle": False}]
        n = annotate_tle(cases, "brute", lambda c, ins: [("", "timeout")],
                         max_n=100, size_kind="none")
        self.assertEqual(n, 0)


class TestShipOrder(unittest.TestCase):
    """Selection order is a keep-argument, not a reading order — see `ship_order`."""

    def _case(self, inp, tags, out="x"):
        return {"input": inp, "output": out, "tags": list(tags), "weightage": 5}

    def test_examples_lead_then_sizes_ascend(self):
        # Selection order here is the real one: a big kill-cover case first (that pass
        # ranks by DESCENDING size), then the example, then slot coverage.
        cases = [
            self._case("stress", ["subtask_3"]),
            self._case("ex1", ["subtask_1", "example"]),
            self._case("mid", ["subtask_2"]),
        ]
        self.assertEqual([c["input"] for c in ship_order(cases)], ["ex1", "mid", "stress"])

    def test_size_beats_subtask_tier(self):
        # A generator's own semantic subtask_<n> tags need not run small -> large, and
        # grading order must: the smallest case ships first whatever tier it carries.
        cases = [
            self._case("x" * 200, ["subtask_1"]),
            self._case("s", ["subtask_4"]),
            self._case("x" * 20, ["subtask_2"]),
        ]
        self.assertEqual([len(c["input"]) for c in ship_order(cases)], [1, 20, 200])

    def test_falls_back_to_payload_size_without_subtask_tags(self):
        cases = [self._case("longer input", []), self._case("s", [])]
        self.assertEqual([c["input"] for c in ship_order(cases)], ["s", "longer input"])

    def test_example_is_never_demoted_out_of_the_public_slots(self):
        # is_hidden is positional (order > 2), so an example sorted into tier 3 by
        # payload size would silently vanish from the problem statement.
        big_example = self._case("x" * 500, ["subtask_3", "example"])
        cases = [self._case("a", ["subtask_1"]), big_example, self._case("b", ["subtask_1"])]
        self.assertIs(ship_order(cases)[0], big_example)


class TestAnnotationDoesNotTrim(unittest.TestCase):
    def test_counts_cases_that_killed_nothing(self):
        """The selector's signal without the selector's authority."""
        cases = [
            {"id": 0, "kills": {"a.py"}, "input": "1\n", "output": "1"},
            {"id": 1, "kills": set(), "input": "2\n", "output": "1"},
            {"id": 2, "kills": set(), "input": "3\n", "output": "1"},
        ]
        self.assertEqual(count_dead_cases(cases), 2)

    def test_all_cases_dead_is_reported_not_crashed(self):
        cases = [{"id": 0, "kills": set(), "input": "1\n", "output": "1"}]
        self.assertEqual(count_dead_cases(cases), 1)

    def test_no_cases_is_zero(self):
        self.assertEqual(count_dead_cases([]), 0)

    def test_selector_entry_points_are_gone(self):
        """The suite ships as generated; nothing may trim it."""
        import testcase_selection as ts
        for name in ("select_suite", "guarantee_pass", "fill_target", "format_funnel",
                     "CASE_CAP", "CASE_FLOOR"):
            self.assertFalse(hasattr(ts, name), f"{name} should have been deleted")


if __name__ == "__main__":
    unittest.main()
