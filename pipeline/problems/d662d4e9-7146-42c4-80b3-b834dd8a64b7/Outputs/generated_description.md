Within the storm-battered observatory of Halcyon Ridge, engineer Mira is trying to restart an ancient weather engine before the ice winds swallow the valley.

A row of charge cells lies on the console, each marked with a numeric energy value, and the engine only responds when exactly two cells combine to the correct activation level.

The control system does not want the charge values themselves; it demands the positions of the chosen cells in the recorded sequence.

Selecting the same position twice is forbidden, and if no usable pairing exists, the failed activation must be reported clearly.

You are provided with a sequence of values and a required total.

Identify the `0`-based positions of the two elements whose combined value matches the required total.

If a valid pairing exists, it is unique.

**Example 1:**

**Input:**

```
5
14 2 9 5 12
7
```

**Output:**

```
1 3
```

**Explanation:**

- The elements at positions `1` and `3` contain `2` and `5`, and their combined value is the required total `7`.

**Example 2:**

**Input:**

```
4
10 4 -3 8
15
```

**Output:**

```
-1
```

**Explanation:**

- No two positions in the sequence combine to form `15`, so the final output is `-1`.

**Your Task**

- Complete the provided `locateResonancePair` function that takes `sequence` and `required` and returns the two matching positions as a list. If no valid pair exists, it returns an empty list `[]`.

**Constraints**

- `2 ≤ n ≤ 10^4`

- `−10^9 ≤ each value in the sequence ≤ 10^9`

- `−10^9 ≤ required ≤ 10^9`

- The second input line contains exactly `n` space-separated integers.

- If a valid pairing exists, it is unique.

**Input Format**

- The first line contains the integer `n`, representing how many values are in the sequence.

- The second line contains `n` space-separated integers representing the sequence values.

- The third line contains the integer `required`, representing the desired total.

**Output Format**

The output is a single line written to standard output:

- The output contains two space-separated integers representing the `0`-based positions of the two elements whose combined value equals `required`, if such a pair exists.

- The output contains `-1` if no valid pair exists.