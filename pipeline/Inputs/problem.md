# Problem: Zigzag Diagonal Sum Analyzer
# Type: standard
# Scenario Level: moderate
You are given an `m x n` matrix of integers. Traverse the matrix in **zigzag row order**:
- Even-indexed rows (0, 2, 4, ...) are read **left to right**
- Odd-indexed rows (1, 3, 5, ...) are read **right to left**

After traversal, group all elements by their **diagonal index** defined as `row + col`. For each diagonal group (in ascending order of diagonal index):
- If the group has an **odd** number of elements → print the **median** rounded to **2 decimal places**
- If the group has an **even** number of elements → print the **average** rounded to **2 decimal places**

Print all results space-separated on a single line.

---

#### Input Format
- The first line contains two space-separated integers `m` and `n`.
- The next `m` lines each contain `n` space-separated integers representing the matrix.

#### Output Format
- A single line of space-separated values, one per diagonal group in ascending order of diagonal index.
- **All values printed to exactly 2 decimal places.**

#### Constraints
- 1 <= `m`, `n` <= 100
- -10^4 <= `matrix[i][j]` <= 10^4

---

#### Example 1
**Input:**
```
3 3
3 1 4
1 5 9
2 6 5
```
**Output:**
```
3.00 1.00 4.00 7.50 5.00
```
**Explanation:**

Zigzag traversal:
- Row 0 (even, L→R): (0,0)=3, (0,1)=1, (0,2)=4
- Row 1 (odd, R→L): (1,2)=9, (1,1)=5, (1,0)=1
- Row 2 (even, L→R): (2,0)=2, (2,1)=6, (2,2)=5

Diagonal groups by `row+col`:

| Diagonal | Elements | Sorted | Count | Result |
|----------|----------|--------|-------|--------|
| 0 | [3] | [3] | 1 (odd) | median = 3.00 |
| 1 | [1,1] | [1,1] | 2 (even) | avg = 1.00 |
| 2 | [4,5,2] | [2,4,5] | 3 (odd) | median = 4.00 |
| 3 | [9,6] | [6,9] | 2 (even) | avg = 7.50 |
| 4 | [5] | [5] | 1 (odd) | median = 5.00 |

#### Example 2
**Input:**
```
2 3
1 2 3
6 5 4
```
**Output:**
```
1.00 4.00 4.00 4.00
```
**Explanation:**

Zigzag traversal:
- Row 0 (even, L→R): (0,0)=1, (0,1)=2, (0,2)=3
- Row 1 (odd, R→L): (1,2)=4, (1,1)=5, (1,0)=6

Diagonal groups:

| Diagonal | Elements | Sorted | Count | Result |
|----------|----------|--------|-------|--------|
| 0 | [1] | [1] | 1 (odd) | median = 1.00 |
| 1 | [2,6] | [2,6] | 2 (even) | avg = 4.00 |
| 2 | [3,5] | [3,5] | 2 (even) | avg = 4.00 |
| 3 | [4] | [4] | 1 (odd) | median = 4.00 |

#### Example 3
**Input:**
```
1 1
7
```
**Output:**
```
7.00
```
**Explanation:**
Single element. Diagonal 0 = [7]. Odd count → median = 7.00.

#### Example 2
**Input:**
```
3 4
1 3 5 7
8 6 4 2
9 11 13 15
```
**Output:**
```
1.00 5.50 6.00 7.00 7.50 15.00
```
**Explanation:**

Zigzag traversal:
- Row 0 (even, L→R): (0,0)=1, (0,1)=3, (0,2)=5, (0,3)=7
- Row 1 (odd, R→L): (1,3)=2, (1,2)=4, (1,1)=6, (1,0)=8
- Row 2 (even, L→R): (2,0)=9, (2,1)=11, (2,2)=13, (2,3)=15

Diagonal groups:

| Diagonal | Elements | Sorted | Count | Result |
|----------|----------|--------|-------|--------|
| 0 | [1] | [1] | 1 (odd) | median = 1.00 |
| 1 | [3,8] | [3,8] | 2 (even) | avg = 5.50 |
| 2 | [5,6,9] | [5,6,9] | 3 (odd) | median = 6.00 |
| 3 | [7,4,11] | [4,7,11] | 3 (odd) | median = 7.00 |
| 4 | [2,13] | [2,13] | 2 (even) | avg = 7.50 |
| 5 | [15] | [15] | 1 (odd) | median = 15.00 |
