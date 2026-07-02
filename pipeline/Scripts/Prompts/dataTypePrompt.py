"""Shared LLM instructions for cross-language numeric type selection."""

_INT32_MAX = 2_147_483_647
_INT32_MIN = -2_147_483_648


def get_data_type_selection_rules():
    """
    Language-neutral rules for choosing integer widths in generated C++/Java code.
    Injected into conversion, splitting, and normalization prompts.
    """
    return f"""
**CRITICAL - DATA TYPE SELECTION (constraint-driven, cross-language consistent):**

Choose integer types from the **Constraints** section of the problem description and from the **actual arithmetic** in the solution — NOT from language defaults or habit.

**Step 1 — Parse constraints**
- Read every bound on inputs, outputs, array sizes, and intermediate quantities.
- Treat `10^9`, `1e9`, and `1000000000` as the same value when comparing ranges.

**Step 2 — Check overflow risk (inputs AND intermediates)**
- A type is safe only if **every** value that can appear — parameters, return values, loop variables, array elements, AND every intermediate result of `+`, `-`, `*`, `/`, `%`, or accumulation — stays within 32-bit signed range [{_INT32_MIN:,}, {_INT32_MAX:,}] (~±2.1×10^9).
- Do NOT upgrade to 64-bit just because a bound is "large". Example: `10 ≤ n ≤ 10^9` with outputs `a, b, c` each ≤ `n` and `a + b + c = n` → **32-bit is sufficient**; no intermediate exceeds `n`.
- Upgrade to 64-bit when ANY of these can exceed {_INT32_MAX:,}:
  - a single input/output value,
  - a sum/product of multiple values (e.g. summing `n` elements each up to `10^9`),
  - a computed answer that grows beyond input magnitude (e.g. combinatorial counts, prefix sums over large arrays).

**Step 3 — Pick matching types per language (MUST be consistent across C++ and Java)**
| Width needed | C++ | Java |
|---|---|---|
| 32-bit | `int` | `int` |
| 64-bit | `long long` | `long` |

- **Collections / tuples**: element types follow the same width.
  - C++: `vector<int>`, `tuple<int,int,int>`, `pair<int,int>`
  - Java: `int[]`, `List<Integer>` (or `int[]` for fixed tuples)
- **Driver / I/O parsing** must use the same width as the solution function (`cin >> int` ↔ `nextInt()`, `cin >> long long` ↔ `nextLong()`).
- **Do NOT** use `long long` in C++ while using `int` in Java for the same logical values. Both languages must agree.

**Common patterns (use these unless the specific problem proves otherwise):**
- Single value or output bounded by `≤ 10^9` (or `≤ 2×10^9`), with no overflowing intermediate math → `int` / `int`.
- Any quantity bounded by `≤ 10^18`, or sums/products that can exceed `2×10^9` → `long long` / `long`.
- Array length `n ≤ 10^5` with elements `≤ 10^9` but **sum of all elements** is used → `long long` / `long` for the sum (elements may stay `int` if each fits).

**Anti-patterns (do NOT do these):**
- Defaulting C++ to `long long` whenever a constraint mentions `10^9`.
- Using wider types in C++ than in Java (or vice versa) for the same parameter/return.
- Picking types from the source language (Python has unbounded ints) without re-deriving from constraints.

**Before finalizing signatures**, mentally verify: "What is the largest value any variable or expression can reach?" Pick the narrowest type that safely holds it.
"""
