Inside the Ember Observatory, scribes catalog a wall of resonance tablets arranged as an `m x n` grid of energy marks.

To follow the vault ritual, even-indexed rows are read from left to right, while odd-indexed rows are read from right to left.

Each mark is then placed into a resonance band identified by `row + col`.

For every band, sort its collected values; if the band size is odd, record its median, otherwise record the average of all values in that band.

Produce the band records in increasing order of band id, with every value written to exactly `2` decimal places on a single line.

**Example 1:**

**Input:**

```
2 4
16 -20 17 21
25 23 -14 26
```

**Output:**

```
16.00 2.50 20.00 3.50 26.00
```

**Explanation:**

- Row `0` is read left to right, contributing `16`, `-20`, `17`, and `21`.

- Row `1` is read right to left, contributing `26`, `-14`, `23`, and `25`.

- The diagonal bands are `0 -> [16]`, `1 -> [-20, 25]`, `2 -> [17, 23]`, `3 -> [21, -14]`, and `4 -> [26]`, so the reported values are `16.00`, `2.50`, `20.00`, `3.50`, and `26.00`.

**Example 2:**

**Input:**

```
3 3
18 24 31
27 19 22
30 28 35
```

**Output:**

```
18.00 25.50 30.00 25.00 35.00
```

**Explanation:**

- The rows are collected in this order: `18 24 31`, then `22 19 27`, then `30 28 35`.

- The diagonal bands become `0 -> [18]`, `1 -> [24, 27]`, `2 -> [31, 19, 30]`, `3 -> [22, 28]`, and `4 -> [35]`.

- After sorting each band, the results are the median `18.00`, the average `25.50`, the median `30.00`, the average `25.00`, and the median `35.00`.

**Your Task**

- Complete the provided `compileDiagonalLedger` function that takes `m`, `n`, and `vaultGrid`, and returns the final space-separated summary string with every value formatted to exactly `2` decimal places`.

- The surrounding driver code will use that result to produce the required single-line output.

**Constraints**

- `1 ≤ m ≤ 100`

- `1 ≤ n ≤ 100`

- `−10^4 ≤ vaultGrid[i][j] ≤ 10^4`

- Each of the next `m` input lines contains exactly `n` space-separated integers.

**Input Format**

- The first line contains two space-separated integers `m` and `n`.

- The next `m` lines each contain `n` space-separated integers, representing the rows of the grid.

**Output Format**

The output is a single line:

- The output contains the diagonal summaries in increasing order of `row + col`, separated by single spaces.

- The final result is printed to standard output, and every value is shown with exactly `2` digits after the decimal point.

- If there is no diagonal summary, the produced line would be `""`, although valid inputs always generate at least one value.