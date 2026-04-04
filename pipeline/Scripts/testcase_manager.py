from __future__ import annotations

import json
import os
import sys
from datetime import datetime
import random
import threading
import time

# Ensure the Scripts directory is in the path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.testcasesprompt import get_testcases_prompt
from llm_client import call_llm


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


def _llm_timer(stop_event: threading.Event, start_time: float) -> None:
    while not stop_event.is_set():
        elapsed = int(time.time() - start_time)
        sys.stdout.write(f"\rLLM call in progress... {elapsed}s elapsed")
        sys.stdout.flush()
        stop_event.wait(1)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate test cases")
    parser.add_argument("--count", type=int, default=None,
                        help="Number of test cases to generate (default: random 45-50)")
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
        num_testcases = random.randint(45, 50)
        print(f"Using random number of test cases: {num_testcases}")

    # 5. Get Prompt
    system_prompt, user_prompt = get_testcases_prompt(description, python_solution, total_score, num_testcases)

    # 6. Call LLM
    print("Calling LLM to generate test case generator script...")
    try:
        llm_start_time = time.time()
        stop_timer = threading.Event()
        timer_thread = threading.Thread(
            target=_llm_timer,
            args=(stop_timer, llm_start_time),
            daemon=True,
        )
        timer_thread.start()
        try:
            content, usage = call_llm(system_prompt, user_prompt, purpose="testcases")
        finally:
            stop_timer.set()
            timer_thread.join(timeout=2)
            total_elapsed = int(time.time() - llm_start_time)
            print(f"\rLLM call completed in {total_elapsed}s.{' ' * 20}")
        
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
        tracker_path = os.path.join("Outputs", "usage_tracker.json")
        if os.path.exists(tracker_path):
            try:
                with open(tracker_path, "r") as f:
                    tracker = json.load(f)
                
                prompt_tokens = usage.get("prompt_tokens", 0)
                completion_tokens = usage.get("completion_tokens", 0)
                total_tokens = usage.get("total_tokens", 0)
                
                # Prices: $1.25 / 1M prompt, $10.00 / 1M completion (GPT-5 pricing)
                cost = (prompt_tokens * 1.25 / 1_000_000) + (completion_tokens * 10.00 / 1_000_000)
                
                tracker["total_requests"] = tracker.get("total_requests", 0) + 1
                tracker["total_tokens"] = tracker.get("total_tokens", 0) + total_tokens
                tracker["total_cost_usd"] = tracker.get("total_cost_usd", 0.0) + cost
                tracker["prompt_tokens"] = tracker.get("prompt_tokens", 0) + prompt_tokens
                tracker["completion_tokens"] = tracker.get("completion_tokens", 0) + completion_tokens
                tracker["last_updated"] = datetime.now().isoformat()
                
                history_entry = {
                    "timestamp": datetime.now().isoformat(),
                    "problem_name": "testcase_generation",
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "cost_usd": cost
                }
                tracker.setdefault("history", []).append(history_entry)
                
                with open(tracker_path, "w") as f:
                    json.dump(tracker, f, indent=2)
                print(f"Usage tracked. Cost: ${cost:.6f}")
            except Exception as e:
                print(f"Error updating usage tracker: {e}")

        # 6. Run the generated script
        print(f"Running {output_script_path}...")
        python_executable = os.path.join("venv", "bin", "python3")
        if not os.path.exists(python_executable):
            python_executable = "python3" # Fallback
            
        import subprocess
        result = subprocess.run([python_executable, output_script_path], capture_output=True, text=True)
        
        if result.returncode == 0:
            print("Successfully generated testcases.json")
            # Move testcases.json to Outputs if it was generated in root
            out_path = os.path.join("Outputs", "testcases.json")
            if os.path.exists("testcases.json"):
                os.rename("testcases.json", out_path)
                print("Moved testcases.json to Outputs folder.")
            # Reformat JSON with indentation for readability
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
        else:
            print(f"Error running generator script: {result.stderr}")

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    # Change CWD to the project root if running from Scripts
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root_dir)
    main()
