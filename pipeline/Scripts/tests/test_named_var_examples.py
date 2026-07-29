"""Regression tests for the named-variable example bridge in benchmark_suite.

Function-based problems show human-readable named-variable examples in the description
(`n = 5` / `arr = [1, 2, 3]`), but grading runs the reference solution on RAW-TOKEN stdin.
So the description's example blocks must NOT be scraped and executed as stdin — doing so
crashed the solution and produced false "reference solution is buggy" verdicts. These tests
pin that named-var blocks are skipped while raw-stdin blocks (non-function problems) are not.

Skipping them is only half the answer: nothing then owned the display -> stdin conversion,
so the testcase model guessed one layout and the driver another (`N = 2763` shipped as a
graded input, 0/150). `named_var_stdin_candidates` supplies the plausible layouts; the
caller picks by running the reference, since only its parser is authoritative."""

import unittest

from benchmark_suite import (
    display_value_tokens,
    extract_example_inputs,
    extract_example_io,
    extract_named_var_example_io,
    is_named_var_example_block,
    named_var_stdin_candidates,
    parse_named_var_block,
)

_NAMED_VAR_DESC = """**Input:**
```
n = 5
arr = [1, 2, 3, 4, 5]
```
**Output:**
```
3
```"""

_RAW_STDIN_DESC = """**Input:**
```
5
1 2 3 4 5
```
**Output:**
```
3
```"""


class NamedVarExampleTest(unittest.TestCase):
    def test_detects_named_var_block(self):
        self.assertTrue(is_named_var_example_block("n = 5\narr = [1, 2, 3]"))
        self.assertTrue(is_named_var_example_block("  matrix = [[1,2],[3,4]]  "))

    def test_raw_stdin_is_not_named_var(self):
        self.assertFalse(is_named_var_example_block("5\n1 2 3 4 5"))
        self.assertFalse(is_named_var_example_block("3"))
        self.assertFalse(is_named_var_example_block(""))

    def test_named_var_examples_are_not_executed(self):
        # No executable pairs -> optimal_example_failures returns [] -> no false buggy verdict.
        self.assertEqual(extract_example_io(_NAMED_VAR_DESC), [])
        self.assertEqual(extract_example_inputs(_NAMED_VAR_DESC), [])

    def test_raw_stdin_examples_still_extracted(self):
        # Non-function problems keep working: their examples ARE stdin.
        self.assertEqual(len(extract_example_io(_RAW_STDIN_DESC)), 1)
        self.assertEqual(len(extract_example_inputs(_RAW_STDIN_DESC)), 1)


class NamedVarConversionTest(unittest.TestCase):
    """The converter itself: display form in, candidate raw stdin out."""

    def test_named_var_pairs_are_available_for_conversion(self):
        pairs = extract_named_var_example_io(_NAMED_VAR_DESC)
        self.assertEqual(pairs, [("n = 5\narr = [1, 2, 3, 4, 5]", "3")])
        # And the two extractors partition the blocks — no block is in both.
        self.assertEqual(extract_named_var_example_io(_RAW_STDIN_DESC), [])

    def test_values_render_as_raw_tokens(self):
        self.assertEqual(
            parse_named_var_block("n = 5\narr = [1, 2, 3]\nname = \"bob\""),
            [("n", ["5"]), ("arr", ["1 2 3"]), ("name", ["bob"])],
        )

    def test_matrix_renders_one_line_per_row(self):
        self.assertEqual(parse_named_var_block("m = [[1, 2], [3, 4]]"),
                         [("m", ["1 2", "3 4"])])

    def test_unparseable_value_falls_back_to_the_literal_text(self):
        # A description may write `s = abc` unquoted; keep the text rather than dropping it.
        self.assertEqual(parse_named_var_block("s = abc"), [("s", ["abc"])])

    def test_declared_layout_is_the_first_candidate(self):
        cands = named_var_stdin_candidates("n = 5\narr = [1, 2, 3, 4, 5]")
        self.assertEqual(cands[0], "5\n1 2 3 4 5\n")

    def test_missing_size_line_is_offered_as_a_candidate(self):
        # The block declared no length, but plenty of solutions read one first.
        cands = named_var_stdin_candidates("arr = [4, 1, 7]")
        self.assertIn("4 1 7\n", cands)
        self.assertIn("3\n4 1 7\n", cands)

    def test_redundant_size_line_is_offered_dropped(self):
        # And plenty of others do NOT read it, so offer the block without it too.
        cands = named_var_stdin_candidates("n = 3\narr = [4, 1, 7]")
        self.assertEqual(cands[0], "3\n4 1 7\n")
        self.assertIn("4 1 7\n", cands)

    def test_candidates_are_deduped_and_never_empty_strings(self):
        cands = named_var_stdin_candidates("target = 9")
        self.assertEqual(cands, ["9\n"])
        self.assertEqual(named_var_stdin_candidates(""), [])
        self.assertEqual(named_var_stdin_candidates("5\n1 2 3"), [])

    def test_display_tokens_match_printed_stdout(self):
        # The description states the RETURN value; the solution PRINTS it.
        self.assertEqual(display_value_tokens("[1, 2]"), display_value_tokens("1 2"))
        self.assertEqual(display_value_tokens('["NO"]'), display_value_tokens("NO"))
        self.assertEqual(display_value_tokens("False"), display_value_tokens("false"))
        self.assertNotEqual(display_value_tokens("[1, 2]"), display_value_tokens("2 1"))


if __name__ == "__main__":
    unittest.main()
