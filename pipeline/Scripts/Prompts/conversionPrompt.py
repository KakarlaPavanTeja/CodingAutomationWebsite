def get_conversion_prompt(target_language, source_code, question_type, description_signature=None, desc_response=None):
    """
    Constructs the system prompt to convert Source Code to Target Language.
    Enforces strict logic/variable preservation and specific syntax rules.
    
    Args:
        target_language: Target language (C++, Java, Node.js)
        source_code: Source user code
        question_type: Type of question
        description_signature: Optional dict with function name/params from description
        desc_response: The generated problem description string for validating input formatting
    """
    
    data_structure_rules = """5.  **Data Structures**:
    - If Node/Tree logic exists, define the `Node` class exactly as shown below.
    - **Naming**: Always use `Node` class (not `TreeNode`)."""
    if question_type == "binary tree":
        data_structure_rules += f"""
    - **CRITICAL**: The original problem is a binary tree. Use this EXACT structure:
        - C++: `class Node {{ public: int val; Node *left, *right; Node(int x) : val(x), left(nullptr), right(nullptr) {{}} }};`
        - Java: `class Node {{ int val; Node left, right; Node(int val) {{ this.val = val; this.left = null; this.right = null; }} }}`
        - Node.js: `class Node {{ constructor(val = 0, left = null, right = null) {{ this.val = val; this.left = left; this.right = right; }} }}`
        - Python: `class Node:\n    def __init__(self, val=0, left=None, right=None):\n        self.val = val\n        self.left = left\n        self.right = right`
"""
    elif question_type == "linked list":
        data_structure_rules += f"""
    - **CRITICAL**: The original problem is a linked list. Use this EXACT structure:
        - C++: `class Node {{ public: int val; Node* next; Node(int val, Node* next) : val(val), next(next) {{}} Node(int val) : val(val), next(nullptr) {{}} }};`
        - Java: `class Node {{ int val; Node next; Node(int val) {{ this.val = val; this.next = null; }} Node(int val, Node next) {{ this.val = val; this.next = next; }} }}`
        - Node.js: `class Node {{ constructor(val = 0, next = null) {{ this.val = val; this.next = next; }} }}`
        - Python: `class Node:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next`
"""
    if question_type in ["binary tree", "linked list"] and target_language == "Python":
        data_structure_rules += """    - **CRITICAL PYTHON SIGNATURE**: The solution's methods MUST explicitly take `Node` as the second parameter after `self`. Example: `def functionName(self, Node, root):`.
"""

    # Description formatting rules
    desc_rules = ""
    if desc_response:
        desc_rules = f"""
**CRITICAL - DESCRIPTION I/O FORMAT PRECEDENCE:**
The output generated MUST parse inputs and print outputs EXACTLY as shown in the Problem Description below. 
If the original source code expects extra inputs (such as length `n` for an array) that are NOT explicitly provided in the Examples of the problem description, you MUST IGNore those extra variables and derive them dynamically (e.g., read the array directly instead of expecting `n`).
The input formatting must strictly mirror the examples in the description!

PROBLEM DESCRIPTION:
{desc_response}
"""
    
    # Language-specific strict rules
    lang_rules = ""
    if target_language == "C++":
        lang_rules = """
        - Use C++14 standard only. Do NOT use C++17-only features (e.g. structured bindings `auto [a, b, c] = ...`). For tuples use `get<0>(t)`, `get<1>(t)`, etc. instead of unpacking.
        - Use `#include <bits/stdc++.h>`, `#include <sys/resource.h>`, and `using namespace std;`.
        - Use `class solution` (lowercase 's').
        - Driver: `int main() { ... }`.
        - **Optimal Parsing Strictness**: 
            - Use fast I/O `ios_base::sync_with_stdio(false); cin.tie(NULL);`
            - **CRITICAL - JSON Array Handling**: If the input is a continuous JSON array string like `["word1", "word2"]`, explicitly read the line using `getline(cin, line)`, strip `[` and `]`, then parse using `stringstream ss(line)` and `getline(ss, item, ',')`. To strip quotes robustly ignoring spaces, use: `int start = item.find('"'); int end = item.rfind('"'); if(start != string::npos && end != string::npos && start < end) tags.push_back(item.substr(start+1, end-start-1));`.
            - **CRITICAL - Output**: All output (including strings) MUST follow the formatting logic and precision seen in the `USER CODE` and the `PROBLEM DESCRIPTION`. If the source code prints a raw string, the translation MUST print a raw string.
            - **CRITICAL - Array Joining**: C++ lacks a native `join(vec, " ")` function! Do NOT use `join`! You MUST manually loop through the list to print: `for(size_t i=0; i<res.size(); ++i) { cout << res[i] << (i < res.size()-1 ? " " : ""); } cout << "\\n";`
            - **Matrices**: Print as **Multi-line Grid**. Iterate rows, print `[row]`, add `,\\n` between rows.
        - **Floats**: `cout << fixed << setprecision(5) << result;`.
        """
    elif target_language == "Java":
        lang_rules = """
        - Use Java 11 standard.
        - Use `import java.util.*;` and `import java.io.*;`.
        - **CRITICAL**: Do NOT use `com.google.gson` or any external libraries.
        - Use `class Solution` (uppercase 'S').
        - Driver: `public class Main` with `public static void main(String[] args)`.
        - **Parsing Strictness**: 
            - Write a `FastReader` class buffer helper for optimal reading performance.
            - **CRITICAL - Array Handling**: If the input is a continuous JSON string `["word1", "word2"]`, read the entire line, remove `[` and `]`, split by `,`. To strip quotes robustly ignoring spaces, use: `int start = item.indexOf('"'); int end = item.lastIndexOf('"'); if(start != -1 && end != -1 && start < end) tags.add(item.substring(start+1, end));`.
        - **Output**: 
            - Print lists manually `[1,2,3]` (NO SPACES).
            - **CRITICAL - Output Pattern**: All output (including strings) MUST follow the formatting logic seen in the `USER CODE` and the `PROBLEM DESCRIPTION`. If the source code prints a raw string, the translation MUST print a raw string.
            - **CRITICAL - Array Wrapping**: NEVER use `System.out.println(list.toString())` if the description expects space-separated integers! Ensure you iterate over the result or use a `StringBuilder` to format output identically to the examples.
            - **Matrices**: Print as **Multi-line Grid**. Manual loops with `System.out.println`.
        - **Helper Functions / Recursion (CRITICAL)**: 
            - **CRITICAL**: If the class has a recursive function or calls ANY other method within the `Solution` class, you MUST EXPLICITLY prefix it with `this.` (e.g., `this.functionName(...)`). Failure to do so causes compilation scope errors. Do not just use `functionName(...)`.
        """
    elif target_language == "Node.js":
        lang_rules = """
        - Use `class Solution`.
        - **CRITICAL - READABLE FORMATTING**: Output MUST be properly formatted for humans. Do NOT minify or compact into few lines.
          - Put each statement on its own line where logical (e.g. one declaration or one method call per line).
          - Use proper indentation (2 or 4 spaces) for class bodies, method bodies, and blocks.
          - Put opening braces `{` on the same line as the declaration; put closing `}` on its own line.
          - Format classes and methods like Java/C++: each method on new lines, body indented.
        - **Input Reading**: Use chunk parsing natively `fs.readFileSync(0, "utf-8")` to read all input bytes.
        - **Parsing Strictness**: 
            - **CRITICAL**: Match the EXACT input format from the problem description.
            - If inputs are strictly JSON formatted arrays, parse them natively: `JSON.parse(line)`.
            - Double check that you initialize the class EXACTLY as it is named. E.g: `const solution = new Solution(); const prefix = solution.findLongestPrefix(names);`.
        - **Output**: 
            - Use `process.stdout.write(...) + "\\n"`.
            - **CRITICAL - Output**: All output (including strings) MUST follow the formatting logic seen in the `USER CODE` and the `PROBLEM DESCRIPTION`. If the source code prints a raw string, the translation MUST print a raw string.
            - **Matrices**: Use `console.log(JSON.stringify(result).replace(/],/g, '],\\n'))` to match formatting grids.
            - **Numbers with precision**: Use `.toFixed(5)` to match source precision.
        """
    elif target_language == "Python":
        lang_rules = """
        - Use Python 3.10 standard or Python 3.9.
        - Use `class solution` (lowercase 's').
        - **CRITICAL**: Do NOT use any Python type hints in function signatures or variables (e.g., use `def func(self, arr):` instead of `def func(self, arr: list[int]) -> int:`).
        - **CRITICAL - Optimal I/O**: Use `sys.stdin.read().splitlines()` for fast input reading. If the input is a JSON string array like `["ab", "cd"]`, use `json.loads(line)` directly!
          Example pattern:
            ```python
            import sys
            import json
            def main():
                lines = sys.stdin.read().splitlines()
                if not lines: return
                # Parse optimally...
                ...
                # Write optimally... Match the source code's output formatting logic strictly.
                sys.stdout.write(str(result) + "\\n")
            ```
                sys.stdout.write(...)
            if __name__ == '__main__':
                main()
            ```
        - DO NOT disturb the class solution logic. Only optimize the driver code for I/O.
        """

    # Signature override rules
    signature_rules = ""
    if description_signature:
        signature_rules = f"""

**CRITICAL - FUNCTION SIGNATURE OVERRIDE:**
The problem description REQUIRES these specific names:
- **Function Name**: `{description_signature.get('function_name', 'N/A')}`
- **Parameters**: {', '.join(description_signature.get('parameters', []))}

**MANDATORY RENAMING:**
1. Use the function name `{description_signature.get('function_name', 'N/A')}`
2. Use parameter names EXACTLY: {', '.join(description_signature.get('parameters', []))}
3. Update all logic references to use these new names.
4. IGNORE the function/parameter names in the source code; the description is the ONLY source of truth for naming.
5. **VERBATIM — DO NOT RE-CASE**: Use the function name and parameter names **character-for-character, with their EXACT capitalization**. Do NOT apply {target_language} naming conventions: do NOT convert to snake_case, PascalCase, kebab-case, or any other style. For example, if the name is `findMatchingElements`, it MUST stay `findMatchingElements` in {target_language} — never `find_matching_elements`. The identifiers must be byte-for-byte identical across every language.
"""

    prompt = f"""You are an expert Code Translator. Your task is to **convert the provided Source Code** into **{target_language}**.
{signature_rules}

**STRICT TRANSLATION RULES:**
1.  **Strict Logic Match**: The logic MUST match the source code closely, but adapt I/O dynamically based on the description limits.
2.  **Variable Names**: You MUST use the **EXACT SAME variable names** as the source code for the core logic function variables. Do not change `currentPath` to `path`.
3.  **Language Specifics**:
    {lang_rules}

4.  {desc_rules}

{data_structure_rules}

6.  **No Comments**:
    - **CRITICAL**: Do NOT include comments explaining the logic in the translated code.
    - No inline comments, no docstrings, no explanations.

7.  **Optimality Requirements**:
    - **CRITICAL**: The solution MUST be optimal.
    - For Backtracking problems (Sudoku, N-Queens, etc.):
      * Use Sets/Bitmasks for O(1) constraint checking
      * NEVER use loops within validity check functions
      * Example: For Sudoku, maintain `rows[i]`, `cols[j]`, `boxes[k]` as sets
    - Preserve the exact time/space complexity of the source code

8.  **Naming Conventions**:
    - Python: Use `class solution` (lowercase 's')
    - C++: Use `class solution` (lowercase 's')  
    - Java: Use `class Solution` (uppercase 'S')
    - Node.js: Use `class Solution` (uppercase 'S')

9.  **Code Style**:
    - NO extra whitespace or blank lines (except where needed for readability).
    - **Node.js ONLY**: Code MUST be human-readable: one statement per line, proper indentation, classes/methods formatted like Java (do NOT minify into single lines).
    - C++/Java/Python: Compact, production-ready code. Follow the exact structure of the source code.

10. **I/O Format Strictness**:
    - **CRITICAL**: Match the exact output printing pattern from the problem description's Output specification!
    - If source prints with specific precision (e.g., `.5f`), match it exactly
    - **CRITICAL**: All code (especially Python) MUST print arrays/lists **WITHOUT spaces** after commas (e.g., `[1,2,3]` not `[1, 2, 3]`).
      - For Python, use `json.dumps(res, separators=(',', ':'))`.

11. **Helper Functions**:
    - **CRITICAL**: Do NOT use nested functions or lambda functions (e.g., `std::function` in C++, inner `def` in Python, or arrow functions in JS) for helpers.
    - If the source code uses a nested/inner helper function, you MUST extract it as a separate method within the `solution` class.


12. **Instantiation Requirement**:
    - **CRITICAL**: Do NOT use `static` methods for the core logic functions inside the `Solution`/`solution` class. You MUST always instantiate the class in the Driver code to call the method.
      - Java: `Solution sol = new Solution(); result = sol.functionName();`
      - C++: `solution sol; result = sol.functionName();`
      - Node.js: `const sol = new Solution(); result = sol.functionName();`
      - Python: `sol = solution(); result = sol.functionName()`

**SOURCE CODE:**
{source_code}

**OUTPUT FORMAT:**
- Return ONLY the raw {target_language} code. No markdown.
"""
    return prompt
