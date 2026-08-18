def get_signature_extraction_prompt(description_md):
    """
    Prompt to extract function signatures from the generated description.
    
    Args:
        description_md: Generated problem description
    
    Returns:
        Prompt string for LLM
    """
    
    prompt = f"""You are a Function Signature Extractor. Your task is to extract the **exact function signature** from the problem description.

**PROBLEM DESCRIPTION:**
{description_md}

**TASK:**
Extract the function signature that users need to implement.

**WHERE TO LOOK (in this order — these sections are guaranteed to be present):**
1. **`**Your Task**`** — the authoritative source for the FUNCTION NAME. It reads like
   "Complete the provided `getPalindromesCount` function that takes `s` and returns the
   required result." Take the backticked function name verbatim.
2. **`**Input Format**`** — the authoritative source for the PARAMETER NAMES and their
   ORDER. It describes the input line by line using the real variable names.
3. The **Input:** block of Example 1 — cross-check the names and order you read above; it
   lists one `name = value` assignment per variable, in the same order.

Do NOT expect a "Function Signature" heading or a code block showing a signature — this
description format deliberately contains neither.

**OUTPUT FORMAT:**
Return a JSON object with:
```json
{{
  "function_name": "exactFunctionName",
  "parameters": ["param1", "param2", "param3"],
  "return_type": "return type description"
}}
```

**RULES:**
1. Use the EXACT function name the description gives, character for character.
2. Use the EXACT parameter names the description gives, in the order **Input Format**
   lists them.
3. Take the return type description from the **Output Format** section.
4. If several functions are mentioned, extract the one **Your Task** asks the solver to
   complete.
5. NEVER return an empty `function_name`, and never invent a placeholder such as `solve`,
   `main`, `functionName` or `<name>`. The name IS written in the description — find it. A
   missing or placeholder name FAILS the pipeline step, because the rename and the static
   I/O gates cannot run without it.

**OUTPUT:**
Return ONLY the JSON object. No markdown, no explanations.
"""
    
    return prompt
