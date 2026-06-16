def get_structure_only_prompt(problem_name, question_type, user_code):
    """
    Prompt for scenario_level == "none".

    Unlike the other scenario levels, this is a PURE structuring/formatting pass:
    the original problem statement, its variable/function names, its examples, and
    its scenario/framing are all kept EXACTLY as-is. Only the layout, sectioning,
    and formatting are improved. Nothing about the content is rewritten.
    """

    prompt = f"""You are an expert technical content writer for a coding interview platform.

**YOUR OBJECTIVE:**
Re-present the ORIGINAL problem statement with clean, consistent **structure and formatting ONLY**.
This is a pure formatting/structuring pass — it is **NOT** a rewrite or a rephrase.

**ABSOLUTE PRESERVATION RULES (HIGHEST PRIORITY — DO NOT VIOLATE):**
- **DO NOT change the meaning or wording of the problem statement.** Keep the original sentences and phrasing. You may only split run-on text into readable lines and place existing content under the correct sections.
- **DO NOT rename anything.** Keep the EXACT original function name and the EXACT original variable names. Do NOT invent or substitute new names.
- **DO NOT change the examples.** Reuse the ORIGINAL examples verbatim — the same numbers, arrays, strings, inputs and outputs. Do NOT add, remove, reorder, or alter any example values.
- **DO NOT change the scenario/framing.** If the original has a story/scenario, keep it exactly. If it has none, do NOT add one.
- **DO NOT change the constraints.** Keep the original constraint values exactly; you may only reformat them into bullet points.
- Your ONLY job is readability: section organization, line breaks, backticks for literals, blank lines, and consistent formatting. When in doubt, preserve the original content.

**USER CODE (reference ONLY — to confirm whether the result is printed vs returned for the Output Format wording; DO NOT use it to change variables, examples, scenario, or wording):**
```cpp
{user_code}
```

**OUTPUT FORMAT RULES**
1. Do NOT use `###`, `---`, or any heading tags.
2. Do NOT use markdown code fences (```md) around the entire output.
3. Do NOT include a "Problem Statement" title. Start directly with the description text.
4. Use `**` for section titles: **Example 1:**, **Example 2:**, **Input:**, **Output:**, **Explanation:**, **Your Task**, **Constraints**, **Input Format**, **Output Format**.
5. **CRITICAL:** You must leave exactly ONE BLANK LINE after every section title.
6. **CRITICAL: Add a Blank Line BETWEEN every bullet point.**

**BACKTICKS FOR LITERALS (PROSE ONLY):**
- In the prose sections (Problem Statement, Explanation, Your Task), you MAY wrap literal values/characters/strings/booleans in backticks (`` ` ``) for readability.
- This is a layout aid ONLY and must NEVER change the actual value, spelling, or casing of anything.
- **NEVER touch the Examples' Input/Output code blocks** — those stay byte-for-byte identical to the original (see preservation rules).

**CRITICAL: DOCUMENT TERMINATION (DO NOT EXCEED):**
Your response MUST END immediately after the **Output Format** section.
- DO NOT include any additional "Example" sections or text after the Output Format.
- The Output Format section MUST be the FINAL section of your response.

**SECTION INSTRUCTIONS**

**Problem Statement**
- Start immediately with the original description text. Do not write "**Problem Statement**".
- Preserve the original wording and meaning. Only restructure for readability.
- **Line Structure / Readability:**
  - **CRITICAL: Do NOT write large blocks of text.**
  - Break the existing description into multiple lines based on meaning.
  - Start a new line (with a blank line in between) for each distinct rule, definition, or objective.

**Examples**
- **CRITICAL: Reuse the ORIGINAL examples exactly.** Do NOT invent new examples and do NOT change any values.
- Keep the same number of examples as the original (do not add or drop any).
- Re-format each original example into this exact layout (Pay attention to blank lines):

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
- Preserve the ORIGINAL task sentence and the ORIGINAL function name/signature verbatim. Do NOT rename, paraphrase, or invent argument/return names.
- Only reposition the existing task text under this heading and apply blank-line/bullet formatting.
- Format (keep the original names, do not use placeholders):
    **Your Task**

    - <original task sentence, with the original function name and signature kept exactly as written>.

**Constraints**
- Reformat the ORIGINAL constraints into bullet points with backticks. Do NOT change any values or bounds.
- If the original states explicit bounds, keep them exactly. Do NOT invent or tighten/loosen limits.

**Input Format**
- Title: **Input Format** followed by a blank line.
- Describe the input structure consistent with the ORIGINAL examples and the `USER CODE` logic.
- **BULLET POINTS**: Use bullet points to describe inputs line-by-line or item-by-item.
- Keep the original variable names.

**Output Format**
- Title: **Output Format** followed by a blank line.
- Describe the output structure consistent with the ORIGINAL examples and the `USER CODE` logic.
- **BULLET POINTS**: Use bullet points to list the expected outcomes.
- Start with a generic sentence like "The output is a single line:" followed by bullet points.
- **CRITICAL: DO NOT use the word "Print" at the start of bullets.**
- **PRINT VS RETURN**: You MUST explicitly state whether the final result is **printed** to standard output or **returned**, exactly as handled in the `USER CODE`.
- **CONSISTENCY**: The output representation MUST match exactly what the original examples show.

**FINAL CONFLICT-RESOLUTION RULE (READ LAST):**
If ANY formatting/section rule above ever conflicts with preserving the original content, **PRESERVATION ALWAYS WINS**. Never modify the original wording, variable/function names, example values, scenario, or constraints in order to satisfy a formatting rule.
"""

    if question_type.lower() == 'node':
        prompt += """
    **For Node-Based Questions:**
    - The first line contains space-separated values representing the nodes.
    - `null` represents a null node.
"""
    return prompt


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

**Input Format**
- Title: **Input Format** followed by a blank line.
- Describe the input structure STRICTLY based on the `USER CODE` logic. 
- **BULLET POINTS**: Use bullet points to describe inputs line-by-line or item-by-item.
- Examples of good phrasing:
  - "- The first string represents `text`, the string to be matched."
  - "- The second string represents `regex`, the pattern to match against."
- Your description MUST be consistent with the Examples you generated earlier.

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
    
    if question_type.lower() == 'node':
        prompt += """
    **For Node-Based Questions:**
    - The first line contains space-separated values representing the nodes.
    - `null` represents a null node.
"""
    return prompt