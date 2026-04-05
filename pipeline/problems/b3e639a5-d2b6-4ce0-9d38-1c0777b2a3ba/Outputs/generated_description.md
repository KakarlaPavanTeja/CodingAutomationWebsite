In the desert observatory of Saruun, a wall of numbered bronze plates preserves the last measured pulse of an ancient sky engine.

To copy the pattern correctly, the royal archivist reads the plates in a serpentine sweep: row `0`, row `2`, row `4`, and so on from left to right, while row `1`, row `3`, row `5`, and so on from right to left.

Each plate is then filed into a resonance chamber identified by `row + column`.

Your duty is to prepare the chamber report that the observatory seals at dawn.

Rows are treated as `0`-indexed.

Traverse the table in that zigzag row order and collect values by their chamber label.

Process the chamber labels in increasing order.

If a chamber contains an odd count of values, sort those values and use the middle one.

If a chamber contains an even count of values, use the arithmetic mean of all values in that chamber.

Write the final chamber results on one line, separated by single spaces, with every value shown to exactly `2` digits after the decimal point.

**Example 1:**

**Input:**

```
2 4
12 18 20 24
31 29 27 25
```

**Output:**

```
12.00 24.50 24.50 25.50 25.00
```

**Explanation:**

- Diagonal labels from `0` to `4` gather the readings `12`; `18` and `31`; `20` and `29`; `24` and `27`; and `25`.

- Their final formatted chamber values become `12.00`, `24.50`, `24.50`, `25.50`, and `25.00`.

**Example 2:**

**Input:**

```
4 3
16 22 30
44 17 19
28 26 32
40 34 38
```

**Output:**

```
16.00 33.00 28.00 26.00 33.00 38.00
```

**Explanation:**

- Diagonal label `2` gathers `30`, `17`, and `28`; after ordering them, the middle reading is `28.00`.

- Diagonal label `3` gathers `19`, `26`, and `40`, so its middle reading is `26.00`, while diagonal label `4` uses the mean of `32` and `34` to produce `33.00`.

**Your Task**

- Complete the provided `summarizeDiagonalEchoes` function that takes `gridData` and returns the final space-separated report string.

**Constraints**

- `1 ≤ m ≤ 100`

- `1 ≤ n ≤ 100`

- `−10^4 ≤ each table value ≤ 10^4`

- The table contains exactly `m` rows, and each row contains exactly `n` space-separated integers.

**Input Format**

- The first line contains two space-separated integers `m` and `n`.

- Each of the next `m` lines contains `n` space-separated integers describing one row of the table.

**Output Format**

The output is a single line:

- The output contains one space-separated formatted value for every diagonal chamber, listed from the smallest `row + column` value to the largest one.

- Each formatted value contains exactly `2` digits after the decimal point.

- The final result is printed to standard output as a single joined line; if there are no diagonal chambers, the printed line would be `""`.