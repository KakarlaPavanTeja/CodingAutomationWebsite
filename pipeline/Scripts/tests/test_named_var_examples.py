"""Regression tests for the named-variable example bridge in benchmark_suite.

Function-based problems show human-readable named-variable examples in the description
(`n = 5` / `arr = [1, 2, 3]`), but grading runs the reference solution on RAW-TOKEN stdin.
So the description's example blocks must NOT be scraped and executed as stdin — doing so
crashed the solution and produced false "reference solution is buggy" verdicts. These tests
pin that named-var blocks are skipped while raw-stdin blocks (non-function problems) are not."""

import unittest

from benchmark_suite import (
    extract_example_inputs,
    extract_example_io,
    is_named_var_example_block,
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


if __name__ == "__main__":
    unittest.main()
