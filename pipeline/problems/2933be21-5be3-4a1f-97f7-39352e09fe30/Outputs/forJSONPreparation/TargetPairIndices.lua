----------QUESTION_DESCRIPTION_START----------
Deep beneath the Clockwork Citadel, archivist Mira must awaken an ancient gate guarded by a row of resonance stones, each etched with a hidden power value.

The gate opens only when exactly two different stones combine to the required ritual total.

Mira records the stones in order, and your role is to identify the zero-based positions of the matching pair within that sequence.

A single position cannot be chosen more than once.

If the corridor offers no valid duet, the expedition log must show `-1`.

Given the recorded sequence of values and the required `goal`, locate the pair of positions whose entries combine exactly to that value.

**Example 1:**

**Input:**

```
6
8 13 4 21 6 15
19
```

**Output:**

```
1 4
```

**Explanation:**

- The values at positions `1` and `4` are `13` and `6`, and together they match the required total `19`.

**Example 2:**

**Input:**

```
5
10 3 17 8 1
50
```

**Output:**

```
-1
```

**Explanation:**

- No two different positions in the sequence combine to produce the required total `50`, so the result is `-1`.

**Your Task**

- Complete the provided `identifyRitualPair(elements, goal)` function that takes the sequence of values and the required total, and returns the two zero-based positions as a list. If no valid pair exists, return an empty list.

**Constraints**

- `2 ≤ n ≤ 10^4`

- `elements` contains exactly `n` integers.

- `−10^9 ≤ each value in elements ≤ 10^9`

- `−10^9 ≤ goal ≤ 10^9`

- The two reported positions, if they exist, must be different and use zero-based indexing.

- The test data is designed so that there is at most one valid pair.

**Input Format**

- The first line contains an integer `n`, representing how many values are in the sequence.

- The second line contains `n` space-separated integers, representing `elements`.

- The third line contains an integer `goal`, representing the required total.

**Output Format**

The output is a single line written to standard output:

- The output contains two space-separated integers representing the zero-based positions of the matching values when a valid pair is found.

- The output contains `-1` when no valid pair exists.
----------QUESTION_DESCRIPTION_END----------

----------SHORT_TEXT_START----------
Target Pair Indices
----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------
MEDIUM
----------QUESTION_LEVEL_END----------

----------COMPANIES_START----------

----------COMPANIES_END----------

----------DEFAULT_TAGS_START----------

----------DEFAULT_TAGS_END----------

----------BEGINNER_TOPICS_START----------
Array
----------BEGINNER_TOPICS_END----------

----------INTERMEDIATE_TOPICS_START----------
Hash Table
----------INTERMEDIATE_TOPICS_END----------

----------ADVANCED_TOPICS_START----------

----------ADVANCED_TOPICS_END----------

----------REAL_LIFE_EXAMPLES_START----------
1. This same pair-finding idea is used in online shopping and banking systems to quickly detect two transactions whose amounts add up to a suspicious target without checking every possible pair.

2. Using a hash map here matters in real systems like large log analysis or sensor streams, because it finds the needed pair in one pass and stays fast even when thousands of values arrive.
----------REAL_LIFE_EXAMPLES_END----------

----------FOLLOW_UP_QUESTIONS_START----------
----------FOLLOW_UP_QUESTION_START_1----------
----------QUESTION_START----------
Your approach uses an `unordered_map` for `O(n)` average time and `O(n)` space. Can you solve this with less extra space, and what trade-off would that introduce?
----------QUESTION_END----------

----------ANSWER_START----------
Yes — we can sort value-index pairs and then use a two-pointer scan to find the target sum in `O(n log n)` time with `O(n)` if we store pairs, or potentially `O(1)` extra beyond the array if in-place modification is allowed. The trade-off is losing the original order unless indices are stored, and time increases from average `O(n)` to `O(n log n)`.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_1----------

----------FOLLOW_UP_QUESTION_START_2----------
----------QUESTION_START----------
Since `elements[i]` and `goal` can be as low as `-10^9` and as high as `10^9`, is using `int` always safe here for `complement = goal - num`? What would you change for more robust code?
----------QUESTION_END----------

----------ANSWER_START----------
For the given bounds, `int` is still safe because `goal - num` stays within roughly `[-2*10^9, 2*10^9]`, which fits in `32-bit` signed range. For safer, interview-quality code under changing constraints, I would use `long long` for `goal`, `num`, and `complement`.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_2----------

----------FOLLOW_UP_QUESTION_START_3----------
----------QUESTION_START----------
Your hash-map solution is `O(n)` on average, but what happens in the worst case for `unordered_map`, and how could you make the performance more predictable?
----------QUESTION_END----------

----------ANSWER_START----------
In the worst case, heavy hash collisions can degrade operations to `O(n)`, making the whole solution `O(n^2)`. To make it more predictable, we could use `map` for guaranteed `O(log n)` operations or sort and apply two pointers for deterministic `O(n log n)` time.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_3----------
----------FOLLOW_UP_QUESTIONS_END----------

----------HINTS_START----------
----------HINTS_START_1----------
Try the most direct idea first: check every pair of different positions `i` and `j`, and see whether `elements[i] + elements[j] == goal`. If yes, return those indices; otherwise after all checks, return empty.
----------HINTS_END_1----------

----------HINTS_START_2----------
That pair-checking repeats a lot of work and can take about `O(n^2)`. While scanning left to right, think about what single value you would need to complete the current number to `goal`, and whether you can remember earlier values with their indices for quick lookup.
----------HINTS_END_2----------
----------HINTS_END----------

----------CODE_CONTENT_CPP_START----------

----------CODE_CONTENT_CPP_END----------

----------CODE_CONTENT_PYTHON_START----------

----------CODE_CONTENT_PYTHON_END----------

----------CODE_CONTENT_JAVA_START----------

----------CODE_CONTENT_JAVA_END----------

----------CODE_CONTENT_NODE_JS_START----------

----------CODE_CONTENT_NODE_JS_END----------

----------DEBUG_HELPER_CODE_CPP_START----------

----------PRE_USER_CODE_START----------

----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------

----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_CPP_END----------

----------DEBUG_HELPER_CODE_PYTHON_START----------

----------PRE_USER_CODE_START----------

----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------

----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_PYTHON_END----------

----------DEBUG_HELPER_CODE_JAVA_START----------

----------PRE_USER_CODE_START----------

----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------

----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_JAVA_END----------

----------CODE_BASE64_CPP_START----------

----------CODE_BASE64_CPP_END----------

----------CODE_BASE64_PYTHON_START----------

----------CODE_BASE64_PYTHON_END----------

----------CODE_BASE64_JAVA_START----------

----------CODE_BASE64_JAVA_END----------

----------CODE_BASE64_NODE_JS_START----------

----------CODE_BASE64_NODE_JS_END----------

----------SOLUTIONS_CPP_START----------

----------SOLUTIONS_CPP_END----------

----------SOLUTIONS_PYTHON_START----------

----------SOLUTIONS_PYTHON_END----------

----------SOLUTIONS_JAVA_START----------

----------SOLUTIONS_JAVA_END----------

----------SOLUTIONS_NODE_JS_START----------

----------SOLUTIONS_NODE_JS_END----------