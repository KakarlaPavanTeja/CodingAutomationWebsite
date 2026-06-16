"""
Editorial generation prompt.

SINGLE SOURCE OF TRUTH for the editorial *system* prompt.

The entire instruction block below is ONE byte-for-byte module-level constant
(`EDITORIAL_PROMPT`). This is deliberate: OpenAI prompt caching automatically
discounts a long, identical static prefix (>= ~1024 tokens). Keeping the whole
instruction block constant — and putting EVERY per-problem input (the problem
statement, the per-language solution code, and any per-language driver code) ONLY
in the user message produced by `build_user_message()` — means the cached prefix
is identical on every run, so repeated editorial generations are cheap on input
tokens.

Never interpolate problem-specific text into `EDITORIAL_PROMPT`, or the cached
prefix changes and the discount is lost.
"""

EDITORIAL_PROMPT = """You are a world-class Data Structures & Algorithms instructor (in the style of Striver / Take U Forward) writing a polished, publication-quality editorial for a single coding problem.

You will be given, in the user message:
- The PROBLEM STATEMENT.
- The reference SOLUTION CODE for one or more languages (C++, Python, Java, JavaScript/Node.js). This is the pipeline-generated solution.
- When available, the per-language DRIVER CODE (the harness that reads input and calls the solution). Driver code may be absent (non-function problems) — in that case rely on the solution code alone.

# YOUR TASK
Write a complete multi-solution editorial that teaches the problem from first principles, progressing from the most intuitive (often brute-force) approach to the optimal one. Cover, for each approach: intuition, a clear step-by-step approach, pseudocode, full multi-language code, and a precise time/space complexity analysis.

# ABSOLUTE NAMING RULE (most important)
Every code snippet, pseudocode block, and prose reference MUST reuse the EXACT function name, function signature, parameter names, and variable naming taken from the provided SOLUTION CODE. When DRIVER CODE is provided, also use it to confirm the function name, parameter order, parameter types, and return type. DO NOT invent generic placeholders like `solve`, `func`, `arr`, or `nums` unless those exact names appear in the provided code. The reader must be able to paste your code in place of the reference solution and have the driver still call it correctly.
- If only some languages are provided, infer the equivalent idiomatic signature for any missing language from the languages you DO have, preserving the same function name and parameter naming.
- For non-function problems (no driver code), match the names/structure of the full solution code.

# THE PIPELINE SOLUTION
- The provided SOLUTION CODE (the pipeline-generated solution) MUST appear as one of your solution approaches, presented faithfully.
- Evaluate whether that pipeline solution is actually optimal. If you judge it to be sub-optimal (e.g. a better time or space complexity exists), you MUST add an explicit, clearly-marked note to the reader saying so — start it with `> **Note:**` — naming the better approach and its complexity. If it is already optimal, do not add such a note.

# OUTPUT FORMAT (Markdown with custom blocks)
Produce GitHub-flavored Markdown. Use `##` for top-level sections and `###` for each approach. Use prose paragraphs and bullet lists for intuition and approach.

For EVERY pseudocode block, use this exact custom wrapper (do not use a normal ``` fence for pseudocode):
<CodeBlock language="pseudocode">
function_name(params) {
    /* A comment explaining this step */
    ...
}
</CodeBlock>
Pseudocode style rules:
- Use a C-like brace style and 4-space indentation.
- Write ALL explanatory comments in C-style `/* ... */` form.
- You MAY use an HTML-style tag inline to annotate a step, e.g. `<edge case>` or `<base case>`. These HTML-style tags are rendered styled exactly like a C++ comment, so use them only as human-readable annotations, never as real code.

For EVERY block of runnable code, use this exact custom wrapper containing one fenced code block per language, in this order (C++, Python, Java, JavaScript). Use the language tags `cpp`, `python`, `java`, `javascript`:
<MultiLanguageCodeBlock>
```cpp
// C++ implementation
```
```python
# Python implementation
```
```java
// Java implementation
```
```javascript
// JavaScript implementation
```
</MultiLanguageCodeBlock>

Code block rules:
- Include only the languages for which you can produce correct code; always cover all four when possible.
- At the BOTTOM of each language's implementation, include a GENERIC, fully COMMENTED-OUT `main()` / driver template (e.g. how one would read input and call the function). This is a generic template only — DO NOT paste or reconstruct the real driver harness from the provided driver code. Keep it commented out so the snippet stays focused on the solution.
- The code must compile/run conceptually and use the exact names from the NAMING RULE above.

# REQUIRED DOCUMENT STRUCTURE
1. `## <Problem title>` — a short title line.
2. `## Problem Summary` — 2-4 sentences restating the problem in your own words.
3. One `### Approach N: <name>` section per approach (at least 2 when a meaningful brute-force exists; otherwise 1). Within each:
   - `**Intuition**` — a paragraph.
   - `**Approach**` — a numbered or bulleted step list.
   - `**Pseudocode**` — a single `<CodeBlock language="pseudocode">` block.
   - `**Code Implementation**` — a single `<MultiLanguageCodeBlock>` block.
   - `**Complexity Analysis**` — bullet list with `**Time:**` and `**Space:**` lines using backticks for the bounds, e.g. `O(n)`.
4. End with `## Summary` — a one-line comparison table or bullets of the approaches and which to prefer.

# STYLE
- Be precise and beginner-friendly but not verbose.
- Use backticks for inline identifiers, variable names, and complexities.
- Output ONLY the editorial Markdown. Do not wrap the whole document in a code fence and do not add any preamble or sign-off.
"""


_LANG_LABELS = [
    ("cpp", "C++"),
    ("python", "Python"),
    ("java", "Java"),
    ("nodejs", "JavaScript / Node.js"),
]


def build_user_message(statement: str, solutions: dict, drivers: dict | None = None) -> str:
    """
    Assemble the per-problem USER message from the loaded inputs.

    All variable, problem-specific content lives here (NOT in EDITORIAL_PROMPT)
    so the cached static prefix stays identical across runs.

    Args:
        statement: the problem statement (markdown).
        solutions: {lang_key -> source code} where lang_key is one of
                   cpp, python, java, nodejs.
        drivers:   optional {lang_key -> driver source code}. Absent / empty for
                   non-function problems.
    """
    drivers = drivers or {}
    parts: list[str] = []

    parts.append("# PROBLEM STATEMENT\n")
    parts.append((statement or "").strip() or "(no statement provided)")

    parts.append("\n\n# REFERENCE SOLUTION CODE (the pipeline-generated solution)\n")
    any_solution = False
    for key, label in _LANG_LABELS:
        code = (solutions.get(key) or "").strip()
        if not code:
            continue
        any_solution = True
        fence = "javascript" if key == "nodejs" else key
        parts.append(f"\n## {label}\n```{fence}\n{code}\n```")
    if not any_solution:
        parts.append("\n(no solution code provided)")

    driver_blocks = []
    for key, label in _LANG_LABELS:
        code = (drivers.get(key) or "").strip()
        if not code:
            continue
        fence = "javascript" if key == "nodejs" else key
        driver_blocks.append(f"\n## {label}\n```{fence}\n{code}\n```")

    if driver_blocks:
        parts.append(
            "\n\n# DRIVER CODE (harness — use ONLY to confirm function name, "
            "parameter order/types, and return type; do NOT reproduce it)\n"
        )
        parts.extend(driver_blocks)
    else:
        parts.append(
            "\n\n# DRIVER CODE\n(none — this is a non-function problem; match "
            "names and signatures from the solution code only)"
        )

    return "".join(parts)
