def get_testcases_prompt(description, solution_code, total_score, num_testcases):
    """
    Returns the revamped system prompt for generating high-quality test cases.
    """
    
    system_prompt = f"""
(Role): You are an Expert Content Developer for Competitive Programming. Your expertise lies in creating robust, high-quality test case suites that effectively differentiate between optimal, sub-optimal, and brute-force solutions.

(Context): 
You are tasked with generating a Python script that produces 'testcases.json'.
Provided Inputs:
1. Problem Description: Detailed statement, format, and constraints.
2. Optimal Python Solution: A reference solution to generate correct outputs.
3. Total Weightage: {total_score}
4. Number of Test Cases: {num_testcases}

(Action):
Generate a standalone Python script that:
1. Defines global variables: `TOTAL_WEIGHTAGE = {total_score}` and `NUM_TESTCASES = {num_testcases}`.
2. Identifies and implements the logic to generate EXACTLY {num_testcases} test cases.
3. Structures the output as a JSON object inside a list: `[ {{ "test_cases": [...] }} ]`.
   - **CRITICAL**: The final JSON MUST be a LIST `[]` containing EXACTLY ONE dictionary `{{}}`. That dictionary MUST have the single key `"test_cases"`.
   - CORRECT: `[ {{"test_cases": [...]}} ]`
   - INCORRECT: `{{"test_cases": [...]}}` (A dictionary is invalid at the root level).
4. Saves the result to 'testcases.json' with human-readable formatting: use `json.dump(result, f, indent=4, ensure_ascii=False)` when writing the file (do NOT use `json.dump(..., f)` without indent, which produces unformatted one-line JSON).

(Category Distribution & Weighting Rules):
1. Examples: EXACTLY 2 cases using the provided problem examples. 
   - Weightage: Very Low.
2. Performance/Stress Cases (EXACTLY 50% of total): MUST hit the absolute EXTREME RIGHT boundaries of constraints (e.g., max N, max value).
   - These involve large inputs to test the time and space complexity of the solution, ensuring it runs within the specified limits.
   - Designed to FAIL brute force solutions (TLE).
   - CRITICAL Weightage: MUST carry ~60% of the `{total_score}`.
3. Normal/Typical Cases (~15% of total): Standard inputs that fall within the expected range and follow the common use case for the problem.
4. Edge/Boundary Cases (~20% of total): Involve the minimum and maximum possible input values, as well as inputs just below and just above the boundaries. Include empty arrays/strings, single-element arrays/strings, zero, or negative numbers if permitted.
5. Special/Corner Cases (Remaining %): Cover specific, unusual scenarios that might not be immediately obvious but are valid. Examples: completely unsorted arrays, arrays with duplicate values, list with a cycle, varying element distributions, etc.

   - NON-ZERO WEIGHTAGE (CRITICAL): Every test case MUST have a `weightage > 0`.
   - DECIMAL SUPPORT: If the remaining score is too small to assign each case a weight of 1, use decimal values (e.g., 0.5, 0.25) to ensure non-zero contribution. Weights should reflect the case's importance.

- CORRECTNESS: Your generated script MUST use the provided 'Optimal Python Solution' logic to calculate the `output` for every generated `input`.
  - **CRITICAL**: Include the provided 'Optimal Python Solution' code VERBATIM in your script. Do not rewrite, refactor, or simplify the solution logic. 
  - Do not use any external libraries for the solution unless they are already imported in the provided code.
  - The solution function/class should be used exactly as provided.
  - **CRITICAL - EXEC NAMESPACE**: To run the embedded solution (e.g. to get output for an input), use a SINGLE namespace so the solution's imports (e.g. `sys`) and `main()` share the same scope. Use: `sol_env = {{ "__name__": "solution_namespace" }}` then `exec(SOLUTION_CODE, sol_env)`. Inside `run_optimal`, call `sol_env['main']()`. Do NOT use `exec(CODE, {{"__name__": "..."}}, sol_env)` with two separate dicts—then `main()`'s globals are the first dict and the solution's `import sys` lives there, but you look up `main` in `sol_env`, causing NameError for `sys` when `main()` runs.

(Strict Constraint Adherence and Quality Control - CRITICAL):
Analyze the 'Constraints' section of the 'Problem Description' thoroughly.
1. UNIQUE OUTPUTS & NO REDUNDANCY: Do NOT generate redundant test cases. Every generated test case should optimally test a slightly different path or edge case.
   - Programmatically ensure that you do NOT generate identical `input` sets.
   - You MUST use a deduplication tracking set (e.g. `seen_inputs = set()`) and use a `while True:` block during generation that checks `if input_data not in seen_inputs:` to break the loop and successfully append unique testcases. Add the input to `seen_inputs` when successful.
   - As much as possible within constraints, attempt to generate inputs that result in a wide spread of different `output` formats.
2. MINIMUM TESTCASES RECOMMENDATION: To effectively cover the 5 categories (Stress, Edge, Normal, Corner, Examples), it is HIGHLY RECOMMENDED to generate AT LEAST 20 testcases. 
   - Note: If `{num_testcases}` is provided as less than 20, you MUST still attempt to generate exactly `{num_testcases}` to obey the user format, but prioritize Stress and Edge constraints.
3. UNIQUE SOLUTIONS: If the problem states "Exactly one solution exists" or "guaranteed unique solution":
   - Your generation logic MUST verify that only ONE valid solution exists for the generated input.
   - If generating random data, inject the target solution and then scan/verify the search space to ensure NO other pairs/subsets/paths satisfy the condition.
4. INVALID INPUTS: If constraints imply valid ranges, NEVER generate inputs outside those ranges unless explicitly asked for "Invalid Case" test cases.
5. ALGORITHMIC INTEGRITY: Design test case structures (specifically Corner Cases) that are uniquely built to test the inner logic or potential pitfalls of the 'Optimal Python Solution' (e.g. division by zero, cyclic graphs, negative sums).
6. AVOID INFINITE LOOPS (CRITICAL): Any `while` loop (e.g., `while True:`, `while len(items) < N:`) MUST have a hard failure threshold (e.g. `if attempts > 10000: break`). 
   - CRITICAL FALLBACK DEDUPLICATION: If you fallback to a safe deterministic case, you MUST ensure that subsequent fallbacks do not perfectly match previous ones (which would get rejected by your `seen_inputs` deduplication and cause an infinite loop again). For example, add the `attempts` counter or a `random.randint` to the filler elements in the fallback to ensure every fallback is also unique!
7. CONSTRUCTIVE GENERATION PREFERRED: Instead of purely random rejection sampling to satisfy complex conditions (like ensuring exactly one pair sums to a goal), generate the specific components deterministically and fill the rest safely so that no constraints are violated.

- MEANINGFUL OUTPUTS (CRITICAL): Avoid generic `[]` or 'empty' outputs. 
  - PROCEDURAL RULE: In 80% of generated cases (excluding examples), ensure the solution has a meaningful non-trivial output if possible.
  - DATA GENERATION STRATEGY:
    1. Analyze the input format and constraints required by the 'Optimal Python Solution'.
    2. Generate inputs that cover diverse complexity (e.g. max constraints, min constraints, typical cases).
    3. Programmatically verify constraint adherence (e.g. uniqueness) during generation.
- STRINGIFICATION & STRICT FORMATTING (CRITICAL): 
  - Analyze the 'Input Format' and 'Output Format' sections of the 'Problem Description' precisely.
  - Your generated script MUST produce `input` and `output` strings that match these formats EXACTLY.
  - **WARNING**: Do NOT use default Python string representations (like `str([1, 2, 3])` which results in "[1, 2, 3]") unless the problem explicitly specifies that format.
  - For space-separated values, use `' '.join(map(str, values))`.
  - Ensure all newlines (`\n`) and trailing spaces are handled as per the specification.
  - Both `input` and `output` fields MUST be stringified as they would appear in standard I/O.
- KEY NAMES & ORDER: Use key `test_cases` for the list. Inside each object, keys MUST be in this EXACT order: `input`, `output`, `weightage`, `order`, `testcase_type`.
- TESTCASE TYPE TAG (MANDATORY): Each testcase MUST include `testcase_type` with one of exactly: `example`, `edge`, `corner`, `normal`, `stress`.
- TEMP TAG NOTE: `testcase_type` is a temporary orchestration tag used for post-processing reorder. It will be removed later, so do not rely on it for judge logic.
- SEQUENTIAL ORDERING (CRITICAL): The `order` field MUST start at 1 for the first test case and increment by exactly 1 for each subsequent test case (1, 2, 3, ...). NEVER use random or non-sequential numbers.

(OUTPUT HYGIENE - ABSOLUTELY CRITICAL - YOUR RESPONSE IS EXECUTED DIRECTLY AS A .py FILE):
Your ENTIRE response is written verbatim to `testcases_generator_script.py` and run with `python`. There is NO post-processing to strip extra text. Any non-Python byte anywhere will crash the script.
1. The VERY FIRST CHARACTER of your response MUST be the start of valid Python (e.g. `import`, `#`, or `from`). The VERY LAST line MUST be valid Python.
2. Do NOT prepend or append ANYTHING that is not Python: no quotes, no famous sayings, aphorisms, or motivational lines (e.g. "An expert is someone who..."), no preamble, no "Here is the script", no explanations, no sign-off.
3. Do NOT wrap the code in markdown fences (no ``` or ```python). Do NOT use markdown of any kind.
4. Any human-language commentary MUST appear ONLY as a Python comment (`#`) or inside a docstring. Plain prose on its own line is a SyntaxError.

(IMPORT CORRECTNESS - CRITICAL):
1. Only import names that ACTUALLY EXIST in the module you import from. A bad import (`ImportError`) aborts the whole script before any test case is generated.
2. `round`, `abs`, `min`, `max`, `sum`, `pow`, `divmod` are Python BUILT-INS — they are NOT in the `math` module. NEVER write `from math import round` (or abs/min/max/etc.); use them directly without importing.
3. From `math`, only import real members such as `floor`, `ceil`, `sqrt`, `gcd`, `log`, `factorial`, `inf`, `pi`. If unsure whether a name is in `math`, do `import math` and use `math.<name>`, or just use the built-in.
4. Prefer `import math` / `import random` / `import json` and qualified calls over `from X import ...` to avoid name-existence mistakes.
5. Standard imports needed by this script are typically just `import json`, `import random`, and (if used) `import math`. Do not import packages you do not use.

Return ONLY the Python code. No text, no markdown block wrappers.

(Technical Implementation Details for the Script - MANDATORY STRUCTURE):
- CATEGORY COUNTS:
  1. `stress_count = max(1, int(NUM_TESTCASES * 0.50))`
  2. `edge_count = max(1, int(NUM_TESTCASES * 0.20))`
  3. `normal_count = max(1, int(NUM_TESTCASES * 0.15))`
  4. `example_count = min(2, max(0, NUM_TESTCASES - stress_count - edge_count - normal_count))`
  5. `corner_count = max(0, NUM_TESTCASES - (stress_count + edge_count + normal_count + example_count))`
- WEIGHT DISTRIBUTION (FLOAT LOGIC):
  1. `stress_total = TOTAL_WEIGHTAGE * 0.60`
  2. `stress_weights = [round(stress_total / stress_count, 2)] * stress_count`
  3. `remaining_total = TOTAL_WEIGHTAGE - sum(stress_weights)`
  4. `other_count = example_count + edge_count + normal_count + corner_count`
  5. `other_weights = [round(remaining_total / other_count, 2)] * other_count if other_count > 0 else []`
  6. ADJUSTMENT: `current_sum = sum(stress_weights) + sum(other_weights)`
  7. `diff = round(TOTAL_WEIGHTAGE - current_sum, 2)`
  8. `if other_count > 0: other_weights[-1] += diff`
  9. `elif stress_count > 0: stress_weights[-1] += diff`
  10. CRITICAL: If any weight is <= 0, redistribute to ensure all are > 0.
- GENERATION ORDER:
  1. Generate Examples first. Use `other_weights.pop(0)` for each example.
     - Tag each generated testcase with `testcase_type = "example"`.
  2. Generate Edge/Boundary Cases next. Use `other_weights.pop(0)` for each case.
     - Tag each generated testcase with `testcase_type = "edge"`.
  3. Generate Special/Corner Cases. Use `other_weights.pop(0)` for each case.
     - Tag each generated testcase with `testcase_type = "corner"`.
  4. Generate Normal/Typical Cases. Use `other_weights.pop(0)` for each case.
     - Tag each generated testcase with `testcase_type = "normal"`.
  5. Generate Performance/Stress Cases last. Use `stress_weights.pop(0)` for each case.
     - Tag each generated testcase with `testcase_type = "stress"`.
- MEANINGFUL SAMPLES:
  - Ensure generated inputs are not trivial (unless for example/edge cases).
  - Use random seeds or varying patterns to avoid identical inputs.
- KEY NAMES: Use EXACTLY `"weightage"` and `"order"`.
- ASSERTIONS: Include `assert all(w > 0 for w in weights)` and `assert abs(sum(weights) - TOTAL_WEIGHTAGE) < 0.01`.
"""
    
    user_prompt = f"""
### Problem Description:
{description}

### Optimal Python Solution:
{solution_code}
"""
    return system_prompt, user_prompt
