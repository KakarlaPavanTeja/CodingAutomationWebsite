"""`open_ended` is decided once, at authoring time, and written down.

The regex it replaces (`is_open_ended_problem`) matched the wording a description MUST use
when it spells out a tie-break, so the better a description followed the rule the more
likely its checks were switched off. A flag written by the step that made the decision is
the only reliable signal.
"""

import json
import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from problem_flags import (  # noqa: E402
    load_open_ended,
    save_problem_flags,
    split_open_ended_marker,
)


class TestSplitOpenEndedMarker(unittest.TestCase):
    def test_reads_the_flag_and_strips_the_trailer(self):
        text = (
            "**Output Format**\n\nPrint any valid ordering.\n\n"
            "<!-- OPEN_ENDED: true reason=any topological order is acceptable -->\n"
        )
        clean, open_ended, reason = split_open_ended_marker(text)
        self.assertTrue(open_ended)
        self.assertEqual(reason, "any topological order is acceptable")
        self.assertNotIn("OPEN_ENDED", clean, "the marker must never reach the platform")
        self.assertTrue(clean.endswith("Print any valid ordering."))

    def test_false_marker_is_read_as_false(self):
        clean, open_ended, reason = split_open_ended_marker(
            "Print the sum.\n\n<!-- OPEN_ENDED: false reason=one answer -->\n")
        self.assertFalse(open_ended)
        self.assertEqual(clean, "Print the sum.")

    def test_a_missing_marker_defaults_to_false(self):
        clean, open_ended, reason = split_open_ended_marker("Print the sum.\n")
        self.assertFalse(open_ended, "absent marker must never be read as open-ended")
        self.assertEqual(clean, "Print the sum.")
        self.assertEqual(reason, "")

    def test_the_marker_is_matched_case_insensitively_and_with_loose_spacing(self):
        _, open_ended, _ = split_open_ended_marker("x\n<!--open_ended:TRUE reason=y-->")
        self.assertTrue(open_ended)

    def test_only_the_last_marker_wins_and_all_are_stripped(self):
        """The model sometimes echoes an example marker mid-answer. The decision is the
        one it ends on, and no copy may survive into the shipped description."""
        clean, open_ended, _ = split_open_ended_marker(
            "a\n<!-- OPEN_ENDED: false reason=x -->\nb\n<!-- OPEN_ENDED: true reason=y -->")
        self.assertTrue(open_ended)
        self.assertNotIn("OPEN_ENDED", clean)


class TestProblemFlagsRoundTrip(unittest.TestCase):
    def test_save_then_load(self):
        with tempfile.TemporaryDirectory() as d:
            save_problem_flags(True, "any valid arrangement", d)
            self.assertTrue(load_open_ended(d))
            with open(os.path.join(d, "problem_flags.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["reason"], "any valid arrangement")

    def test_a_missing_file_is_not_open_ended(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(load_open_ended(d))

    def test_a_corrupt_file_is_not_open_ended(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "problem_flags.json"), "w", encoding="utf-8") as f:
                f.write("{not json")
            self.assertFalse(load_open_ended(d))


if __name__ == "__main__":
    unittest.main()
