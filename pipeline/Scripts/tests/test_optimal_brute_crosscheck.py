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


class CrosscheckTests(unittest.TestCase):
    def test_flags_buggy_optimal(self):
        ex = bs.extract_example_inputs(SUM_DESC)
        mm = bs.crosscheck_optimal_brute(SUM_BUGGY, SUM_BRUTE, ex, count=40)
        self.assertTrue(mm, "buggy optimal should disagree with the brute")

    def test_passes_correct_optimal(self):
        ex = bs.extract_example_inputs(SUM_DESC)
        mm = bs.crosscheck_optimal_brute(SUM_OPTIMAL, SUM_BRUTE, ex, count=40)
        self.assertEqual(mm, [], "correct optimal should agree with the brute")


# --------------------------------------------------------------------------- #
# Ground-truth example check (anchors the "buggy optimal" verdict to the
# description's own worked examples, so multiple-valid-answer problems no longer
# false-positive — the Two-Sum-by-index regression).
# --------------------------------------------------------------------------- #

# Two-Sum "print the indices of a pair summing to target, else -1". Multiple valid
# pairs may exist, so optimal (hash map, latest complement) and brute (nested loops,
# earliest pair) legitimately differ — but both reproduce the worked examples.
TWOSUM_DESC = """Locate two distinct elements whose combined value is exactly goal,
and identify their zero-based positions. If none, print -1.

**Example 1:**

**Input:**

```
6
7 14 -5 9 3 12
7
```

**Output:**

```
2 5
```

**Example 2:**

**Input:**

```
5
4 1 10 -6 13
20
```

**Output:**

```
-1
```
"""

TWOSUM_OPTIMAL = (
    "def main():\n"
    "    n=int(input()); nums=list(map(int,input().split())); target=int(input())\n"
    "    seen={}\n"
    "    for i,x in enumerate(nums):\n"
    "        if target-x in seen: print(seen[target-x], i); return\n"
    "        seen[x]=i\n"
    "    print(-1)\n"
    "main()\n"
)
TWOSUM_BRUTE = (
    "def main():\n"
    "    n=int(input()); nums=list(map(int,input().split())); target=int(input())\n"
    "    for i in range(len(nums)):\n"
    "        for j in range(i+1,len(nums)):\n"
    "            if nums[i]+nums[j]==target: print(i,j); return\n"
    "    print(-1)\n"
    "main()\n"
)


class ExtractExampleIOTests(unittest.TestCase):
    def test_pairs_input_with_following_output(self):
        io = bs.extract_example_io(DESC_WITH_EXAMPLES)
        self.assertEqual(len(io), 2)
        self.assertEqual(io[0], ("3 4\n6 5 4\n2 1 1\n", "8"))
        self.assertEqual(io[1], ("2 5\n4 3\n5 4\n", "7"))

    def test_no_examples_returns_empty(self):
        self.assertEqual(bs.extract_example_io("no blocks"), [])


class OptimalExampleFailuresTests(unittest.TestCase):
    def test_correct_optimal_has_no_failures(self):
        self.assertEqual(bs.optimal_example_failures(SUM_OPTIMAL, SUM_DESC), [])

    def test_buggy_optimal_fails_worked_example(self):
        fails = bs.optimal_example_failures(SUM_BUGGY, SUM_DESC)
        self.assertTrue(fails, "buggy optimal must fail the worked example")
        self.assertEqual(fails[0]["expected"], "6")

    def test_multiple_valid_answers_optimal_still_passes_examples(self):
        # The core regression: a correct optimal for a multi-answer problem must
        # reproduce the worked examples exactly (so it is NOT branded buggy),
        # even though it will differ from the brute on other inputs.
        self.assertEqual(bs.optimal_example_failures(TWOSUM_OPTIMAL, TWOSUM_DESC), [])


    def test_sys_exit_after_print_passes_examples(self):
        code = "import sys\nprint(6)\nsys.exit(0)\n"
        self.assertEqual(bs.optimal_example_failures(code, SUM_DESC), [])

    def test_batch_runner_sys_exit_does_not_fake_error(self):
        code = "import sys\nprint(6)\nsys.exit(0)\n"
        batch = bs.run_solutions_batch(code, ["1 2 3\n"])
        self.assertEqual(batch, [("6\n", "ok")])

    def test_stale_brute_only_marker_detected(self):
        payload = {
            "status": "mismatch",
            "reason": "reference solution disagrees with the brute-force oracle",
            "mismatches": [{"input": "1\n", "optimal": "0", "brute": "6"}],
        }
        self.assertTrue(bs.is_stale_brute_only_crosscheck_marker(payload))
        payload["mismatches"][0]["optimal"] = "<error>"
        self.assertFalse(bs.is_stale_brute_only_crosscheck_marker(payload))



if __name__ == "__main__":
    unittest.main()
