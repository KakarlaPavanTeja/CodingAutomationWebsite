import copy
import unittest

from testcase_selection import (
    bucket_size,
    normalize_input,
    dedup_by_input,
    guarantee_pass,
    select_suite,
    format_funnel,
)


def mk(id, subtask, bucket, scenario, kills=(), is_edge=False, is_tle=False, size=10):
    return {"id": id, "input": id, "output": "", "subtask": subtask,
            "bucket": bucket, "scenario": scenario, "is_edge": is_edge,
            "is_tle": is_tle, "size_metric": size, "max_n": 100,
            "kills": set(kills)}


class TestBucketSize(unittest.TestCase):
    def test_edge_is_degenerate(self):
        self.assertEqual(bucket_size(0, 100000), "edge")
        self.assertEqual(bucket_size(1, 100000), "edge")

    def test_small_up_to_20pct(self):
        self.assertEqual(bucket_size(20, 100000), "small")
        self.assertEqual(bucket_size(20000, 100000), "small")

    def test_large_at_half_max(self):
        self.assertEqual(bucket_size(50000, 100000), "large")
        self.assertEqual(bucket_size(100000, 100000), "large")

    def test_medium_between(self):
        self.assertEqual(bucket_size(20001, 100000), "medium")
        self.assertEqual(bucket_size(49999, 100000), "medium")

    def test_tiny_max_n_still_orders(self):
        self.assertEqual(bucket_size(1, 4), "edge")
        self.assertEqual(bucket_size(4, 4), "large")


class TestDedup(unittest.TestCase):
    def test_normalize_collapses_trailing_ws_and_newlines(self):
        self.assertEqual(normalize_input("1 2 3\n"), normalize_input("1 2 3"))
        self.assertEqual(normalize_input("1 2 3 \n\n"), normalize_input("1 2 3"))

    def test_normalize_preserves_internal_structure(self):
        self.assertNotEqual(normalize_input("1 2\n3 4"), normalize_input("1 2 3 4"))

    def test_dedup_keeps_first_drops_exact_dupes(self):
        cases = [
            {"id": "a", "input": "1 2 3"},
            {"id": "b", "input": "1 2 3\n"},
            {"id": "c", "input": "4 5 6"},
        ]
        unique, dropped = dedup_by_input(cases)
        self.assertEqual([c["id"] for c in unique], ["a", "c"])
        self.assertEqual(dropped, 1)

    def test_dedup_keeps_different_inputs(self):
        cases = [{"id": "a", "input": "1 1"}, {"id": "b", "input": "1 2"}]
        unique, dropped = dedup_by_input(cases)
        self.assertEqual(dropped, 0)


class TestGuaranteePass(unittest.TestCase):
    def test_all_edges_included(self):
        cases = [mk("e1", "S1", "edge", "min", is_edge=True),
                 mk("e2", "S1", "edge", "empty", is_edge=True),
                 mk("n1", "S1", "small", "x")]
        selected, rep = guarantee_pass(cases, wrong_ids=set())
        ids = {c["id"] for c in selected}
        self.assertIn("e1", ids)
        self.assertIn("e2", ids)

    def test_all_tle_included(self):
        cases = [mk("t1", "S3", "large", "maxn", is_tle=True), mk("n1", "S1", "small", "x")]
        selected, rep = guarantee_pass(cases, wrong_ids=set())
        self.assertIn("t1", {c["id"] for c in selected})
        self.assertEqual(rep["tle"], 1)

    def test_each_slot_covered_once(self):
        cases = [mk("a", "S1", "small", "x"), mk("b", "S1", "small", "x"),
                 mk("c", "S1", "small", "y")]
        selected, rep = guarantee_pass(cases, wrong_ids=set())
        self.assertEqual(rep["slots_filled"], 2)

    def test_kill_completion_covers_all_wrong(self):
        cases = [mk("a", "S1", "small", "x", kills=("w1",)),
                 mk("b", "S1", "small", "x", kills=("w2",))]
        selected, rep = guarantee_pass(cases, wrong_ids={"w1", "w2"})
        self.assertEqual(rep["kills_covered"], 2)
        self.assertEqual(rep["uncatchable"], [])

    def test_uncatchable_wrong_reported(self):
        cases = [mk("a", "S1", "small", "x", kills=("w1",))]
        selected, rep = guarantee_pass(cases, wrong_ids={"w1", "w2"})
        self.assertEqual(rep["uncatchable"], ["w2"])


class TestCapIsACeiling(unittest.TestCase):
    """A pool where (almost) every case is a must-keep must still respect the cap.

    Regression: a mis-derived `size_edge` tag once marked all 10531 generated cases
    `is_edge`, and the unbounded guarantee pass shipped every one of them.
    """

    def _all_edge_pool(self, n):
        # `bucket` is left in place so guarantee_pass can be called directly;
        # select_suite recomputes it either way.
        pool = []
        for i in range(n):
            c = mk(f"c{i:04d}", "S1", "small", f"s{i % 7}", is_edge=True)
            c["input"] = c["id"]
            pool.append(c)
        return pool

    def test_guarantee_pass_never_exceeds_cap(self):
        sel, rep = guarantee_pass(self._all_edge_pool(500), wrong_ids=set(), cap=150)
        self.assertEqual(len(sel), 150)
        self.assertEqual(rep["edges_total"], 500)
        self.assertTrue(rep["capped"])

    def test_select_suite_never_exceeds_cap(self):
        selected, rep = select_suite(self._all_edge_pool(500), set(), max_n=100, cap=150)
        self.assertEqual(len(selected), 150)
        self.assertEqual(rep["selected"], 150)

    def test_examples_survive_the_cap(self):
        pool = self._all_edge_pool(500)
        pool[400]["scenario"] = "example"      # not first in id order
        selected, _rep = select_suite(pool, set(), max_n=100, cap=10)
        self.assertIn("c0400", {c["id"] for c in selected})
        self.assertEqual(len(selected), 10)

    def test_kill_cover_wins_over_edges_under_cap(self):
        # Only one case kills w1, and it is NOT an edge — it must still be selected
        # even though 500 edges are competing for a cap of 5.
        pool = self._all_edge_pool(500)
        killer = mk("z999", "S1", "small", "s0", kills=("w1",), is_edge=False)
        killer["input"] = killer["id"]
        selected, rep = select_suite(pool + [killer], {"w1"}, max_n=100, cap=5)
        self.assertIn("z999", {c["id"] for c in selected})
        self.assertEqual(rep["kills_covered"], 1)

    def test_truncation_is_reported_not_silent(self):
        _sel, rep = guarantee_pass(self._all_edge_pool(500), wrong_ids=set(), cap=150)
        rep.update({"generated": 500, "unique": 500, "selected": 150})
        self.assertIn("CAPPED: kept 150/500 edge(s)", format_funnel(rep))


class TestSelectSuite(unittest.TestCase):
    def _pool(self, n):
        pool = []
        for i in range(n):
            c = mk(f"c{i:03d}", "S1", "small", f"s{i % 5}", size=10)
            c["input"] = c["id"]
            c.pop("bucket")
            pool.append(c)
        return pool

    def test_fills_up_to_cap(self):
        selected, rep = select_suite(self._pool(300), wrong_ids=set(), max_n=100, cap=150)
        self.assertEqual(len(selected), 150)
        self.assertEqual(rep["selected"], 150)

    def test_dedup_before_select(self):
        a = mk("a", "S1", "small", "x"); a["input"] = "same"; a.pop("bucket")
        b = mk("b", "S1", "small", "x"); b["input"] = "same"; b.pop("bucket")
        selected, rep = select_suite([a, b], wrong_ids=set(), max_n=100, cap=150)
        self.assertEqual(rep["unique"], 1)
        self.assertEqual(len(selected), 1)

    def test_below_floor_flagged(self):
        selected, rep = select_suite(self._pool(3), wrong_ids=set(), max_n=100, cap=150, floor=25)
        self.assertTrue(rep["below_floor"])

    def test_deterministic(self):
        pool = self._pool(200)
        a, _ = select_suite(copy.deepcopy(pool), set(), 100)
        b, _ = select_suite(copy.deepcopy(pool), set(), 100)
        self.assertEqual([c["id"] for c in a], [c["id"] for c in b])


class TestSizeKindNone(unittest.TestCase):
    def test_flat_bucket_when_no_size_dimension(self):
        cases = []
        for i in range(6):
            c = mk(f"c{i}", "S1", "small", f"s{i % 3}")
            c["input"] = c["id"]
            c.pop("bucket")
            cases.append(c)
        selected, rep = select_suite(cases, set(), max_n=0, size_kind="none")
        self.assertTrue(all(c["bucket"] == "flat" for c in selected))
        self.assertEqual(rep["slots_total"], 3)   # subtask x scenario only
        self.assertEqual(rep["size_kind"], "none")


class TestExhaustive(unittest.TestCase):
    def test_small_exhaustive_is_complete_not_below_floor(self):
        cases = []
        for i in range(10):
            c = mk(f"c{i:02d}", "S1", "small", f"s{i}")
            c["input"] = c["id"]
            c.pop("bucket")
            cases.append(c)
        selected, rep = select_suite(cases, set(), max_n=100, floor=25,
                                     space_mode="exhaustive")
        self.assertEqual(len(selected), 10)          # shipped the whole space
        self.assertFalse(rep["below_floor"])         # not a shortfall
        self.assertTrue(rep["exhaustive_complete"])

    def test_sampled_below_floor_still_flags(self):
        cases = []
        for i in range(5):
            c = mk(f"c{i}", "S1", "small", f"s{i}")
            c["input"] = c["id"]
            c.pop("bucket")
            cases.append(c)
        selected, rep = select_suite(cases, set(), max_n=100, floor=25,
                                     space_mode="sampled")
        self.assertTrue(rep["below_floor"])


class TestFunnel(unittest.TestCase):
    def test_one_line_summary(self):
        rep = {"generated": 250, "unique": 231, "selected": 150, "edges": 9, "tle": 4,
               "slots_filled": 30, "slots_total": 30, "kills_covered": 6, "kills_total": 6,
               "uncatchable": [], "below_floor": False}
        s = format_funnel(rep)
        self.assertIn("generated 250", s)
        self.assertIn("unique 231", s)
        self.assertIn("selected 150", s)
        self.assertIn("slots 30/30", s)
        self.assertIn("kills 6/6", s)

    def test_flags_uncatchable_and_floor(self):
        rep = {"generated": 30, "unique": 20, "selected": 18, "edges": 2, "tle": 0,
               "slots_filled": 5, "slots_total": 6, "kills_covered": 4, "kills_total": 5,
               "uncatchable": ["w5"], "below_floor": True}
        s = format_funnel(rep)
        self.assertIn("BELOW FLOOR", s)
        self.assertIn("uncatchable: w5", s)


if __name__ == "__main__":
    unittest.main()
