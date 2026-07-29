"""Size tags must be defined by the PROBLEM, never by hardcoded numbers.

The bug these guard: a binary-string problem ("Palindromic Logs", MAX_N = 2*10^5)
shipped with 140/150 wrong size_* tags. Two causes, both about hardcoding —
`parse_primary_n` read the input string `0100101` as the integer 100101 and
called it the size, and `parse_constraint_max_n` did not understand
"length of logData <= 2 x 10^5", so MAX_N came back None and the `large` bucket
became unreachable for every case.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import (  # noqa: E402
    audit_size_distribution,
    bucket_for_case,
    case_size_metric,
    measure_input_size,
    parse_constraint_max_n,
    resolve_size_context,
    sync_size_tags_json_root,
    tag_size_bucket,
)
from testcase_selection import bucket_case  # noqa: E402

MAX_N = 200_000
STRING_DESC = (
    "Compute the minimum number of swaps to make logData palindromic.\n"
    "**Constraints**\n"
    "- `1 <= length of logData <= 2 x 10^5`\n"
    "- `logData[i]` is `'0'` or `'1'`\n"
)


def _string_case(length, first="1", tags=None):
    """A binary-string case: the input IS the data, its length IS the size."""
    body = first + "0" * (length - 1) if length > 1 else first
    return {"input": body + "\n", "size_metric": length, "tags": list(tags or [])}


def _payload(cases, max_n=MAX_N, kind="count"):
    return [{"test_cases": cases, "size_model": {"kind": kind, "max_n": max_n}}]


class ConstraintParsingTest(unittest.TestCase):
    def test_length_of_variable_with_coefficient_power(self):
        # The exact phrasing that returned None and killed the large bucket.
        self.assertEqual(parse_constraint_max_n(STRING_DESC), MAX_N)

    def test_common_bound_spellings(self):
        for text, expected in [
            ("1 <= n <= 100000", 100_000),
            ("1 ≤ n ≤ 10^5", 100_000),
            ("size of grid <= 1000", 1_000),
            ("|s| <= 2 * 10^5", 200_000),
        ]:
            with self.subTest(text=text):
                self.assertEqual(parse_constraint_max_n(text), expected)

    def test_no_size_bound_returns_none_rather_than_a_default(self):
        self.assertIsNone(parse_constraint_max_n("Return the answer modulo 7."))


class SizeMeasurementTest(unittest.TestCase):
    def test_digit_string_is_measured_by_length_not_value(self):
        # int("0100101") == 100101 would land this 7-char case in `large`.
        self.assertEqual(measure_input_size("0100101\n", "count", MAX_N), 7)

    def test_leading_one_string_is_still_measured_by_length(self):
        self.assertEqual(measure_input_size("101000\n", "count", MAX_N), 6)

    def test_count_style_first_token_is_used_when_it_can_be_a_count(self):
        self.assertEqual(measure_input_size("5\n1 2 3 4 5\n", "count", MAX_N), 5)

    def test_value_kind_uses_the_number_itself(self):
        self.assertEqual(measure_input_size("1000000\n", "value", 10**9), 1_000_000)

    def test_declared_size_metric_wins_over_measurement(self):
        tc = {"input": "101000\n", "size_metric": 6}
        self.assertEqual(case_size_metric(tc, "count", MAX_N), 6)


class SizeContextTest(unittest.TestCase):
    def test_declared_size_model_wins(self):
        kind, max_n = resolve_size_context(
            {"size_model": {"kind": "grid", "max_n": 999}}, STRING_DESC, []
        )
        self.assertEqual((kind, max_n), ("grid", 999))

    def test_falls_back_to_description_then_to_suite(self):
        _, from_desc = resolve_size_context(None, STRING_DESC, [])
        self.assertEqual(from_desc, MAX_N)
        _, from_suite = resolve_size_context(None, "no bound here", [_string_case(4_000)])
        self.assertEqual(from_suite, 4_000)

    def test_no_bound_anywhere_is_none_not_a_default(self):
        self.assertEqual(resolve_size_context(None, "no bound", []), (None, None))


class BucketsScaleWithTheProblemTest(unittest.TestCase):
    def test_same_size_buckets_differently_per_problem(self):
        # n = 500 is tiny against MAX_N = 2*10^5 and huge against MAX_N = 600.
        case = _string_case(500)
        self.assertEqual(bucket_for_case(case, MAX_N, "count"), "small")
        self.assertEqual(bucket_for_case(case, 600, "count"), "large")

    def test_no_size_dimension_leaves_tags_alone(self):
        self.assertIsNone(bucket_for_case(_string_case(500), MAX_N, "none"))


class EdgeBucketIsDegeneracyNotJustSizeTest(unittest.TestCase):
    """A binary-string problem has exactly two inputs of length 1, so an edge
    bucket defined as n <= 1 can never reach its 20% target. Degeneracy is
    declared by the generator's `is_edge` flag, whatever the case's length."""

    def test_flagged_small_case_is_edge(self):
        case = _string_case(8)
        case["is_edge"] = True
        self.assertEqual(bucket_for_case(case, MAX_N, "count"), "edge")

    def test_unflagged_small_case_stays_small(self):
        self.assertEqual(bucket_for_case(_string_case(8), MAX_N, "count"), "small")

    def test_minimum_size_is_edge_without_any_flag(self):
        self.assertEqual(bucket_for_case(_string_case(1), MAX_N, "count"), "edge")

    def test_stress_size_wins_over_the_edge_flag(self):
        # A max-size degenerate case (200k identical chars) is a STRESS case;
        # flagging cases as edge must never drain the large bucket.
        case = _string_case(199_270)
        case["is_edge"] = True
        self.assertEqual(bucket_for_case(case, MAX_N, "count"), "large")

    def test_edge_target_is_reachable_for_a_two_letter_alphabet(self):
        # 30 short degenerate cases + 120 ordinary ones -> 20% edge, on target.
        cases = []
        for i in range(30):
            c = _string_case(2 + i % 6)
            c["is_edge"] = True
            cases.append(c)
        cases += [_string_case(100 + i) for i in range(120)]
        data = _payload(cases)
        sync_size_tags_json_root(data, STRING_DESC)
        buckets = [tag_size_bucket(c["tags"]) for c in data[0]["test_cases"]]
        self.assertEqual(buckets.count("edge"), 30)
        audit = audit_size_distribution(data[0]["test_cases"], STRING_DESC)
        self.assertEqual(audit["realized"]["edge"], 20.0)
        self.assertNotIn("edge", {d["bucket"] for d in audit["deficient"]})

    def test_selector_and_tags_agree_on_the_bucket(self):
        case = {"size_metric": 8, "is_edge": True, "input": "10000000\n"}
        self.assertEqual(bucket_case(case, MAX_N), bucket_for_case(case, MAX_N, "count"))


class SyncSizeTagsTest(unittest.TestCase):
    def test_stress_string_case_is_large_not_small(self):
        # The shipped bug: 199,270 chars tagged size_small.
        data = _payload([_string_case(199_270, tags=["size_small"])])
        self.assertEqual(sync_size_tags_json_root(data, STRING_DESC), 1)
        self.assertEqual(tag_size_bucket(data[0]["test_cases"][0]["tags"]), "large")

    def test_mostly_zero_string_is_large_by_length(self):
        # "1000...0" parses to a huge int; only its length (111,613) is the size.
        data = _payload([_string_case(111_613, tags=["size_small"])])
        sync_size_tags_json_root(data, STRING_DESC)
        self.assertEqual(tag_size_bucket(data[0]["test_cases"][0]["tags"]), "large")

    def test_short_string_is_small_not_medium(self):
        data = _payload([_string_case(6, tags=["size_medium"])])
        sync_size_tags_json_root(data, STRING_DESC)
        self.assertEqual(tag_size_bucket(data[0]["test_cases"][0]["tags"]), "small")

    def test_singleton_is_edge(self):
        data = _payload([_string_case(1, tags=["size_small"])])
        sync_size_tags_json_root(data, STRING_DESC)
        self.assertEqual(tag_size_bucket(data[0]["test_cases"][0]["tags"]), "edge")

    def test_large_bucket_is_reachable_without_a_parsable_constraint(self):
        # No constraint text at all: the bound comes from the suite itself, so a
        # max-size case must still be tagged large.
        data = _payload([_string_case(10), _string_case(199_270, tags=["size_small"])])
        del data[0]["size_model"]["max_n"]
        sync_size_tags_json_root(data, "no constraints stated")
        tags = [tag_size_bucket(c["tags"]) for c in data[0]["test_cases"]]
        self.assertEqual(tags, ["small", "large"])

    def test_tags_track_the_declared_max_n_not_a_fixed_number(self):
        # Identical case, smaller problem: it must move buckets.
        case_len = 300
        big = _payload([_string_case(case_len)])
        small = _payload([_string_case(case_len)], max_n=400)
        sync_size_tags_json_root(big, "")
        sync_size_tags_json_root(small, "")
        self.assertEqual(tag_size_bucket(big[0]["test_cases"][0]["tags"]), "small")
        self.assertEqual(tag_size_bucket(small[0]["test_cases"][0]["tags"]), "large")


if __name__ == "__main__":
    unittest.main()
