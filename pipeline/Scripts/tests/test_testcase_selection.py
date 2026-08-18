import unittest

from testcase_selection import (
    bucket_size,
    bucket_case,
    normalize_input,
    dedup_by_input,
)


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


class TestBucketCase(unittest.TestCase):
    def test_declared_edge_beats_size(self):
        self.assertEqual(bucket_case({"size_metric": 30, "is_edge": True}, 100000), "edge")

    def test_stress_size_beats_declared_edge(self):
        # Marking cases `is_edge` must never drain the large bucket.
        self.assertEqual(bucket_case({"size_metric": 90000, "is_edge": True}, 100000), "large")

    def test_no_size_dimension_is_flat(self):
        self.assertEqual(bucket_case({"size_metric": 7}, 0, size_kind="none"), "flat")


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


if __name__ == "__main__":
    unittest.main()
