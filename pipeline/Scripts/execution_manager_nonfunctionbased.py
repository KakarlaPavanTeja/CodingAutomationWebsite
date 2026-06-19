import os
import json
import base64
import requests
import re
import sys

# Configuration
API_BASE_URL = "https://nxt-compiler-dev-api.ccbp.in"

# Language Configuration
LANG_CONFIG = {
    "C++": {
        "id": 7,
        "endpoint": "cpp",
        "file_name": "CPP.cpp",
        "main_file": "main.cpp"
    },
    "Python": {
        "id": 23,
        "endpoint": "py310",
        "file_name": "PYTHON.py",
        "main_file": "main.py"
    },
    "Java": {
        "id": 30,
        "endpoint": "java11",
        "file_name": "JAVA.java",
        "main_file": "Main.java"
    },
    "Node.js": {
        "id": 4,
        "endpoint": "nodejs",
        "file_name": "NodeJS.js",
        "main_file": "Main.js"
    }
}

def run_test_case(config, code_content, test_input):
    """Executes a single test case via the API."""
    url = f"{API_BASE_URL}/{config['endpoint']}"
    
    input_stringified = json.dumps([str(test_input)])
    code_b64 = base64.b64encode(code_content.encode("utf-8")).decode("utf-8")
    
    payload = {
        "language": config["id"],
        "code": code_content,
        "stdin": input_stringified,
        "extra_files": [
            {
                "file_path": config["main_file"],
                "file_contents": code_b64,
                "base64_encoded": True
            }
        ],
        "main_file_path": config["main_file"],
        "code_file_path": config["main_file"]
    }

    headers = {
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        if response.status_code == 413:
            return {"error": "PAYLOAD_TOO_LARGE", "message": "Request Entity Too Large (Input data exceeds API limits)"}
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"  API Request Failed: {e}")
        return None
    except json.JSONDecodeError:
        print(f"  Failed to decode JSON response: {response.text}")
        return None

def main():
    # 0. Selection
    target_languages = list(LANG_CONFIG.keys())
    if len(sys.argv) > 1:
        requested_langs = [arg.lower() for arg in sys.argv[1:]]
        filtered_langs = []
        for requested in requested_langs:
            for k in LANG_CONFIG.keys():
                if k.lower() == requested or k.lower().replace(".", "").replace("+", "p") == requested:
                    if k not in filtered_langs:
                        filtered_langs.append(k)
        if filtered_langs:
            target_languages = filtered_langs
            print(f"\nFiltered to run only: {', '.join(target_languages)}")
        else:
            print(f"\n⚠️ Warning: No recognized languages found in arguments. Running all.")

    # 1. Load Test Cases
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    testcases_path = os.path.join(base_dir, "Outputs", "testcases.json")
    
    if not os.path.exists(testcases_path):
        print("Error: Outputs/testcases.json not found.")
        return

    with open(testcases_path, "r") as f:
        try:
            test_data = json.load(f)
            if isinstance(test_data, list):
                testcases = test_data[0].get("test_cases") or test_data[0].get("testcases", [])
            else:
                testcases = test_data.get("test_cases") or test_data.get("testcases", [])
        except json.JSONDecodeError as e:
            print(f"Error parsing testcases.json: {e}")
            return

    if not testcases:
        print("No test cases found.")
        return

    # 2. Verify Generated Solutions Folder
    generated_full_code_dir = os.path.join(base_dir, "Outputs", "generatedFullCode")
    if not os.path.exists(generated_full_code_dir):
        print("Error: Outputs/generatedFullCode directory not found.")
        return

    # 3. Iterate Languages
    all_results = {}

    for lang in target_languages:
        config = LANG_CONFIG[lang]
        print(f"\n{'='*80}")
        print(f"TESTING {lang.upper()} - {len(testcases)} TEST CASES")
        print(f"{'='*80}")

        global_error_occurred = False
        
        # Load Code
        language_results = []
        code_file_path = os.path.join(generated_full_code_dir, config["file_name"])

        if not os.path.exists(code_file_path):
            print(f"⚠️ Warning: Missing '{config['file_name']}' in generatedFullCode. Skipping...")
            continue
            
        with open(code_file_path, "r") as f:
            code_content = f.read()

        if not code_content.strip():
            print(f"⚠️ Warning: '{config['file_name']}' is empty. Skipping...")
            continue

        # 4. Run Test Cases
        passed_count = 0
        
        for i, tc in enumerate(testcases):
            input_val = tc.get("input", "")
            expected_output = tc.get("output", "").strip()
            order = tc.get("order", i + 1)
            
            print(f"Solution 1 - Test {i+1}/{len(testcases)}: ", end="", flush=True)
            
            result = run_test_case(config, code_content, input_val)
            
            test_res = {
                "test_index": i + 1,
                "passed": False,
                "api_time": None,
                "error": None
            }

            if not result:
                test_res["error"] = "API Request Failed"
                print("❌ FAILED - API ERROR")
                language_results.append(test_res)
                continue

            if isinstance(result, dict) and result.get("error") == "PAYLOAD_TOO_LARGE":
                test_res["error"] = "PAYLOAD TOO LARGE"
                print("❌ FAILED - PAYLOAD TOO LARGE")
                language_results.append(test_res)
                continue

            if result.get("is_compilation_error"):
                test_res["error"] = "COMPILATION ERROR"
                print(f"❌ FAILED - COMPILATION ERROR\nDETAILS:\n{json.dumps(result, indent=2)}")
                language_results.append(test_res)
                global_error_occurred = True
                break

            results_list = result.get("results", [])
            if not results_list:
                test_res["error"] = "No results returned from API"
                print("❌ FAILED - NO RESULTS")
                language_results.append(test_res)
                continue
            
            run_output = results_list[0]
            actual_output = run_output.get("output", "").strip()
            runtime_error = run_output.get("errors", "")
            test_res["api_time"] = run_output.get("time")

            final_output = actual_output.strip()
            
            if runtime_error and actual_output.strip() != expected_output:
                # Some API returns warnings in errors. If output matches and it's just a warning, let's pass it.
                if "warning:" in runtime_error.lower() and final_output == expected_output:
                    test_res["passed"] = True
                    passed_count += 1
                    api_str = f"{test_res['api_time']:.7f} s" if test_res['api_time'] is not None else "N/A"
                    print(f"✅ PASSED (API: {api_str}) [Warning Ignored]")
                else:
                    test_res["error"] = f"RUNTIME ERROR: {runtime_error}"
                    api_str = f"{test_res['api_time']:.7f} s" if test_res['api_time'] is not None else "N/A"
                    print(f"❌ FAILED (API: {api_str})")
                    print(f"\n{'-'*40}")
                    print(f"ERROR IN {lang.upper()} TEST {i+1} (Order: {order}):")
                    print(f"INPUT:\n{input_val}")
                    print(f"\nDETAILS:\n{runtime_error}")
                    print(f"OUTPUT:\n{actual_output}")
                    print(f"{'-'*40}")
                    global_error_occurred = True
                    break
            elif final_output == expected_output:
                test_res["passed"] = True
                passed_count += 1
                api_str = f"{test_res['api_time']:.7f} s" if test_res['api_time'] is not None else "N/A"
                print(f"✅ PASSED (API: {api_str})")
            else:
                test_res["error"] = f"Mismatch.\nExpected: \"{expected_output}\"\nActual:   \"{final_output}\""
                api_str = f"{test_res['api_time']:.7f} s" if test_res['api_time'] is not None else "N/A"
                print(f"❌ FAILED (API: {api_str})")
                print(f"\n{'-'*40}")
                print(f"ERROR IN {lang.upper()} TEST {i+1} (Order: {order}):")
                print(f"INPUT:\n{input_val}")
                print(f"\nDETAILS:\n{test_res['error']}")
                print(f"{'-'*40}")
            
            language_results.append(test_res)

        all_results[lang] = language_results

        # Additive, machine-readable end-of-language marker for the UI parser.
        if global_error_occurred:
            _outcome = "halted"
        elif passed_count < len(language_results) or len(language_results) < len(testcases):
            _outcome = "failed"
        else:
            _outcome = "passed"
        print(
            f"[EXEC_EVENT] lang_end name={lang} total={len(testcases)} "
            f"processed={len(language_results)} passed={passed_count} outcome={_outcome}",
            flush=True,
        )

        if global_error_occurred:
            print(f"\n🚨 Halting execution for all remaining languages due to error in {lang.upper()}.")
            print(f"[EXEC_EVENT] run_halted after={lang}", flush=True)
            break

    # 5. Final Summary
    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")

    for lang, tests in all_results.items():
        passed = [t for t in tests if t["passed"]]
        passed_count = len(passed)
        total_count = len(tests)
        pass_rate = (passed_count/total_count)*100 if total_count > 0 else 0
        
        print(f"\n{lang.upper()}:")
        print(f"  Solution 1:")
        print(f"    Passed: {passed_count}/{total_count} ({pass_rate:.1f}%)")
        
        if passed:
            a_times = [t["api_time"] for t in passed if t["api_time"] is not None]
            if a_times:
                print(f"    API Time    - Max: {max(a_times):.3f} s, Avg: {(sum(a_times)/len(a_times)):.3f} s")
        
        failed = [t for t in tests if not t["passed"]]
        if failed:
            indices = [str(t["test_index"]) for t in failed]
            print(f"    Failed tests: {', '.join(indices)}")
    
    print(f"\n{'='*80}")

    # 6. Generate Summary Report
    generate_summary_report(all_results, testcases)
    print("[EXEC_EVENT] run_end", flush=True)

def generate_summary_report(results, testcases):
    """Generates a markdown summary report."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    report_path = os.path.join(base_dir, "Outputs", "test_report_nonfunctionbased.md")
    
    with open(report_path, "w") as f:
        f.write("# Non-Function Based Test Summary Report\n\n")
        f.write(f"**Total Test Cases:** {len(testcases)}\n\n")
        
        for lang, tests in results.items():
            passed = [t for t in tests if t["passed"]]
            passed_count = len(passed)
            total_count = len(tests)
            
            f.write(f"## {lang}\n")
            f.write(f"- **Passed:** {passed_count}/{total_count}\n")
            
            if passed:
                api_times = [t["api_time"] for t in passed if t["api_time"] is not None]
                if api_times:
                    f.write(f"- **Max API Time:** {max(api_times):.7f} s\n")
            
            failed = [t for t in tests if not t["passed"]]
            if failed:
                indices = [str(t["test_index"]) for t in failed]
                f.write(f"- **Failed Test Cases:** {', '.join(indices)}\n")
            
            f.write("\n---\n\n")
            
    print(f"\n📄 Summary report generated: {report_path}")

if __name__ == "__main__":
    main()
