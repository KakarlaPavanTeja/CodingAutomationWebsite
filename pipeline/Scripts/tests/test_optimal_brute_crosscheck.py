"""Regression tests for the optimal-vs-brute cross-check helpers in benchmark_suite.

These guard the early buggy-optimal detector wired into generate_brute_force.py:
- example extraction from the description's `**Input:** ``` ... ``` ` blocks,
- the structure-aware small-input generator (must stay in the problem's format),
- the open-ended-problem detector (must skip "return any ..." problems),
- the end-to-end comparator (flags a known-buggy optimal, passes a correct one).
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

import benchmark_suite as bs  # noqa: E402


DESC_WITH_EXAMPLES = """Some problem statement.

**Example 1:**

**Input:**

```
3 4
6 5 4
2 1 1
```

**Output:**

```
8
```

**Example 2:**

**Input:**

```
2 5
4 3
5 4
```

**Output:**

```
7
```
"""

# A correct "sum the array" pair and a deliberately broken optimal.
SUM_OPTIMAL = "import sys\nd=sys.stdin.read().split()\nn=int(d[0]); print(sum(int(x) for x in d[1:1+n]))\n"
SUM_BRUTE = "import sys\nd=sys.stdin.read().split()\nn=int(d[0])\nt=0\nfor x in d[1:1+n]: t+=int(x)\nprint(t)\n"
# Broken optimal: drops the last element.
SUM_BUGGY = "import sys\nd=sys.stdin.read().split()\nn=int(d[0]); print(sum(int(x) for x in d[1:n]))\n"

SUM_DESC = """Sum the array.

**Example 1:**

**Input:**

```
3
1 2 3
```

**Output:**

```
6
```
"""


class ExtractExampleInputsTests(unittest.TestCase):
    def test_extracts_each_input_block(self):
        ex = bs.extract_example_inputs(DESC_WITH_EXAMPLES)
        self.assertEqual(len(ex), 2)
        self.assertEqual(ex[0], "3 4\n6 5 4\n2 1 1\n")
        self.assertEqual(ex[1], "2 5\n4 3\n5 4\n")

    def test_no_examples_returns_empty(self):
        self.assertEqual(bs.extract_example_inputs("no code blocks here"), [])
        self.assertEqual(bs.extract_example_inputs(""), [])


class StructuredRandomInputsTests(unittest.TestCase):
    def test_deterministic_for_seed(self):
        ex = bs.extract_example_inputs(DESC_WITH_EXAMPLES)
        a = bs.structured_random_inputs(ex, count=20, seed=1)
        b = bs.structured_random_inputs(ex, count=20, seed=1)
        self.assertEqual(a, b)

    def test_preserves_line_structure(self):
        ex = bs.extract_example_inputs(DESC_WITH_EXAMPLES)
        gen = bs.structured_random_inputs(ex, count=30, seed=3)
        self.assertTrue(gen)
        for inp in gen:
            lines = [l for l in inp.split("\n") if l.strip()]
            # header + two array rows, same shape as the examples
            self.assertEqual(len(lines), 3)
            arr_lens = {len(lines[1].split()), len(lines[2].split())}
            self.assertEqual(len(arr_lens), 1)  # both arrays same length

    def test_empty_examples(self):
        self.assertEqual(bs.structured_random_inputs([], count=10), [])


class OpenEndedDetectorTests(unittest.TestCase):
    def test_flags_return_any(self):
        self.assertTrue(bs.is_open_ended_problem("Return any grid such that there is exactly one path."))
        self.assertTrue(bs.is_open_ended_problem("Print any valid arrangement."))
        self.assertTrue(bs.is_open_ended_problem("If there are multiple answers, output any of them."))
        self.assertTrue(bs.is_open_ended_problem("There may be multiple valid solutions."))

    def test_does_not_flag_deterministic(self):
        self.assertFalse(bs.is_open_ended_problem("Return the sum of all elements."))
        self.assertFalse(bs.is_open_ended_problem("Find the maximum total value."))
        self.assertFalse(bs.is_open_ended_problem(""))


class CrosscheckTests(unittest.TestCase):
    def test_flags_buggy_optimal(self):
        ex = bs.extract_example_inputs(SUM_DESC)
        mm = bs.crosscheck_optimal_brute(SUM_BUGGY, SUM_BRUTE, ex, count=40)
        self.assertTrue(mm, "buggy optimal should disagree with the brute")

    def test_passes_correct_optimal(self):
        ex = bs.extract_example_inputs(SUM_DESC)
        mm = bs.crosscheck_optimal_brute(SUM_OPTIMAL, SUM_BRUTE, ex, count=40)
        self.assertEqual(mm, [], "correct optimal should agree with the brute")


if __name__ == "__main__":
    unittest.main()
