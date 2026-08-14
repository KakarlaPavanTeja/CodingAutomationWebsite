"""The derive step computes what we never asked the model for.

It replaced a repair step that overrode the model's own claims. Dedup lives here now —
the selector used to do it and the selector is gone.
"""

import json
import os
import sys
import tempfile
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

# testcase_manager_v4 -> llm_client -> httpx. The network deps are never exercised
# here, so stub the ones this checkout may not have installed.
for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

import testcase_manager_v4 as tm  # noqa: E402

DESCRIPTION = "Sum an array.\n\nConstraints\n1 <= n <= 100000\n"


def write_suite(cases, space_mode="sampled"):
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    root = [{"test_cases": cases,
             "size_model": {"kind": "count", "max_n": 100000},
             "space_mode": space_mode}]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(root, f)
    return path


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)[0]


def case(subtask, n):
    return {"input": f"{n}\n" + " ".join("1" for _ in range(max(n, 1))) + "\n",
            "output": "1", "subtask": subtask, "scenario": subtask, "is_edge": n <= 1}


class TestDeriveAndNormalize(unittest.TestCase):
    def test_removes_exact_input_duplicates(self):
        path = write_suite([case("a", 5), case("a", 5), case("b", 10)])
        report = tm.derive_and_normalize(path, DESCRIPTION)
        self.assertEqual(report["duplicates"], 1)
        self.assertEqual(len(load(path)["test_cases"]), 2)
        os.unlink(path)

    def test_assigns_size_tags_and_subtask_tags(self):
        path = write_suite([case("tiny", 1), case("huge", 100000)])
        tm.derive_and_normalize(path, DESCRIPTION)
        for tc in load(path)["test_cases"]:
            self.assertTrue(any(t.startswith("size_") for t in tc["tags"]))
            self.assertTrue(any(t.startswith("subtask_") for t in tc["tags"]))
        os.unlink(path)

    def test_renumbers_order_contiguously_from_one(self):
        path = write_suite([case("a", 5), case("b", 10), case("c", 20)])
        tm.derive_and_normalize(path, DESCRIPTION)
        orders = [tc["order"] for tc in load(path)["test_cases"]]
        self.assertEqual(orders, [1, 2, 3])
        os.unlink(path)

    def test_every_case_ends_with_a_positive_weight(self):
        path = write_suite([case("a", 5), case("b", 100000)])
        tm.derive_and_normalize(path, DESCRIPTION)
        for tc in load(path)["test_cases"]:
            self.assertGreater(float(tc["weightage"]), 0)
        os.unlink(path)

    def test_writes_the_subtask_names_map_to_the_root(self):
        path = write_suite([case("empty_and_singleton", 1)])
        tm.derive_and_normalize(path, DESCRIPTION)
        names = load(path)["subtask_names"]
        self.assertEqual(names["subtask_1"], "Empty And Singleton")
        os.unlink(path)

    def test_exhaustive_space_stamps_suite_complete(self):
        path = write_suite([case("a", 1), case("b", 2)], space_mode="exhaustive")
        tm.derive_and_normalize(path, DESCRIPTION)
        self.assertTrue(load(path)["suite_complete"])
        os.unlink(path)

    def test_sampled_space_does_not_stamp_suite_complete(self):
        path = write_suite([case("a", 1)], space_mode="sampled")
        tm.derive_and_normalize(path, DESCRIPTION)
        self.assertFalse(load(path).get("suite_complete", False))
        os.unlink(path)

    def test_drops_cases_with_no_input(self):
        path = write_suite([case("a", 5), {"input": "  ", "output": "1", "subtask": "b"}])
        report = tm.derive_and_normalize(path, DESCRIPTION)
        self.assertEqual(report["kept"], 1)
        os.unlink(path)

    def test_synced_example_is_bucketed_from_its_new_input(self):
        """Example sync REWRITES the input of cases 1-2, so bucketing must run after it.

        Bucketing first left a synced n=3 example wearing the `size_edge` tag of the n=1
        case it replaced — a label describing an input that no longer existed.
        """
        described = (
            "Sum an array.\n\nConstraints\n1 <= n <= 100000\n\n"
            "### Example 1\n\n**Input:**\n```\n3\n1 2 3\n```\n\n"
            "**Output:**\n```\n6\n```\n"
        )
        # Case 1 starts as a degenerate n=1; the description's Example 1 is n=3.
        path = write_suite([case("degenerate", 1), case("other", 50)])
        tm.derive_and_normalize(path, described)
        first = load(path)["test_cases"][0]

        self.assertEqual(first["input"], "3\n1 2 3\n", "example sync should have replaced it")
        self.assertIn("size_small", first["tags"],
                      "n=3 is small; a stale size_edge means bucketing ran before the sync")
        self.assertNotIn("size_edge", first["tags"])
        self.assertEqual(first["size_metric"], 3,
                         "size_metric must describe the input the case actually ships with")
        os.unlink(path)


if __name__ == "__main__":
    unittest.main()
