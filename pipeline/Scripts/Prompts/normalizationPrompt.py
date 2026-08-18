from Prompts.dataTypePrompt import get_data_type_selection_rules

# Emitted only for open-ended problems: they accept more than one correct answer, so
# grading cannot compare stdout to one stored string. Both rules below are silently fatal
# — the driver does `from solution import solution`, and at grading time that class is the
# STUDENT's, so a checker living inside it would grade every student against themselves.
_OPEN_ENDED_CHECKER_BLOCK = '''
**OPEN-ENDED PROBLEM — ALSO EMIT A CHECKER (mandatory):**
This problem accepts more than one correct answer, so grading cannot compare text. After
the `solution` class, append EXACTLY these two functions, with these EXACT names:

```
def reference_answer(stdin_text):
    """Return the exact stdout (no trailing newline) the reference prints for stdin_text."""

def is_valid_answer(stdin_text, candidate_stdout):
    """True iff candidate_stdout is a correct answer for the input in stdin_text."""
```

- Both MUST be **module-level** functions, NOT methods of `solution` and NOT nested.
- `reference_answer` MUST be **self-contained**: it may not call, instantiate or reference
  `solution` in any way. Duplicate whatever logic it needs.
- `is_valid_answer` MUST verify the answer against the problem's real condition (e.g. that
  the returned indices exist, are distinct and sum to the target). It MUST NOT simply
  compare against `reference_answer` — that would reject every valid alternative and defeat
  the point.
- `is_valid_answer(stdin, reference_answer(stdin))` MUST be True for every valid input.
- Keep the existing `solution` class and its stdin/stdout `main()` exactly as instructed
  above; the two functions are ADDITIONAL.
'''


def get_normalization_prompt(code, language, description_signature=None, desc_response=None, question_type="standard", open_ended=False):
    """
    Prompt to normalize user code to follow strict coding standards
    while preserving logic and I/O format.

    Args:
        code: User's source code
        language: Programming language
        description_signature: Optional dict with function name/params from description
        desc_response: The generated problem description string for validating input formatting
        open_ended: The problem admits several correct answers -> also emit the checker
    """

    data_structure_rules = ""
    if question_type in ["binary tree", "linked list"]:
        data_structure_rules = f"""
**CRITICAL DATA STRUCTURES:**
The original problem is a {question_type}. You MUST properly handle the `Node` class structure.
Use this EXACT structure if defining it:
    - C++: `class Node {{ public: int val; Node *left, *right; Node(int x) : val(x), left(nullptr), right(nullptr) {{}} }};` OR `class Node {{ public: int val; Node* next; Node(int val, Node* next) : val(val), next(next) {{}} Node(int val) : val(val), next(nullptr) {{}} }};`
    - Java: `class Node {{ ... }}` (use standard constructors as instructed in conversion rules)
    - Node.js: `class Node {{ ... }}`
    - Python: `class Node: ...`
"""
        if language.lower() in ['python', 'py']:
            data_structure_rules += """**CRITICAL PYTHON SIGNATURE**: The solution's methods MUST explicitly take `Node` as the second parameter after `self`. Example: `def functionName(self, Node, root):`.
"""

    # Description formatting rules
    desc_rules = ""
    if desc_response:
        desc_rules = f"""
**CRITICAL - DESCRIPTION I/O FORMAT PRECEDENCE (the description WINS):**
The output generated MUST parse inputs and print outputs EXACTLY as shown in the Problem Description below.
Match its worked examples **byte-for-byte**: token order, space vs newline separation, list form, float precision, line breaks and the trailing newline.
Where the `INPUT CODE`'s I/O disagrees with the description, the **DESCRIPTION WINS** — rewrite the driver's parsing/printing to match the examples. The language rules above never override this.
If the original code expects extra inputs (such as length `n` for an array) that are NOT explicitly provided in the Examples of the problem description, you MUST ignore those extra variables and derive them dynamically.
The input formatting must strictly mirror the examples in the description!

**AND the `INPUT CODE` remains the only authority on the implementation:** keep its algorithm, complexity, tie-breaks, rounding and result-formatting decisions exactly as written. Normalize I/O, never the logic — every testcase's expected output is produced by this implementation, so changing it silently invalidates them all.

PROBLEM DESCRIPTION:
{desc_response}
"""
    
    # Language-specific normalization rules
    lang_rules = ""
    if language.lower() in ['c++', 'cpp']:
        lang_rules = """
**C++ Normalization Rules:**
1. **Libraries**: Replace all individual includes with:
   ```cpp
   #include <bits/stdc++.h>
   using namespace std;
   ```
   If bits/stdc++.h is not available, use these standard includes:
   ```cpp
   #include <iostream>
   #include <vector>
   #include <algorithm>
   #include <climits>
   #include <iomanip>
   #include <string>
   #include <map>
   #include <set>
   #include <queue>
   #include <stack>
   using namespace std;
   ```
2. **Class Name**: Use `class solution` (lowercase 's')
3. **Remove Comments**: Strip all comments
4. **Compact Code**: Remove excessive blank lines
5. **Preserve**: Exact logic, I/O format, variable names, algorithm
6. **CRITICAL - Input Handling**: Read the input in the EXACT format the `PROBLEM DESCRIPTION`'s examples show (space- vs newline-separated, token order, which values are even present). Follow the original user code's reading only where the description is silent. Do NOT enforce JSON parsing unless the description's examples are JSON.
7. **CRITICAL - Output**: All output (including strings) MUST follow the formatting logic seen in the `USER CODE` and the `PROBLEM DESCRIPTION`. If the source code prints a raw string, the normalization MUST print a raw string.
8. **CRITICAL - Array Joining**: C++ lacks a native `join(vec, " ")` built-in function for arrays. Do NOT use `join`! If the output requires space-separated values, you MUST manually loop: `for(size_t i=0; i<res.size(); ++i) { cout << res[i] << (i < res.size()-1 ? " " : ""); } cout << "\\n";`
"""
    elif language.lower() == 'java':
        lang_rules = """
**Java Normalization Rules:**
1. **Libraries**: Use `import java.util.*;` and `import java.io.*;`
2. **Class Name**: Use `class Solution` (uppercase 'S')
3. **No External Libraries**: Remove any external dependencies (gson, etc.)
4. **Remove Comments**: Strip all comments
5. **Compact Code**: Remove excessive blank lines
6. **Preserve**: Exact logic, I/O format, variable names, algorithm
7. **CRITICAL - Input Handling**: Read the input in the EXACT format the `PROBLEM DESCRIPTION`'s examples show (space- vs newline-separated, token order, which values are even present). Follow the original user code's reading only where the description is silent. Do NOT enforce JSON parsing unless the description's examples are JSON.
8. **CRITICAL - Output**: All output (including strings) MUST follow the formatting logic seen in the `USER CODE` and the `PROBLEM DESCRIPTION`. If the source code prints a raw string, the normalization MUST print a raw string.
9. **CRITICAL - Array Wrapping**: NEVER use `System.out.println(list.toString())` if the description expects space-separated integers! Ensure you iterate over the result or use a `StringBuilder` to format output identically to the examples.
"""
    elif language.lower() in ['python', 'py']:
        lang_rules = """
**Python Normalization Rules:**
1. **Class Name**: Use `class solution` (lowercase 's')
2. **Remove Comments**: Strip all comments and docstrings
3. **Remove Type Hints**: Strip all type hints like `list[int]`, `-> int`, etc., from function signatures and variable declarations.
4. **Compact Code**: Remove excessive blank lines
4. **Preserve logic**: Exact logic, variable names, algorithm.
5. **CRITICAL - Optimal I/O**: You MUST update the driver code to use fast I/O (`sys.stdin.read().split()` or `sys.stdin.read().splitlines()` as appropriate). Take the TOKEN ORDER and which values are present from the `PROBLEM DESCRIPTION`'s examples. Use `sys.stdout.write()` for printing. Match the source code's output formatting logic strictly. Do NOT disturb the inner logic of `class solution`.
   * **stdin is RAW TOKENS, never `name = value`.** A function-based description RENDERS its examples as assignments (`numCourses = 6`, `arr = [1, 2, 3]`) because that reads better for a human. That is a DISPLAY form. The platform driver writes raw whitespace-separated values — `6`, then `1 2 3` — and never the assignment text. So take the token ORDER from the examples and NEVER the syntax: no `.split("=")`, no stripping of variable names, no `ast.literal_eval` of a displayed list.
   * Why this is CRITICAL and not stylistic: a reference that parses the display form still reproduces every stated answer, so it grounds clean, verifies clean and passes every execution-based check — then scores zero against the real driver. That happened on 2026-08-18 and only a text audit caught it.
   * Do NOT enforce JSON parsing unless the description's examples really are JSON on the wire.
"""
    elif language.lower() in ['javascript', 'node.js', 'nodejs', 'js']:
        lang_rules = """
**Node.js Normalization Rules:**
1. **Class Name**: Use `class Solution` (uppercase 'S')
2. **Remove Comments**: Strip all comments
3. **Compact Code**: Remove excessive blank lines
4. **Preserve**: Exact logic, I/O format, variable names, algorithm
5. **CRITICAL - Input Handling**: Read the input in the EXACT format the `PROBLEM DESCRIPTION`'s examples show (space- vs newline-separated, token order, which values are even present). Follow the original user code's reading only where the description is silent. Do NOT enforce JSON parsing unless the description's examples are JSON.
6. **CRITICAL - Output**: All output (including strings) MUST follow the formatting logic seen in the `USER CODE` and the `PROBLEM DESCRIPTION`. If the source code prints a raw string, the normalization MUST print a raw string.
"""
    
    # Signature override rules
    signature_rules = ""
    if description_signature:
        signature_rules = f"""
**CRITICAL - PARAMETER NAME OVERRIDE:**
The problem description REQUIRES these specific names:
- Function: `{description_signature.get('function_name', 'N/A')}`
- Parameters: `{', '.join(description_signature.get('parameters', []))}`

**MANDATORY RENAMING:**
1. Rename the main implementation function to: `{description_signature.get('function_name', 'N/A')}`
2. Rename parameters to EXACTLY: {', '.join(f'`{p}`' for p in description_signature.get('parameters', []))}
3. You MUST update all logic references in the function body to use these new names.
4. DO NOT use the original names from the input code.
5. **VERBATIM — DO NOT RE-CASE**: Use the function and parameter names character-for-character, with their EXACT capitalization. Do NOT apply any language naming convention (no snake_case, PascalCase, etc.). The name must stay byte-for-byte identical to what the description specifies.
6. This is a HARD REQUIREMENT.
"""

    # Python-shaped, so it is emitted only for a Python reference. The other three
    # languages get their own shape when the checker is translated (conversionPrompt).
    checker_rules = ""
    if open_ended and language.lower() in ['python', 'py']:
        checker_rules = _OPEN_ENDED_CHECKER_BLOCK

    prompt = f"""You are a Code Normalizer. Your task is to normalize the provided code to follow strict coding standards.

{lang_rules}
{signature_rules}
{desc_rules}
{data_structure_rules}
{checker_rules}

{get_data_type_selection_rules()}

**CRITICAL CONSTRAINTS:**
- **DO NOT change the algorithm or logic** - preserve it exactly
- **DO NOT change variable names** - keep them identical (EXCEPT for the function parameters which MUST be renamed as instructed above)
- **DO NOT change the I/O format unless instructed by the description format overrides** - must read/write according to the problem description strictly.
- **DO NOT change time/space complexity** - keep the same approach
- **ONLY normalize**: libraries, class names, remove comments, compact formatting, and correct the I/O to match the description.
- **CRITICAL - PRINTING FORMAT**: All code (especially Python) MUST print arrays/lists **WITHOUT spaces** after commas (e.g., `[1,2,3]` not `[1, 2, 3]`).
  - For Python, use `json.dumps(res, separators=(',', ':'))` or manual formatting if needed.
- **CRITICAL - HELPER FUNCTIONS**: Do NOT use nested functions or lambda functions (e.g., `std::function` in C++, inner `def` in Python, or arrow functions in JS) for helper logic. If the source uses nested helpers, extract them as separate methods within the `solution` class.

**INPUT CODE:**
```{language}
{code}
```

**OUTPUT:**
Return ONLY the normalized {language} code. No markdown, no explanations.
"""
    return prompt
