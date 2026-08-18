"""Tests for derive_subtasks: semantic grouping -> demand-ordered numbering + weights.

A subtask is WHAT a case validates, not how big its input is. The model names the
group; we number the groups by demand so weights come out monotonic for free, and
give every case in a group the same weight.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import derive_subtasks  # noqa: E402


def case(subtask, n, tags=None, order=1):
    """A minimal case whose first input token is its size."""
    return {
        "input": f"{n}\n" + " ".join("1" for _ in range(max(n, 1))) + "\n",
        "output": "1",
        "subtask": subtask,
        "tags": list(tags or []),
        "order": order,
    }


class TestDeriveSubtasks(unittest.TestCase):
    def test_groups_are_numbered_by_ascending_demand(self):
        cases = [
            case("max_constraint_performance", 100000),
            case("empty_and_singleton", 1),
            case("all_equal_elements", 10),
        ]
        names = derive_subtasks(cases, "count", 100000)
        by_subtask = {c["subtask"]: c["tags"] for c in cases}
        self.assertIn("subtask_1", by_subtask["empty_and_singleton"])
        self.assertIn("subtask_3", by_subtask["max_constraint_performance"])
        self.assertEqual(names["subtask_1"], "Empty And Singleton")
        self.assertEqual(names["subtask_3"], "Max Constraint Performance")

    def test_every_case_in_a_group_shares_one_weight(self):
        cases = [
            case("mixed_group", 1),
            case("mixed_group", 100000),
            case("mixed_group", 10),
        ]
        derive_subtasks(cases, "count", 100000)
        weights = {c["weightage"] for c in cases}
        self.assertEqual(len(weights), 1, "one group must carry exactly one weight")
        # The group holds a large case, so it is weighted as large.
        self.assertEqual(weights.pop(), 4.0)

    def test_stress_tag_multiplies_the_group_weight(self):
        cases = [case("perf", 100000, tags=["stress"])]
        derive_subtasks(cases, "count", 100000)
        self.assertEqual(cases[0]["weightage"], 6.0)  # 4.0 large * 1.5 stress

    def test_edge_only_group_gets_the_floor_weight(self):
        cases = [case("degenerate", 1)]
        derive_subtasks(cases, "count", 100000)
        self.assertEqual(cases[0]["weightage"], 1.0)

    def test_exactly_one_subtask_tag_per_case_and_no_stale_tags(self):
        cases = [case("grp_a", 5, tags=["subtask_9", "stress"])]
        derive_subtasks(cases, "count", 100000)
        subtask_tags = [t for t in cases[0]["tags"] if t.startswith("subtask_")]
        self.assertEqual(subtask_tags, ["subtask_1"], "stale subtask tag must be replaced")
        self.assertIn("stress", cases[0]["tags"], "non-subtask tags survive")

    def test_missing_subtask_name_falls_back_without_crashing(self):
        cases = [{"input": "1\n1\n", "output": "1", "tags": [], "order": 1}]
        names = derive_subtasks(cases, "count", 100000)
        self.assertTrue(any(t.startswith("subtask_") for t in cases[0]["tags"]))
        self.assertEqual(len(names), 1)

    def test_numbering_is_stable_for_equal_demand(self):
        cases = [case("beta_group", 5), case("alpha_group", 5)]
        first = derive_subtasks(cases, "count", 100000)
        cases2 = [case("alpha_group", 5), case("beta_group", 5)]
        second = derive_subtasks(cases2, "count", 100000)
        self.assertEqual(first, second, "equal demand must tie-break by name, not input order")


if __name__ == "__main__":
    unittest.main()
