import json
import os
import tempfile
import unittest

from testcase_annotate import (
    load_cases,
    determine_size_model,
    annotate_kills,
    annotate_tle,
    write_selected,
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
            self.assertTrue(cases[1]["is_edge"])          # size_edge tag
            self.assertEqual(max_n, 100000)

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
        def one(code, stdin):
            return ("", "timeout") if stdin == "big" else ("ok", "ok")
        n = annotate_tle(cases, "brute", one, max_n=100, size_kind="count")
        self.assertEqual(n, 1)
        self.assertTrue(cases[0]["is_tle"])   # large -> timed out
        self.assertFalse(cases[1]["is_tle"])  # small -> not even run

    def test_no_brute_is_na(self):
        cases = [{"id": "c1", "input": "x", "size_metric": 100, "is_tle": False}]
        n = annotate_tle(cases, None, lambda c, s: ("", "timeout"), max_n=100)
        self.assertEqual(n, 0)

    def test_size_none_skips_tle(self):
        cases = [{"id": "c1", "input": "x", "size_metric": 100, "is_tle": False}]
        n = annotate_tle(cases, "brute", lambda c, s: ("", "timeout"),
                         max_n=100, size_kind="none")
        self.assertEqual(n, 0)


class TestWriteSelected(unittest.TestCase):
    def test_writes_only_selected_renumbered_shape_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "testcases.json")
            _write_tc(p, [
                {"order": 1, "input": "a", "output": "1", "tags": ["subtask_1"], "weightage": 5},
                {"order": 2, "input": "b", "output": "2", "tags": ["subtask_1"], "weightage": 5},
                {"order": 3, "input": "c", "output": "3", "tags": ["subtask_2"], "weightage": 5},
            ])
            selected = [
                {"_raw": {"order": 3, "input": "c", "output": "3", "tags": ["subtask_2"], "weightage": 5}},
                {"_raw": {"order": 1, "input": "a", "output": "1", "tags": ["subtask_1"], "weightage": 5}},
            ]
            write_selected(p, selected)
            with open(p) as f:
                data = json.load(f)
            tcs = data[0]["test_cases"]
            self.assertEqual(len(tcs), 2)
            self.assertEqual([t["order"] for t in tcs], [1, 2])   # renumbered
            self.assertEqual([t["input"] for t in tcs], ["c", "a"])  # selection order
            self.assertEqual(tcs[0]["tags"], ["subtask_2"])          # tags preserved


if __name__ == "__main__":
    unittest.main()
