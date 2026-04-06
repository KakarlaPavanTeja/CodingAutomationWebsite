from __future__ import annotations

import json
import os
import sys
from datetime import datetime
import random

# Ensure the Scripts directory is in the path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.testcasesprompt import get_testcases_prompt
from llm_client import call_llm
from usage_tracker import update_usage


def _testcase_payload_byte_size(tc: dict) -> int:
    inp = tc.get("input", "") or ""
    out = tc.get("output", "") or ""
    if not isinstance(inp, str):
        inp = str(inp)
    if not isinstance(out, str):
        out = str(out)
    return len(inp.encode("utf-8")) + len(out.encode("utf-8"))


_TYPE_TAG_KEYS = ("testcase_type", "case_type", "category", "type")


def _normalize_case_type(value: str) -> str | None:
    token = (value or "").strip().lower().replace("-", "_").replace(" ", "_")
    alias_map = {
        "example": "example",
        "examples": "example",
        "edge": "edge",
        "edge_case": "edge",
        "edge_cases": "edge",
        "corner": "corner",
        "corner_case": "corner",
        "corner_cases": "corner",
        "special": "corner",
        "special_case": "corner",
        "special_cases": "corner",
        "normal": "normal",
        "typical": "normal",
        "normal_case": "normal",
        "normal_cases": "normal",
        "stress": "stress",
        "performance": "stress",
        "stress_case": "stress",
        "stress_cases": "stress",
        "performance_case": "stress",
        "performance_cases": "stress",
    }
    return alias_map.get(token)


def _extract_case_type(tc: dict) -> str | None:
    for key in _TYPE_TAG_KEYS:
        raw = tc.get(key)
        if isinstance(raw, str):
            normalized = _normalize_case_type(raw)
            if normalized:
                return normalized
    return None


def _remove_case_type_tags(tc: dict) -> None:
    for key in _TYPE_TAG_KEYS:
        tc.pop(key, None)


def reorder_testcases_by_payload_size(test_cases: list) -> tuple[list, bool]:
    """
    Reorder by explicit testcase type tags:
    keep example/edge/corner order as-is, merge normal+stress and sort by payload size.
    Returns (possibly new list reference, whether reorder was applied).
    """
    if not test_cases:
        return test_cases, False

    typed = []
    untyped = []
    for tc in test_cases:
        case_type = _extract_case_type(tc)
        if case_type is None:
            untyped.append(tc)
        else:
            typed.append((tc, case_type))

    if not typed:
        return test_cases, False

    examples = [tc for tc, ctype in typed if ctype == "example"]
    edge = [tc for tc, ctype in typed if ctype == "edge"]
    corner = [tc for tc, ctype in typed if ctype == "corner"]
    normal = [tc for tc, ctype in typed if ctype == "normal"]
    stress = [tc for tc, ctype in typed if ctype == "stress"]
    normal_stress = normal + stress
    normal_stress.sort(key=_testcase_payload_byte_size)

    # Keep untyped tail unchanged so we don't lose any generated cases.
    ordered = examples + edge + corner + normal_stress + untyped
    for idx, tc in enumerate(ordered, start=1):
        tc["order"] = idx
    test_cases[:] = ordered
    return test_cases, True


def _reorder_testcases_json_root(data) -> bool:
    """In-place reorder + remove temporary type tags. Returns whether reorder ran."""
    if isinstance(data, list) and data and isinstance(data[0], dict):
        if "test_cases" in data[0]:
            test_cases = data[0]["test_cases"]
            _, ok = reorder_testcases_by_payload_size(test_cases)
            for tc in test_cases:
                if isinstance(tc, dict):
                    _remove_case_type_tags(tc)
            return ok
    if isinstance(data, dict) and "test_cases" in data:
        test_cases = data["test_cases"]
        _, ok = reorder_testcases_by_payload_size(test_cases)
        for tc in test_cases:
            if isinstance(tc, dict):
                _remove_case_type_tags(tc)
        return ok
    return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate test cases")
    parser.add_argument("--count", type=int, default=None,
                        help="Number of test cases to generate (default: random 30-50)")
    args = parser.parse_args()

    description_path = os.path.join("Outputs", "generated_description.md")
    output_script_path = os.path.join("Outputs", "testcases_generator_script.py")

    # 1. Read Description
    if not os.path.exists(description_path):
        print(f"Error: {description_path} not found.")
        return
    
    with open(description_path, "r") as f:
        description = f.read()

    # 2. Read Solution
    python_solution_path = os.path.join("Outputs", "generatedFullCode", "PYTHON.py")
    if not os.path.exists(python_solution_path):
        print(f"Error: {python_solution_path} not found.")
        return

    with open(python_solution_path, "r") as f:
        python_solution = f.read()
    
    if not python_solution.strip():
        print("Error: No python_code found in generatedFullCode/PYTHON.py")
        return

    # 3. Read Difficulty
    difficulty_path = os.path.join("Outputs", "generated_difficulty.txt")
    total_score = 100 # Default
    if os.path.exists(difficulty_path):
        with open(difficulty_path, "r") as f:
            difficulty = f.read().strip().lower()
        
        difficulty_map = {
            "easy": 20,
            "medium": 25,
            "hard": 30
        }
        total_score = difficulty_map.get(difficulty, 100)
        print(f"Detected difficulty: {difficulty}. Setting total weightage to: {total_score}")
    else:
        print("Warning: generated_difficulty.txt not found. Using default total weightage: 100")

    # 4. Determine number of test cases
    if args.count is not None:
        num_testcases = args.count
        print(f"Using specified number of test cases: {num_testcases}")
    else:
        num_testcases = random.randint(30, 50)
        print(f"Using random number of test cases: {num_testcases}")

    # 5. Get Prompt
    system_prompt, user_prompt = get_testcases_prompt(description, python_solution, total_score, num_testcases)

    # 6. Call LLM
    print("Calling LLM to generate test case generator script...")
    try:
        content, usage = call_llm(system_prompt, user_prompt, purpose="testcases")
        print("LLM call completed.")
        
        # Remove markdown code blocks if present
        if content.startswith("```python"):
            content = content.replace("```python", "", 1)
        if content.endswith("```"):
            content = content.rsplit("```", 1)[0]
        content = content.strip()
        
        with open(output_script_path, "w") as f:
            f.write(content)

        print(f"Successfully saved test case generator script to: {output_script_path}")
        
        # 7. Update Usage Tracker
        update_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            "testcase_generation",
            model=usage.get("model", "unknown"),
            purpose="testcases",
            step_id="create_testcases",
        )

        # 6. Run the generated script
        print(f"Running {output_script_path}...")
        python_executable = os.path.join("venv", "bin", "python3")
        if not os.path.exists(python_executable):
            python_executable = "python3" # Fallback

        import subprocess
        try:
            result = subprocess.run([python_executable, output_script_path], capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            print("Error: Test case generator script timed out after 10 minutes.")
            sys.exit(1)

        if result.returncode != 0:
            first_error = result.stderr.strip()
            print(f"Error running generator script:\n{first_error}")
            print("\n--- Retrying: calling LLM to fix the generator script ---")

            # Read the failed script
            with open(output_script_path, "r") as f:
                failed_script = f.read()

            retry_system = (
                "You are a Python expert. The user gave you a test case generator script that failed. "
                "Fix the script so it runs without errors and produces the same output format. "
                "Return ONLY the corrected Python script, no explanations."
            )
            retry_user = (
                f"The following Python script failed with this error:\n\n"
                f"```\n{first_error[-2000:]}\n```\n\n"
                f"Here is the script:\n\n```python\n{failed_script}\n```\n\n"
                f"Fix the error and return the corrected script."
            )

            try:
                retry_content, retry_usage = call_llm(retry_system, retry_user, purpose="testcases_retry")
                print("LLM retry call completed.")

                if retry_content.startswith("```python"):
                    retry_content = retry_content.replace("```python", "", 1)
                if retry_content.endswith("```"):
                    retry_content = retry_content.rsplit("```", 1)[0]
                retry_content = retry_content.strip()

                with open(output_script_path, "w") as f:
                    f.write(retry_content)
                print(f"Saved fixed script to: {output_script_path}")

                # Track retry usage
                update_usage(
                    retry_usage.get("prompt_tokens", 0),
                    retry_usage.get("completion_tokens", 0),
                    "testcase_generation_retry",
                    model=retry_usage.get("model", "unknown"),
                    purpose="testcases",
                    step_id="create_testcases",
                )

                # Run the fixed script
                print(f"Running fixed {output_script_path}...")
                try:
                    result = subprocess.run([python_executable, output_script_path], capture_output=True, text=True, timeout=600)
                except subprocess.TimeoutExpired:
                    print("Error: Fixed script also timed out after 10 minutes.")
                    sys.exit(1)

                if result.returncode != 0:
                    print(f"Error: Fixed script also failed:\n{result.stderr}")
                    sys.exit(1)
            except Exception as retry_err:
                print(f"LLM retry failed: {retry_err}")
                sys.exit(1)

        # If we get here, the script succeeded
        print("Successfully generated testcases.json")
        out_path = os.path.join("Outputs", "testcases.json")
        if os.path.exists("testcases.json"):
            os.rename("testcases.json", out_path)
            print("Moved testcases.json to Outputs folder.")
        if os.path.exists(out_path):
            try:
                with open(out_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                did_reorder = _reorder_testcases_json_root(data)
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=4, ensure_ascii=False)
                if did_reorder:
                    print(
                        "Reordered normal+stress test cases by input+output size (ascending); "
                        "examples/edge/corner order unchanged."
                    )
            except Exception as e:
                print(f"Warning: could not reformat testcases.json: {e}")

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    # Change CWD to the project root if running from Scripts
    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root_dir)
    main()
