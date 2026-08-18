_CONSTRAINTS_NO_META = """
- **NO preparer meta-notes in Constraints.** List only the bounds/invariants themselves — e.g. `1 ≤ N ≤ 10^5`. NEVER append editorial asides such as `(inferred; ...)`, `*(inferred; the source omitted explicit bounds — adjust to the actual judge limits)*`, or similar notes about how a bound was chosen. If the input statement contains such notes, drop them and keep only the numeric limits.
"""


# Applied to EVERY scenario-wrapped description (light/moderate/heavy). A themed
# story must never make the task harder to understand than the plain version —
# the failure mode is a riddle where the actual operation is buried in metaphor.
_SCENARIO_CLARITY_MANDATE = """
**CLARITY OVER DISGUISE (NON-NEGOTIABLE — HIGHEST PRIORITY, OVERRIDES THE IMMERSION GOAL):**
The scenario adds flavor; it must NEVER make the problem harder to understand than the plain, un-themed version. A solver who has never seen the original algorithm must be able to work out EXACTLY what to compute from your text alone — with no reverse-engineering of the story. Enforce ALL of the following:
- **Define every object concretely, in literal terms, the first time it appears.** Say what each story object actually IS, e.g. "a ribbon is a lowercase string; its even strand is the characters at indices `0, 2, 4, ...`". Do not leave the mapping to be guessed from the metaphor.
- **Define every operation mechanically and unambiguously.** Any transformation the solver must implement (rotation, reindexing, pairing, sorting, merging, …) must be spelled out precisely, including edge cases — e.g. what "rotate right by `k`" does, that it is cyclic, and that `k = 0` is allowed. Never rely on the reader to infer an operation from the narrative.
- **Illustrate any non-obvious operation inline with a tiny concrete instance**, right after you define it and separate from the Examples section, e.g. "rotating `ac` right by 1 gives `ca`".
- **State the exact question in one crisp, literal sentence** using the concrete terms — not only the poetic framing.
- **No riddles.** If a sentence must be decoded before it can be acted on, rewrite it literally. Flavor decorates the specification; it never encodes it.
"""


# Applied to the Input Format of EVERY builder (none → heavy). The failure mode
# is hedged layout prose like "may appear on separate lines or on the same line,
# because the input is read token by token" — which never tells the solver the
# actual layout.
_INPUT_LAYOUT_RULE = """
- **STATE ONE EXACT LAYOUT — NO HEDGING (APPLIES AT EVERY SCENARIO LEVEL).** Commit to a SINGLE concrete input layout and describe it precisely. NEVER write vague either-or phrasing such as "may appear on separate lines or on the same line", "in any whitespace-separated form", or "because the input is read token by token". Even when the `USER CODE` reads token-by-token (`cin >>`, `scanf`, `input().split()`) and would technically accept any whitespace, pick the ONE layout shown in your Examples and describe THAT. Be explicit about what sits on each line and the separator between items — e.g. "The first line contains the integer `n`." then "The second line contains the `n` strings separated by single spaces.", OR "Each of the next `n` lines contains one string." when that is what the Examples show. The layout you describe MUST match the Input blocks of your Examples exactly (same lines, same separators)."""


def get_structure_only_prompt(problem_name, question_type, user_code):
    """
    Prompt for scenario_level == "none".

    Unlike the other scenario levels (which invent a NEW scenario and rename
    variables/functions), this REBUILDS the problem statement into a clean,
    well-structured, professional description while keeping FOUR things unchanged:
    the scenario/framing, the variable & function names, the examples, and the
    constraints. The descriptive prose is rewritten for clarity, and any LaTeX /
    math notation is normalized to clean plain text — but no semantics, values, or
    names are altered.
    """

    prompt = f"""You are an expert technical content writer for a coding interview platform.

**YOUR OBJECTIVE:**
REBUILD the given problem statement into a clean, clear, well-structured, professional description.
Rewrite the descriptive prose so it reads well and is easy to follow — but you must keep the problem's identity intact.

**WHAT YOU MUST NOT CHANGE (FOUR PILLARS — HIGHEST PRIORITY):**
1. **Scenario / framing** — Keep the SAME context. If the original is a direct, technical problem (no story), keep it technical — do NOT invent a story. If the original has a story/scenario, keep that same story — do NOT replace it with a different one.
2. **Variable & function names** — Keep the EXACT original variable/parameter names. Keep the original function's MEANING and signature, but write the function name in **camelCase** (this is a re-casing ONLY — do NOT rename it to a different word or invent a new name). E.g. `find_matching_elements` or `FindMatchingElements` → `findMatchingElements`, `getpalindromescount` → `getPalindromesCount`. Do NOT re-case or rename the variable/parameter names.
3. **Examples** — Keep the SAME examples: identical input values, identical output values, identical indices/explanatory facts. Do NOT add, drop, reorder, or alter any example's values. You MAY clean up the wording/formatting of an explanation, but every number/string/index stays the same.
4. **Constraints** — Keep the SAME constraint bounds and values exactly. Do NOT tighten, loosen, add, or remove any limit. Preparer meta-notes (e.g. `(inferred; ...)`) are NOT part of the constraint — omit them even if present in the source.

**WHAT YOU SHOULD DO (THE REBUILD):**
- Rewrite the problem statement prose for clarity and flow (you are NOT limited to the original sentences), as long as the meaning, the four pillars above, and the I/O behavior stay identical.
- Organize the content into the clean section structure defined below.
- Fix awkward phrasing, run-on sentences, and large text blocks.

**CRITICAL — NOTATION NORMALIZATION (this is a common source of broken output):**
The rendered page does NOT support LaTeX/MathJax. You MUST convert all math notation to clean plain text. NEVER emit raw LaTeX.
- Remove all math delimiters: no `$ ... $`, no `$$ ... $$`, no `\\( ... \\)`, no `\\[ ... \\]`.
- Replace LaTeX commands with plain symbols:
  - `\\le` / `\\leq` → `≤`   ·   `\\ge` / `\\geq` → `≥`   ·   `\\lt` → `<`   ·   `\\gt` → `>`   ·   `\\neq` → `≠`
  - `\\lvert x \\rvert`, `\\vert x \\vert`, `\\|x\\|`, `|x|` → `|x|`
  - `\\bmod` / `\\mod` → `mod`   ·   `\\times` → `×`   ·   `\\cdot` → `·`   ·   `\\ldots` / `\\dots` → `...`
  - `\\%` → `%`   ·   `\\_` → `_`   ·   `\\{{` → `{{`   ·   `\\}}` → `}}`
- Keep exponents readable as plain text, e.g. write `10^9 + 7` (not `10^{{9}} + 7`).
- **FALLBACK:** For ANY other LaTeX macro not listed (e.g. `\\left`, `\\right`, `\\frac`, `\\text`, `\\mathrm`, `\\in`, `\\to`, `\\sum`), convert it to the nearest plain-text equivalent or strip the markup while preserving the meaning.
- After writing, scan your output: there must be ZERO backslash-LaTeX commands and ZERO stray `$` left anywhere.

**USER CODE (reference ONLY — to confirm whether the result is printed vs returned for the Output Format wording; DO NOT use it to change variables, examples, scenario, or wording):**
```cpp
{user_code}
```

**OUTPUT FORMAT RULES (THE RENDERER SUPPORTS NONE OF THE FORBIDDEN CONSTRUCTS BELOW):**
1. **NO ATX HEADINGS OF ANY LEVEL.** Do NOT start any line with `#`, `##`, `###`, `####`, `#####`, or `######`. Section titles use bold `**Title:**` form ONLY (see rule 4). The renderer cannot display `#`-style headings.
2. **NO HORIZONTAL DIVIDERS.** Do NOT emit `---`, `***`, or `___` on their own line. The renderer cannot display them.
3. **NO MARKDOWN TABLES — EVER.** Do NOT use the `| col | col |` / `|---|---|` pipe-table syntax anywhere, not even inside an explanation. The renderer cannot display tables. If the original explanation contains a table, REWRITE its contents as a bullet list (one bullet per row, sub-bullets for the columns) preserving EVERY value, label, and number exactly.
4. Do NOT use markdown code fences (```md) around the entire output.
5. Do NOT include a "Problem Statement" title. Start directly with the description text.
6. Use `**` for section titles: **Example 1:**, **Example 2:**, **Input:**, **Output:**, **Explanation:**, **Your Task**, **Constraints**, **Input Format**, **Output Format**.
7. **CRITICAL:** You must leave exactly ONE BLANK LINE after every section title.
8. **CRITICAL: Add a Blank Line BETWEEN every bullet point.**
9. **CONSISTENT EMPHASIS:** Any sub-heading the original had (e.g. "Notes", "Returns") must be bolded with `**` for consistency — NEVER as an ATX heading.
10. **CODE FENCES MUST BE BARE:** every opening code fence is exactly three backticks with NOTHING after them on the same line — no language identifier (no ` ```text`, ` ```plaintext`, ` ```cpp`, etc.).

**BACKTICKS FOR LITERALS (PROSE ONLY):**
- In the prose sections (Problem Statement, Explanation, Your Task), wrap literal values/characters/strings/booleans in backticks (`` ` ``) for readability.
- This is a layout aid ONLY and must NEVER change the actual value, spelling, or casing of anything.
- **NEVER alter the values inside the Examples' Input/Output code blocks** — the input and output values stay identical to the original.

**CRITICAL: DOCUMENT TERMINATION (DO NOT EXCEED):**
Your response MUST END immediately after the **Output Format** section.
- DO NOT include any additional "Example" sections or text after the Output Format.
- The Output Format section MUST be the FINAL section of your response.

**SECTION INSTRUCTIONS**

**Problem Statement**
- Start immediately with the rebuilt description text. Do not write "**Problem Statement**".
- Keep the same scenario/framing and the same meaning; rewrite only for clarity.
- **Line Structure / Readability:**
  - **CRITICAL: Do NOT write large blocks of text.**
  - Break the description into multiple lines based on meaning.
  - Start a new line (with a blank line in between) for each distinct rule, definition, or objective.

**Examples**
- **CRITICAL: Use the SAME examples as the original.** Do NOT invent new examples and do NOT change any input/output values or indices.
- Keep the same number of examples as the original (do not add or drop any).
- **CODE FENCES MUST BE BARE:** the opening fence is exactly three backticks with NOTHING after them — no language identifier (no ` ```text`, ` ```cpp`, ` ```plaintext`, etc.) and no other text on the same line.
- **NO TABLES:** if the original explanation uses a markdown table, do NOT reproduce it. Convert the table into a bullet list (one bullet per row, sub-bullets for each column value) that preserves every value, label, and number exactly.
- Re-format each example into this exact layout (Pay attention to blank lines):

    **Example 1:**

    **Input:**

    ```
    n = 12
    ```

    **Output:**

    ```
    32
    ```

    **Explanation:**

    - Explanation text here.

**Your Task**
- Restate the original task using the original function name written in **camelCase** (re-case only — same meaning, do NOT rename to a different word), plus the EXACT original parameter names and return type from the problem / `USER CODE`. Do NOT paraphrase the signature or emit angle-bracket placeholders — write the real names.
- Format (example shape — substitute the REAL names, never literal placeholders):
    **Your Task**

    - Complete the provided `getPalindromesCount` function that takes `s` and returns the required result.

**Constraints**
- Present the ORIGINAL constraints as bullet points with backticks and normalized notation (e.g. `5 ≤ |s| ≤ 10^5`). Do NOT change any values or bounds.
{_CONSTRAINTS_NO_META}

**Input Format**
- Title: **Input Format** followed by a blank line.
- Describe the input structure consistent with the ORIGINAL examples and the `USER CODE` logic.
- **BULLET POINTS**: Use bullet points to describe inputs line-by-line or item-by-item.
- Keep the original variable names.{_INPUT_LAYOUT_RULE}

**Output Format**
- Title: **Output Format** followed by a blank line.
- Describe the output structure consistent with the ORIGINAL examples and the `USER CODE` logic.
- **BULLET POINTS**: Use bullet points to list the expected outcomes.
- Start with a generic sentence like "The output is a single line:" followed by bullet points.
- **CRITICAL: DO NOT use the word "Print" at the start of bullets.**
- **PRINT VS RETURN**: You MUST explicitly state whether the final result is **printed** to standard output or **returned**, exactly as handled in the `USER CODE`.
- **CONSISTENCY**: The output representation MUST match exactly what the original examples show.

**FINAL CONFLICT-RESOLUTION RULE (READ LAST):**
If any instruction above ever conflicts with the FOUR PILLARS (scenario, variable names & function meaning, example values, constraint values), **THE FOUR PILLARS WIN** — never change them to satisfy a formatting or rewriting rule. (The function name is still written in camelCase per pillar 2 — that is a re-casing, not a rename, so it does not conflict with this rule.)
"""

    prompt += _function_example_format_addon(question_type)
    if question_type.lower() == 'node':
        prompt += """
    **For Node-Based Questions:**
    - The first line contains space-separated values representing the nodes.
    - `null` represents a null node.
"""
    return prompt


def _get_rephrasing_mode(scenario_level: str) -> str:
    """Scenario-level rephrasing instructions shared by split description prompts."""
    if scenario_level == "light":
        return """
**REPHRASING WITH LIGHT SCENARIO:**
- Add a subtle real-world context to frame the problem, but keep it minimal (1-2 sentences max).
- The core problem description should remain mostly technical and algorithmic.
- Use the context only to introduce the variables naturally, then shift to direct problem language.
- Example: Instead of "Given an array of integers", say "A sensor array records `n` readings. Given these readings as a sequence `values`..." then proceed technically.
- Do NOT build an elaborate story. The scenario is just a thin wrapper to make variables feel grounded.
- **Vary themes**: Use diverse contexts (sensors, logs, inventories, schedules, measurements — NOT always space themes).
- Example transformations:
  * "array of numbers" → "sequence of readings", "list of recorded values"
  * "find indices" → "locate the positions", "identify which entries"
  * "target sum" → "desired total", "target threshold"
"""
    if scenario_level == "moderate":
        return """
**REPHRASING WITH MODERATE SCENARIO:**
- Create a NEW scenario/story completely different from typical examples.
- **Vary themes**: Use diverse contexts (Banking, Nature/Science, Games, Technology, Social - NOT always space themes).
- The scenario should naturally lead to the same algorithmic problem.
- Keep it concise - don't over-elaborate.
- Example transformations:
  * "array of numbers" → "sequence of measurements", "list of scores", "collection of readings"
  * "find indices" → "locate positions", "identify locations", "determine placements"
  * "target sum" → "desired total", "goal value", "required amount"
"""
    if scenario_level == "heavy":
        return """
**REPHRASING WITH HEAVY/IMMERSIVE SCENARIO:**
- Create a rich, detailed narrative scenario that fully disguises the underlying algorithm.
- Build a vivid, engaging story world with specific characters, settings, or situations.
- The reader should feel immersed in the scenario before realizing it maps to an algorithmic challenge.
- **Vary themes**: Use creative, diverse contexts — fantasy worlds, detective investigations, cooking competitions, archaeological expeditions, space missions, wildlife research, city planning, etc.
- Every technical element should be naturally mapped to the story:
  * "array of numbers" → "the ancient scroll contains a sequence of rune power levels"
  * "find indices" → "identify which runes in the sequence"
  * "target sum" → "the ritual requires a combined power of exactly"
  * "return true/false" → "determine whether the expedition can succeed"
- The scenario should be 3-5 sentences of narrative context before the actual task description.
- Make the problem feel like a puzzle within the story, not a math problem with a coat of paint.
"""
    return ""


def _get_naming_requirements() -> str:
    return """
**NAMING REQUIREMENTS (ALWAYS APPLY):**

**CRITICAL - YOU MUST CHANGE THESE:**
- **Function Name**: Generate a NEW camelCase name different from these common ones:
  * FORBIDDEN: twoSum, findPair, searchPair, getPair, findIndices, getIndices
  * GOOD: locatePairPositions, findMatchingElements, identifyTargetPair, seekElementPair

- **Variable Names in Description**: You MUST use DIFFERENT names from standard examples:
  * FORBIDDEN: nums, arr, array, target, sum
  * For array/list: Use "elements", "values", "data", "sequence", "collection", "items"
  * For target/goal: Use "goal", "required", "desired", "expected", "threshold"
  * For size: Keep as single letter `n` or `m` (this is OK)

- **Consistency**: Use your NEW chosen names consistently in every section you write.
"""


def _get_io_truth_context(user_code: str) -> str:
    return f"""
**SOURCE OF TRUTH FOR I/O FORMAT:**
You MUST use the `USER CODE` provided below as the absolute SOURCE OF TRUTH for input/output behavior.

**USER CODE:**
```cpp
{user_code}
```

**INSTRUCTION UPDATE:**
1. Carefully analyze the ENTITY of the `USER CODE`, including any `main` function or top-level input reading logic (e.g., `cin`, `scanf`, `input()`, `fs.readFileSync`).
2. If the code explicitly reads a variable (like a length `n` or `m`) before reading a collection/array, you MUST include that variable in examples and formats.
3. If the code reads the collection/array directly (e.g., using `JSON.parse` or `getline` without an explicit size count), then you MUST NOT include a size variable.
4. Your output must reflect EXACTLY what the `USER CODE` prints or returns as the final result of execution.
5. Do NOT blindly copy the input/output format text from the original problem description text if it conflicts with how the `USER CODE` actually reads/writes data.
6. **STRICT COMPLEX TYPE FORMATTING**: Any arrays, strings, or matrices mentioned MUST follow the exact input representation expected by the `USER CODE`.

**CRITICAL: DO NOT mention time/space complexity constraints in the description.**
"""




def _function_example_format_addon(question_type: str) -> str:
    qt = (question_type or "").lower()
    if qt in ("node", "nonfunction"):
        return ""
    return """
**FUNCTION-BASED EXAMPLE INPUT/OUTPUT (MANDATORY)**:
- In each **Input:** block, write ONE NAMED VARIABLE ASSIGNMENT PER LINE for EVERY variable the **Input Format** lists, in the SAME ORDER as the Input Format (e.g. `n = 4`, `m = 10`, `a = [1, 5, 2, 1, 1, 1, 2, 5, 7, 2]`).
- Include size/count variables (such as `m`) even when they are NOT function parameters. The example must mirror the **Input Format** exactly, not just the function signature — never silently drop a variable the Input Format defines.
- Do NOT use raw stdin layout or anonymous lines without variable names.
- In each **Output:** block, write ONLY the function return value (scalar, array, or structured value) exactly as the reference code returns it — not full-program stdout unless the code prints as its final result.
- **Input Format** and **Output Format** must describe the same variable-based representation shown in the examples.
"""

def _node_type_addon(question_type: str) -> str:
    if question_type.lower() == "node":
        return """
**For Node-Based Questions:**
- The first line contains space-separated values representing the nodes.
- `null` represents a null node.
"""
    return ""


def get_description_prose_prompt(problem_name, question_type, user_code, scenario_level="moderate"):
    """Step 1a: problem statement / scenario only — establishes names for later steps."""
    rephrasing_mode = _get_rephrasing_mode(scenario_level)
    return f"""You are an expert technical content writer for a coding interview platform.
{_get_io_truth_context(user_code)}

**YOUR OBJECTIVE:**
Write ONLY the **problem statement prose** for a rephrased coding question. Use NEW variable and function names.

{rephrasing_mode}
{_get_naming_requirements()}

**FORBIDDEN PHRASES (DO NOT USE):**
- "Given an array of integers"
- "return indices of"
- "find two numbers"
- "add up to target"
- "You may assume"
- "return the answer in any order"

**OUTPUT RULES:**
1. Do NOT use `###`, `---`, or ATX headings.
2. Do NOT include a "Problem Statement" title — start directly with the description text.
3. Do NOT write Examples, Your Task, Constraints, Input Format, or Output Format.
4. Use backticks for literal values in prose.
5. Break text into short lines with blank lines between distinct rules or objectives.
6. End after the problem statement prose — nothing else.

**At the very end**, on its own lines, emit a machine-readable naming block so later steps stay consistent:

**Naming Block:**
- function: `yourChosenFunctionName`
- variables: `name1`, `name2`, ...
{_node_type_addon(question_type)}
{_function_example_format_addon(question_type)}
"""


def get_description_examples_prompt(problem_prose, question_type, user_code):
    """Step 1b: two fresh examples using names from the prose step."""
    return f"""You are an expert technical content writer for a coding interview platform.
{_get_io_truth_context(user_code)}

**PROBLEM STATEMENT (already written — use the SAME variable/function names):**
{problem_prose}

**YOUR OBJECTIVE:**
Write ONLY the **Examples** section (exactly 2 examples). Do NOT rewrite the problem statement.

**CRITICAL RULES:**
- **ABSOLUTELY NO COPYING** from the original input problem text.
- Invent completely new numbers, arrays, strings, and outputs.
- Provide exactly 2 examples — no more, no fewer.
- Use the SAME naming as the problem statement above.
- Format arrays with spaces after commas: `[1, 2, 3]` not `[1,2,3]`.
- Use backticks for literals in explanations.
- Do NOT use language tags after code fences — bare ``` only.

**OUTPUT FORMAT (follow exactly, including blank lines):**

    **Example 1:**

    **Input:**

    ```
    ...
    ```

    **Output:**

    ```
    ...
    ```

    **Explanation:**

    - ...

    **Example 2:**

    **Input:**

    ```
    ...
    ```

    **Output:**

    ```
    ...
    ```

    **Explanation:**

    - ...

Your response MUST contain ONLY the two examples — no other sections.
{_node_type_addon(question_type)}
"""


def get_description_spec_prompt(problem_prose, examples_text, question_type, user_code):
    """Step 1c: Your Task, Constraints, Input Format, Output Format."""
    return f"""You are an expert technical content writer for a coding interview platform.
{_get_io_truth_context(user_code)}

**PROBLEM STATEMENT:**
{problem_prose}

**EXAMPLES (already written — stay consistent):**
{examples_text}

**YOUR OBJECTIVE:**
Write ONLY these four sections, in order: **Your Task**, **Constraints**, **Input Format**, **Output Format**.

**Your Task**
- Use the function name from the problem statement.
- Format:
    **Your Task**

    - Complete the provided `functionName` function that takes `arg` and returns `result`.

**Constraints**
- Bullet points with backticks.
- Every numeric range MUST have explicit bounds (e.g. `0 ≤ n ≤ 10^5`).
- Infer reasonable bounds from the problem and examples if unspecified.
{_CONSTRAINTS_NO_META}

**Input Format**
- Title: **Input Format** followed by a blank line.
- Bullet points describing inputs line-by-line, matching `USER CODE` and the examples above.

**Output Format**
- Title: **Output Format** followed by a blank line.
- Bullet points describing outputs, matching `USER CODE` and the examples above.
- State whether the result is **printed** or **returned**, exactly as in `USER CODE`.
- Do NOT start bullets with the word "Print".
- **DETERMINISTIC ANSWER (CRITICAL):** if the task could admit MORE THAN ONE valid
  output (e.g. "return the indices of a pair summing to k" when several pairs qualify,
  "any valid arrangement", multiple shortest paths), the Output Format MUST pin down a
  SINGLE expected answer with an explicit tie-break rule — e.g. "return the pair with
  the smallest first index, breaking ties by the smallest second index" or "return the
  lexicographically smallest such sequence". The tie-break MUST be consistent with the
  worked examples and with what `USER CODE` actually produces. Never leave the expected
  output ambiguous; grading compares against one exact answer.

**OUTPUT RULES:**
1. Do NOT rewrite the problem statement or examples.
2. Use `**` for section titles with a blank line after each title.
3. Add a blank line between every bullet point.
4. Your response MUST END immediately after the **Output Format** section.
{_node_type_addon(question_type)}
"""


def assemble_description_parts(prose: str, examples: str, spec: str) -> str:
    """Join the three description LLM outputs into one markdown file."""
    parts = [p.strip() for p in (prose, examples, spec) if p and p.strip()]
    return "\n\n".join(parts) + "\n"


def get_description_prompt(problem_name, question_type, user_code, scenario_level="moderate"):
    """
    Constructs the system prompt for generating coding question descriptions
    based on strict user checklists and samples.

    Args:
        problem_name: The name/title of the problem
        question_type: Type of question (standard, node, etc.)
        user_code: The user's solution code
        scenario_level: Level of scenario wrapping - "none", "light", "moderate", or "heavy"
    """

    # scenario_level == "none" is a pure structure/formatting pass that preserves
    # the original statement, variables, examples, and scenario unchanged.
    if scenario_level == "none":
        return get_structure_only_prompt(problem_name, question_type, user_code)

    # Rephrasing instructions based on scenario level
    rephrasing_mode = ""
    if scenario_level == "light":
        rephrasing_mode = """
**REPHRASING WITH LIGHT SCENARIO:**
- Add a subtle real-world context to frame the problem, but keep it minimal (1-2 sentences max).
- The core problem description should remain mostly technical and algorithmic.
- Use the context only to introduce the variables naturally, then shift to direct problem language.
- Example: Instead of "Given an array of integers", say "A sensor array records `n` readings. Given these readings as a sequence `values`..." then proceed technically.
- Do NOT build an elaborate story. The scenario is just a thin wrapper to make variables feel grounded.
- **Vary themes**: Use diverse contexts (sensors, logs, inventories, schedules, measurements — NOT always space themes).
- Example transformations:
  * "array of numbers" → "sequence of readings", "list of recorded values"
  * "find indices" → "locate the positions", "identify which entries"
  * "target sum" → "desired total", "target threshold"
"""
    elif scenario_level == "moderate":
        rephrasing_mode = """
**REPHRASING WITH MODERATE SCENARIO:**
- Create a NEW scenario/story completely different from typical examples.
- **Vary themes**: Use diverse contexts (Banking, Nature/Science, Games, Technology, Social - NOT always space themes).
- The scenario should naturally lead to the same algorithmic problem.
- Keep it concise - don't over-elaborate.
- Example transformations:
  * "array of numbers" → "sequence of measurements", "list of scores", "collection of readings"
  * "find indices" → "locate positions", "identify locations", "determine placements"
  * "target sum" → "desired total", "goal value", "required amount"
"""
    elif scenario_level == "heavy":
        rephrasing_mode = """
**REPHRASING WITH HEAVY/IMMERSIVE SCENARIO:**
- Create a rich, detailed narrative scenario that fully disguises the underlying algorithm.
- Build a vivid, engaging story world with specific characters, settings, or situations.
- The reader should feel immersed in the scenario before realizing it maps to an algorithmic challenge.
- **Vary themes**: Use creative, diverse contexts — fantasy worlds, detective investigations, cooking competitions, archaeological expeditions, space missions, wildlife research, city planning, etc.
- Every technical element should be naturally mapped to the story:
  * "array of numbers" → "the ancient scroll contains a sequence of rune power levels"
  * "find indices" → "identify which runes in the sequence"
  * "target sum" → "the ritual requires a combined power of exactly"
  * "return true/false" → "determine whether the expedition can succeed"
- The scenario should be 3-5 sentences of narrative context before the actual task description.
- Make the problem feel like a puzzle within the story, not a math problem with a coat of paint.
- Despite the rich narrative, the Input/Output format and constraints must remain precise and technical.
"""
    
    # Base Instruction
    extra_context = f"""
**SOURCE OF TRUTH FOR I/O FORMAT:**
You MUST use the `USER CODE` provided below as the absolute SOURCE OF TRUTH for the **Input Format** and **Output Format**.

**USER CODE:**
```cpp
{user_code}
```

**INSTRUCTION UPDATE:**
1. Carefully analyze the ENTITY of the `USER CODE`, including any `main` function or top-level input reading logic (e.g., `cin`, `scanf`, `input()`, `fs.readFileSync`).
2. Your generated description's "Input Format" and "Examples" must reflect the EXACT sequence and names of inputs read by the `USER CODE`.
3. If the code explicitly reads a variable (like a length `n` or `m`) before reading a collection/array, you MUST include that variable in your "Input Format" and "Examples".
4. If the code reads the collection/array directly (e.g., using `JSON.parse` or `getline` without an explicit size count), then you MUST NOT include a size variable.
5. Your generated description's "Output Format" must reflect EXACTLY what the `USER CODE` prints or returns as the final result of execution.
5a. **DETERMINISTIC ANSWER (CRITICAL):** if the task could admit MORE THAN ONE valid
   output (e.g. "return the indices of a pair summing to k" when several pairs qualify,
   any valid arrangement, multiple shortest paths), the "Output Format" MUST pin down a
   SINGLE expected answer with an explicit tie-break rule — e.g. "return the pair with
   the smallest first index, breaking ties by the smallest second index" or "return the
   lexicographically smallest such sequence". The tie-break MUST match what `USER CODE`
   actually produces: read its loop order and state the rule it already follows, never a
   rule you invent. Grading compares against ONE exact answer, so an ambiguous Output
   Format marks correct submissions wrong.
6. Do NOT blindly copy the input/output format text from the original problem description text if it conflicts with how the `USER CODE` actually reads/writes data.
7. **STRICT COMPLEX TYPE FORMATTING**: Any arrays, strings, or matrices mentioned in the description or examples MUST follow the exact input representation expected by the `USER CODE`. For example:
   - If the code reads a matrix row-by-row as space-separated values, describe it that way.
   - If the code expects a JSON-formatted array, ensure the Examples show it as `["a","b"]`.
   - If the code uses a specific delimiter (like a comma or space) for a list of strings, you MUST use that same delimiter in your "Input Format" and "Examples".

**CRITICAL: DO NOT mention time/space complexity constraints in the description.**
  - Do NOT write phrases like "solve in O(log n)" or "must run in O(n) time"
  - Do NOT mention complexity requirements anywhere in the description
  - Focus only on the problem logic and I/O format matching the `USER CODE`
"""

    prompt = f"""You are an expert technical content writer for a coding interview platform.
{extra_context}

**YOUR OBJECTIVE:**
Generate a comprehensive **Coding Question Description** that is REPHRASED and uses NEW variable/function names.

{rephrasing_mode}
{_SCENARIO_CLARITY_MANDATE}

**NAMING REQUIREMENTS (ALWAYS APPLY):**

**CRITICAL - YOU MUST CHANGE THESE:**
- **Function Name**: Generate a NEW camelCase name different from these common ones:
  * FORBIDDEN: twoSum, findPair, searchPair, getPair, findIndices, getIndices
  * GOOD: locatePairPositions, findMatchingElements, identifyTargetPair, seekElementPair
  
- **Variable Names in Description**: You MUST use DIFFERENT names from standard examples:
  * FORBIDDEN: nums, arr, array, target, sum
  * For array/list: Use "elements", "values", "data", "sequence", "collection", "items"
  * For target/goal: Use "goal", "required", "desired", "expected", "threshold"
  * For size: Keep as single letter `n` or `m` (this is OK)
  
- **Examples of Transformations**:
  * "array nums" → "sequence elements" or "collection values"
  * "target sum" → "goal value" or "required total"
  * "find indices" → "locate positions" or "identify locations"

- **Consistency**: Use your NEW chosen names EVERYWHERE in the description (examples, task, input/output format)

**CRITICAL RULES:**

**FORBIDDEN PHRASES (DO NOT USE):**
- "Given an array of integers"
- "return indices of"
- "find two numbers"
- "add up to target"
- "You may assume"
- "return the answer in any order"

**Instead, use creative rephrasing like:**
- "You are provided with a sequence of values..."
- "Identify the positions of..."
- "Locate a pair of elements..."
- "combine to form the specified sum..."
- "It is guaranteed that..."
- "The output order is flexible..."

1.  **Originality & Examples (CRITICAL)**:
    - **ABSOLUTELY NO COPYING**: You are strictly FORBIDDEN from using ANY of the examples provided in the input text. The input examples are ONLY for you to understand the problem.
    - **NEGATIVE CONSTRAINT**: You MUST NOT use the same numbers, the same arrays, the same strings, or the same expected outputs as the provided examples. If the input has `[1,4,5]`, your example MUST NOT have `[1,4,5]`.
    - **VIOLATION SEVERITY**: If your generated examples match the input examples, the system will reject your output.
    - **GENERATE NEW**: You must manually construct exactly 2 **Completely New, very good and Unique** examples from scratch. Do NOT generate more than 2 examples.
    - **Validity**: Ensure your newly invented examples are mathematically and logically valid for the algorithm.
    - **Format**: Follow the Input/Output format strict rules below.

2.  **Structure**:
    - Follow the specific section rules below. Do NOT deviate.

**OUTPUT FORMAT RULES**
1. Do NOT use `###`, `---`, or any heading tags.
2. Do NOT use markdown code fences (```md) around the entire output.
3. Do NOT include a "Problem Statement" title. Start directly with the description text.
4. Use `**` for section titles: **Example 1:**, **Example 2:**, **Input:**, **Output:**, **Explanation:**, **Your Task**, **Constraints**, **Input Format**, **Output Format**.
5. **CRITICAL:** You must leave exactly ONE BLANK LINE after every section title.
6. **CRITICAL: Add a Blank Line BETWEEN every bullet point.**

**CRITICAL: BACKTICKS FOR LITERALS (ALWAYS):**
You MUST use backticks (`` ` ``) for ANY literal values, characters, strings, or boolean results mentioned in the text.
- **DO NOT USE DOUBLE QUOTES** inside or outside the backticks for strings (except for empty string `""`). For example, use `a.c` instead of `"a.c"` or `"`a.c`"`.
- Examples: `.` , `*` , `abc` , `fl` , `true` , `false` , `""`.
- Apply this in the Problem Statement, Explanation, and Task sections.

**CRITICAL: DOCUMENT TERMINATION (DO NOT EXCEED):**
Your response MUST END immediately after the **Output Format** section.
- DO NOT include any additional "Example" sections or text after the Output Format.
- The Output Format section MUST be the FINAL section of your response.

7. **CRITICAL: Do add spaces between array elements.**
   - ALWAYS format arrays with spaces after commas.
   - Example INCORRECT: `[1,2,3,4,5]`
   - Example CORRECT: `[1, 2, 3, 4, 5]`

**SECTION INSTRUCTIONS**

**Problem Statement**
- Start immediately with the description text. Do not write "**Problem Statement**".
- **CRITICAL: Concise & Direct.**
- **CRITICAL: No Redundant Definitions.**
- **Line Structure / Readability:**
  - **CRITICAL: Do NOT write large blocks of text.**
  - Break the description into multiple lines based on meaning. 
  - Start a new line (with a blank line in between) for each distinct rule, definition, or objective.

**Examples**
- **CRITICAL: Do NOT copy examples from the input.**
- Provide exactly 2 examples. Do NOT generate more than 2 examples.
- Follow this exact format (Pay attention to blank lines):
- **CRITICAL: Do NOT use text or any letters or words after ``` in the examples section, it should strictly follow the below format with new line spaces as well.**

    **Example 1:**

    **Input:**

    ```
    n = 12
    ```

    **Output:**

    ```
    32
    ```

    **Explanation:**

    - Explanation text here.

**Your Task**
- Define the function signature with your NEW function name.
- Use camelCase for the function name based on the problem.
- Format:
    **Your Task**

    - Complete the provided `functionName` function that takes `arg` and returns `result`.

**Constraints**
- Use bullet points and backticks.
- **CRITICAL - VALUES MUST BE DEFINED**: Every constraint that has a numeric range MUST state explicit bounds. Do NOT use vague phrasing like "non-negative integer", "values may be negative, zero, or positive", or "finite count" without giving concrete limits.
- **REQUIRED FORMAT**: For each bounded quantity, write inequalities with concrete values, e.g. `0 ≤ k ≤ 10^4`, `−10^4 ≤ value ≤ 10^4`, `0 ≤ length ≤ 500`, `1 ≤ n ≤ 10^5`. Infer reasonable bounds from the problem and examples if the original does not specify them.
- Include one bullet per variable or quantity that has a range (e.g. count of inputs, size of arrays, value range of elements). Optional invariants (e.g. "list is sorted") may stay as short sentences.
{_CONSTRAINTS_NO_META}

**Input Format**
- Title: **Input Format** followed by a blank line.
- Describe the input structure STRICTLY based on the `USER CODE` logic. 
- **BULLET POINTS**: Use bullet points to describe inputs line-by-line or item-by-item.
- Examples of good phrasing:
  - "- The first string represents `text`, the string to be matched."
  - "- The second string represents `regex`, the pattern to match against."
- Your description MUST be consistent with the Examples you generated earlier.{_INPUT_LAYOUT_RULE}

**Output Format**
- Title: **Output Format** followed by a blank line.
- Describe the output structure STRICTLY based on the `USER CODE` logic.
- **BULLET POINTS**: Use bullet points to list the expected outcomes.
- Start with a generic sentence like "The output is a single line:" followed by bullet points.
- **CRITICAL: DO NOT use the word "Print" at the start of bullets.**
- Use phrasing like "- The output represents..." or "- The output contains..."
  - Example: "- The output represents `true` if `text` matches `regex`."
  - Example: "- The output represents `false` if `text` does not match `regex`."
- **EMPTY STRINGS**: Explicitly mention that if there is no result, an empty string `""` is returned/printed.
- **PRINT VS RETURN**: You MUST explicitly state in this section whether the final result is **printed** to the standard output or **returned** by the function, exactly as handled in the `USER CODE`.
- **CONSISTENCY**: The output representation (e.g., a JSON-formatted string, a space-separated list, or a single value) MUST match exactly what the `USER CODE` produces.
"""
    
    prompt += _function_example_format_addon(question_type)
    if question_type.lower() == 'node':
        prompt += """
    **For Node-Based Questions:**
    - The first line contains space-separated values representing the nodes.
    - `null` represents a null node.
"""
    return prompt


def get_nonfunction_structure_only_prompt(problem_name, question_type, user_code):
    """Structure-only (scenario_level == "none") pass for NON-function problems.

    Like `get_structure_only_prompt` it keeps the four pillars (scenario, names,
    examples, constraints) unchanged and only rebuilds the prose/structure — but
    it must NEVER emit a **Your Task** section (req 5: non-function descriptions
    have no Your Task). Section order follows clear picture.md for non-function:
    Problem Statement -> Input Format -> Output Format -> Constraints -> Examples.
    """
    prompt = f"""You are an expert technical content writer for a coding interview platform.
This is a **non-function-based** (full-program / stdin-stdout) problem. There is NO function signature and NO **Your Task** section.

**YOUR OBJECTIVE:**
REBUILD the given problem statement into a clean, clear, well-structured, professional description.
Rewrite the descriptive prose for clarity — but keep the problem's identity intact.

**WHAT YOU MUST NOT CHANGE (FOUR PILLARS — HIGHEST PRIORITY):**
1. **Scenario / framing** — Keep the SAME context. If the original is direct/technical, keep it technical; if it has a story, keep that same story.
2. **Variable names** — Keep the EXACT original variable names. Do NOT rename or invent new names.
3. **Examples** — Keep the SAME examples: identical input values, identical output values, identical explanatory facts. You MAY clean wording, but every number/string stays the same.
4. **Constraints** — Keep the SAME constraint bounds and values exactly. Preparer meta-notes (e.g. `(inferred; ...)`) are NOT part of the constraint — omit them even if present in the source.

**CRITICAL — NOTATION NORMALIZATION:**
The rendered page does NOT support LaTeX/MathJax. Convert all math notation to clean plain text. Remove `$...$`, `\\(...\\)`, `\\[...\\]`; replace `\\le`/`\\leq` → `≤`, `\\ge`/`\\geq` → `≥`, `\\times` → `×`, `\\cdot` → `·`, `\\ldots`/`\\dots` → `...`; keep exponents as `10^9 + 7`. There must be ZERO backslash-LaTeX commands left.

**SOURCE OF TRUTH FOR I/O FORMAT (reference ONLY — do NOT change variables, examples, or constraints):**
```
{user_code}
```

**OUTPUT FORMAT RULES:**
1. **NO ATX HEADINGS** of any level (no `#`, `##`, ...). Section titles use bold `**Title:**` only.
2. **NO horizontal dividers** (`---`, `***`, `___`).
3. **NO markdown tables.** Convert any table to a bullet list preserving every value.
4. Do NOT wrap the whole output in code fences.
5. Do NOT include a "Problem Statement" title — start directly with the description text.
6. Use `**` for section titles: **Input Format**, **Output Format**, **Constraints**, **Example 1:**, **Example 2:**, **Input:**, **Output:**, **Explanation:**. (There is NO **Your Task** section.)
7. Leave exactly ONE BLANK LINE after every section title.
8. Add a blank line BETWEEN every bullet point.
10. Code fences are bare ``` with no language identifier.

**FORBIDDEN:**
- Do NOT include a **Your Task** section or any function-signature / "complete the function" wording.
- Do NOT mention completing a named function.

**REQUIRED SECTIONS (in this exact order):**

**Problem Statement**
- Start immediately with the rebuilt description text (no title line). Break into short lines per rule/objective.

**Input Format**
- Title: **Input Format** then a blank line. Bullet points describing stdin line-by-line, consistent with the ORIGINAL examples and the `USER CODE`. Keep original variable names.{_INPUT_LAYOUT_RULE}

**Output Format**
- Title: **Output Format** then a blank line. Bullet points describing stdout, consistent with the ORIGINAL examples and `USER CODE`.
- **MANDATORY — the word "Print" is COMPULSORY here.** Start the output bullet(s) with `Print ...` (e.g. "Print a single integer ...", "Print each result on a new line"). The result is **printed** to standard output (full-program style).

**Constraints**
- Present the ORIGINAL constraints as bullet points with backticks and normalized notation (e.g. `5 ≤ |s| ≤ 10^5`). Do NOT change any values.
{_CONSTRAINTS_NO_META}

**Examples**
- Keep the SAME examples as the original (same number, same values). Re-format into this exact layout:

    **Example 1:**

    **Input:**

    ```
    ...
    ```

    **Output:**

    ```
    ...
    ```

    **Explanation:**

    - Explanation text here.

**FINAL CONFLICT-RESOLUTION RULE:** If any instruction conflicts with the FOUR PILLARS, the FOUR PILLARS WIN.
{_node_type_addon(question_type)}
"""
    return prompt


def get_nonfunction_description_prompt(problem_name, question_type, user_code, scenario_level="moderate"):
    """Non-function problems: no Your Task; section order per clear picture.md."""
    if scenario_level == "none":
        return get_nonfunction_structure_only_prompt(problem_name, question_type, user_code)

    rephrasing = ""
    if scenario_level == "light":
        rephrasing = "**REPHRASING WITH LIGHT SCENARIO:** Add minimal real-world context (1-2 sentences)."
    elif scenario_level == "moderate":
        rephrasing = "**REPHRASING WITH MODERATE SCENARIO:** Create a distinct scenario leading to the same I/O program."
    elif scenario_level == "heavy":
        rephrasing = "**REPHRASING WITH HEAVY SCENARIO:** Rich narrative framing the stdin/stdout program."

    return f"""You are an expert technical content writer for a coding interview platform.
This is a **non-function-based** (full-program / stdin-stdout) problem. There is NO function signature and NO **Your Task** section.

**SOURCE OF TRUTH FOR I/O FORMAT:**
Use the `USER CODE` below as the absolute source of truth for **Input Format** and **Output Format**.

**USER CODE:**
```
{user_code}
```

{rephrasing}
{_SCENARIO_CLARITY_MANDATE}

**CRITICAL: DO NOT COPY EXAMPLES** from the input problem. Invent exactly 2 new valid examples.

**REQUIRED SECTIONS (in this exact order):**
1. **Problem Statement** — start directly with prose (no section title line)
2. **Input Format**
3. **Output Format**
4. **Constraints**
5. **Examples** — exactly 2 examples with Input/Output/Explanation

**FORBIDDEN:**
- Do NOT include **Your Task** or any function-signature section
- Do NOT mention completing a named function
- Do NOT use `###`, `---`, or ATX headings
- Do NOT copy input examples verbatim

**FORMATTING:**
- Use `**` for section titles: **Input Format**, **Output Format**, **Constraints**, **Example 1:**, etc.
- One blank line after each section title
- Backticks for literal values
- Arrays with spaces after commas: `[1, 2, 3]`
- Code fences in examples: bare ``` with no language tag

**Input Format / Output Format:**
- Describe stdin/stdout line-by-line based on USER CODE{_INPUT_LAYOUT_RULE}
- **MANDATORY — the word "Print" is COMPULSORY in **Output Format**.** Start the output bullet(s) with `Print ...` (e.g. "Print a single integer ...", "Print each result on a new line"), since a full program writes its result to standard output.
- **DETERMINISTIC ANSWER (CRITICAL):** if the task could admit MORE THAN ONE valid output
  (e.g. indices of a pair summing to k when several pairs qualify, "any valid arrangement",
  multiple shortest paths), the Output Format MUST pin down a SINGLE expected answer with an
  explicit tie-break rule (e.g. "smallest first index, then smallest second index";
  "lexicographically smallest sequence") that is consistent with the examples and with what
  USER CODE produces. Never leave the expected output ambiguous — grading compares against one
  exact answer.

**Constraints:**
- Explicit numeric bounds with inequalities, e.g. `1 ≤ n ≤ 10^5`
{_CONSTRAINTS_NO_META}

**Examples format:**

    **Example 1:**

    **Input:**

    ```
    ...
    ```

    **Output:**

    ```
    ...
    ```

    **Explanation:**

    - ...

End immediately after Example 2 — no extra sections.
{_node_type_addon(question_type)}
"""