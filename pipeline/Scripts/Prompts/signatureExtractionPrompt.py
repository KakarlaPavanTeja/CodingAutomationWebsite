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
Extract the function signature that users need to implement. Look for sections like:
- "Function Signature"
- "Implement the following function"
- Code examples showing the function

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
1. Use the EXACT function name from the description
2. Use the EXACT parameter names from the description
3. Extract the return type description
4. If multiple functions, extract the main one

**OUTPUT:**
Return ONLY the JSON object. No markdown, no explanations.
"""
    
    return prompt
