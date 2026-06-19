"""
Editorial solution executor — the FINAL pipeline step (runs after
generate_editorial, for both function and non-function problems).

For EVERY approach described in Outputs/editorial.md, this script runs the
approach's code in each selected language (C++ / Python / Java / Node.js)
against the generated testcases (Outputs/testcases.json), using the same remote
compiler API as execution_manager_v2.

This step is PURELY INFORMATIONAL. Naive approaches are expected to time out or
otherwise fail — that is fine and useful to surface. This script must therefore
NEVER block the pipeline: every failure is recorded and the script always exits
0. Results are streamed as machine-parseable sentinel log lines (consumed by the
"Execution Logs" tab) and persisted to Outputs/editorial_execution_results.json.

Reuses helpers from execution_manager_v2 (same Scripts directory).
"""

import os
import re
import sys

from project_env import load_execution_manager_env

load_execution_manager_env()

from execution_manager_v2 import (
    LANG_CONFIG,
    NONFUNCTION_LANG_CONFIG,
    _build_files_payload,
    _decode_output_contents,
    _extract_api_error_message,
    _get_node_h_from_file,
    _get_node_h_from_payload,
    emit_tc_result,
    run_test_case_case2,
    run_test_case_nonfunction,
    write_execution_results_file,
)

import json

STEP = "execute_editorial"

# Map editorial fence tags -> LANG_CONFIG keys.
_FENCE_LANG = {
    "cpp": "C++",
    "c++": "C++",
    "python": "Python",
    "py": "Python",
    "java": "Java",
    "js": "Node.js",
    "javascript": "Node.js",
    "nodejs": "Node.js",
    "node": "Node.js",
}

# Stop running a (approach, language) after this many consecutive TLEs — naive
# approaches are expected to time out and running every testcase at the time
# limit would otherwise risk the overall pipeline timeout. Informational only.
_TLE_STOP_LIMIT = int(os.environ.get("EDITORIAL_EXEC_TLE_LIMIT", "3") or "3")

_MULTILANG_RE = re.compile(
    r"<MultiLanguageCodeBlock>(.*?)</MultiLanguageCodeBlock>", re.DOTALL
)
_FENCE_RE = re.compile(r"```([A-Za-z0-9+#]*)\s*\n(.*?)```", re.DOTALL)


# ---------------------------------------------------------------------------
# Editorial parsing
# ---------------------------------------------------------------------------

def _parse_editorial(md):
    """
    Return an ordered list of approaches:
      [{"index": int, "label": str, "code": {lang_key: source}}, ...]

    Each <MultiLanguageCodeBlock> is one approach; its label is the nearest
    preceding `##` heading (the "## Solution N: Name" line).
    """
    approaches = []
    for i, m in enumerate(_MULTILANG_RE.finditer(md)):
        block = m.group(1)
        # Nearest preceding H2 heading -> approach name.
        preceding = md[: m.start()]
        headings = re.findall(r"(?m)^##\s+(.+?)\s*$", preceding)
        label = headings[-1].strip() if headings else f"Solution {i + 1}"

        code = {}
        for fm in _FENCE_RE.finditer(block):
            tag = (fm.group(1) or "").strip().lower()
            lang = _FENCE_LANG.get(tag)
            if not lang:
                continue
            source = fm.group(2)
            if source.strip():
                code[lang] = source
        if code:
            approaches.append({"index": i, "label": label, "code": code})
    return approaches


# ---------------------------------------------------------------------------
# Code normalization (best-effort, never raises)
# ---------------------------------------------------------------------------

def _strip_top_level_block(code, header_pattern):
    """
    Remove a top-level `struct/class Node { ... }` (with optional trailing `;`)
    matched by header_pattern from the source. Brace-matched, best-effort.
    """
    m = re.search(header_pattern, code)
    if not m:
        return code
    brace_start = code.find("{", m.start())
    if brace_start == -1:
        return code
    depth = 0
    i = brace_start
    while i < len(code):
        c = code[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                # consume an optional trailing semicolon (C++/Java)
                while end < len(code) and code[end] in " \t":
                    end += 1
                if end < len(code) and code[end] == ";":
                    end += 1
                return code[: m.start()] + code[end:]
        i += 1
    return code


def _prepare_function_code(lang, code, driver, node_h):
    """
    Adapt an editorial fence so it can be sent as the `solution` file alongside
    the existing driver. Removes duplicate Node definitions when the driver /
    node.h already provides one. Best-effort.
    """
    try:
        if lang == "C++" and node_h:
            return _strip_top_level_block(code, r"\bstruct\s+Node\b|\bclass\s+Node\b")
        if lang == "Java" and driver and re.search(r"\bclass\s+Node\b", driver):
            return _strip_top_level_block(code, r"\bclass\s+Node\b")
        if lang == "Node.js" and driver and re.search(r"\bclass\s+Node\b", driver):
            return _strip_top_level_block(code, r"\bclass\s+Node\b")
    except Exception:
        return code
    return code


def _uncomment_main(lang, code):
    """
    Non-function mode: the editorial code ships with a fully commented-out
    main() driver. Uncomment the LAST comment block that contains the main entry
    so the full program runs standalone. Best-effort — returns code unchanged on
    any uncertainty.
    """
    try:
        if lang == "Python":
            # main wrapped in a trailing triple-quoted string ''' ... ''' or """ ... """
            for quote in ("'''", '"""'):
                idxs = [m.start() for m in re.finditer(re.escape(quote), code)]
                if len(idxs) >= 2:
                    open_i = idxs[-2]
                    close_i = idxs[-1]
                    inner = code[open_i + len(quote):close_i]
                    if re.search(r"input\s*\(|sys\.stdin", inner):
                        return code[:open_i] + inner + code[close_i + len(quote):]
            return code
        else:
            # cpp / java / js: main wrapped in a trailing /* ... */ block.
            opens = [m.start() for m in re.finditer(r"/\*", code)]
            for open_i in reversed(opens):
                close_i = code.find("*/", open_i + 2)
                if close_i == -1:
                    continue
                inner = code[open_i + 2:close_i]
                if re.search(r"\bmain\b|class\s+Main", inner):
                    return code[:open_i] + inner + code[close_i + 2:]
            return code
    except Exception:
        return code


# ---------------------------------------------------------------------------
# Result interpretation
# ---------------------------------------------------------------------------

def _interpret(result, expected_output):
    test_res = {
        "passed": False,
        "api_time": None,
        "memory_mb": None,
        "status": None,
        "error": None,
    }
    if not result:
        test_res["status"] = "API_ERROR"
        test_res["error"] = "API request failed"
        return test_res
    if result.get("_request_error"):
        test_res["status"] = "API_ERROR"
        test_res["error"] = f"API request failed: {result.get('_request_error')}"
        return test_res

    api_result = result.get("_api_response") or {}
    if api_result.get("is_compilation_error"):
        test_res["status"] = "COMPILATION_ERROR"
        msg = _extract_api_error_message(api_result)
        test_res["error"] = f"Compilation error: {msg}" if msg else "Compilation error"
        return test_res

    results_list = api_result.get("results") or []
    if not results_list:
        test_res["status"] = "NO_RESULTS"
        test_res["error"] = "No results returned"
        return test_res

    r0 = results_list[0]
    test_res["status"] = r0.get("status")
    test_res["api_time"] = r0.get("execution_time")
    test_res["memory_mb"] = r0.get("memory_consumed")

    output_entries = r0.get("outputs") or []
    stdout_entry = next((o for o in output_entries if o.get("output_type") == "STDOUT"), None)
    stderr_entry = next((o for o in output_entries if o.get("output_type") == "STDERR"), None)
    actual = _decode_output_contents(stdout_entry)
    stderr = _decode_output_contents(stderr_entry)

    if test_res["status"] == "CORRECT":
        test_res["passed"] = True
    else:
        msg = _extract_api_error_message(api_result)
        test_res["error"] = (
            f"Expected: {expected_output}\n"
            f"Actual:   {actual.strip()}\n"
            f"Stderr:   {stderr.strip()}"
            + (f"\nAPI error: {msg}" if msg else "")
        )
    return test_res


# ---------------------------------------------------------------------------
# Per (approach, language) execution
# ---------------------------------------------------------------------------

def _run_one(base_dir, mode, lang, config, prepared_code, driver, node_h,
             testcases, question_id, question_name, approach):
    """Run all testcases for a single (approach, language). Returns a list of
    test_res dicts; emits a sentinel line per testcase. Never raises."""
    label = approach["label"]
    index = approach["index"]
    language_results = []
    consecutive_tle = 0

    print(f"\n  [{label}] {lang}: running {len(testcases)} testcase(s)", flush=True)

    for i, tc in enumerate(testcases):
        order = tc.get("order", i + 1)
        expected_output = (tc.get("output") or "").strip()

        try:
            if mode == "function":
                files_payload = _build_files_payload(config, prepared_code, driver, node_h)
                result = run_test_case_case2(
                    base_dir=base_dir, config=config, files_payload=files_payload,
                    tc=tc, question_id=question_id, question_name=question_name, order=order,
                )
            else:
                result = run_test_case_nonfunction(
                    base_dir=base_dir, config=config, code_content=prepared_code,
                    tc=tc, question_id=question_id, question_name=question_name, order=order,
                )
            test_res = _interpret(result, expected_output)
        except Exception as exc:
            test_res = {
                "passed": False, "api_time": None, "memory_mb": None,
                "status": "ERROR", "error": f"Execution error: {exc}",
            }

        test_res["test_index"] = i + 1
        test_res["order"] = order
        language_results.append(test_res)
        emit_tc_result(STEP, label, index, lang, test_res)

        status = test_res.get("status")
        # Compilation errors recur for every testcase — record once and stop.
        if status == "COMPILATION_ERROR":
            print(f"    compilation error — skipping remaining testcases for {lang}", flush=True)
            break

        if status == "TIME_LIMIT_EXCEEDED":
            consecutive_tle += 1
            if _TLE_STOP_LIMIT > 0 and consecutive_tle >= _TLE_STOP_LIMIT:
                print(f"    {consecutive_tle} consecutive TLEs — stopping {lang} early "
                      f"(naive approach, informational)", flush=True)
                break
        else:
            consecutive_tle = 0

    passed = sum(1 for t in language_results if t.get("passed"))
    print(f"    {lang}: passed {passed}/{len(language_results)}", flush=True)
    return language_results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _selected_languages(argv, lang_keys):
    """Map positional language args to LANG_CONFIG keys; default to all."""
    requested = [a.lower() for a in argv if not a.startswith("--")]
    if not requested:
        return list(lang_keys)
    selected = []
    for req in requested:
        for k in lang_keys:
            norm = k.lower().replace(".", "").replace("+", "p")
            if k.lower() == req or norm == req:
                if k not in selected:
                    selected.append(k)
    return selected or list(lang_keys)


def _detect_mode(base_dir):
    """function if any driver exists (split_code ran), else nonfunction.
    PIPELINE_QUESTION_TYPE env takes precedence when set."""
    qtype = (os.environ.get("PIPELINE_QUESTION_TYPE") or "").strip().lower()
    if qtype == "nonfunction":
        return "nonfunction"
    if qtype == "function":
        return "function"
    content_dir = os.path.join(base_dir, "Outputs", "CodeContentFiles")
    for folder in ("Cpp", "Python", "Java", "NodeJS"):
        d = os.path.join(content_dir, folder)
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.startswith("driver."):
                    return "function"
    return "nonfunction"


def run():
    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    outputs_dir = os.path.join(base_dir, "Outputs")

    print("=" * 80)
    print("EDITORIAL SOLUTION EXECUTOR (informational — never blocks pipeline)")
    print("=" * 80)

    editorial_path = os.path.join(outputs_dir, "editorial.md")
    if not os.path.exists(editorial_path):
        print("Outputs/editorial.md not found — nothing to execute. Skipping.")
        return
    with open(editorial_path, "r", encoding="utf-8") as f:
        md = f.read()

    approaches = _parse_editorial(md)
    if not approaches:
        print("No runnable code blocks found in editorial.md — skipping.")
        return
    print(f"Found {len(approaches)} approach(es) in editorial.md.")

    testcases_path = os.path.join(outputs_dir, "testcases.json")
    if not os.path.exists(testcases_path):
        print("Outputs/testcases.json not found — nothing to run against. Skipping.")
        return
    with open(testcases_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)
    question_payload = test_data[0] if isinstance(test_data, list) else test_data
    testcases = question_payload.get("test_cases") or question_payload.get("testcases", [])
    if not testcases:
        print("No testcases found — skipping.")
        return

    mode = _detect_mode(base_dir)
    print(f"Detected mode: {mode}")

    lang_config = LANG_CONFIG if mode == "function" else NONFUNCTION_LANG_CONFIG
    target_languages = _selected_languages(sys.argv[1:], lang_config.keys())
    print(f"Languages: {', '.join(target_languages)}")
    print(f"Testcases: {len(testcases)}")

    if mode == "function":
        question = question_payload.get("question") or {}
        question_id = question.get("question_id", "unknown")
        question_name = question.get("short_text", "question")
        node_h_content = _get_node_h_from_payload(question_payload) or _get_node_h_from_file(base_dir)
    else:
        question_id = question_payload.get("question_id") or question_payload.get("id") or "unknown"
        question_name = question_payload.get("question_name") or question_payload.get("name") or "unknown"
        node_h_content = None

    # Preload per-language driver code for function mode.
    drivers = {}
    if mode == "function":
        for lang in target_languages:
            config = LANG_CONFIG[lang]
            driver_path = os.path.join(
                outputs_dir, "CodeContentFiles", config["dir"], config["driver"]
            )
            if os.path.exists(driver_path):
                try:
                    with open(driver_path, "r", encoding="utf-8") as f:
                        drivers[lang] = f.read()
                except Exception:
                    drivers[lang] = None

    solutions_out = []
    for approach in approaches:
        print(f"\n{'-' * 80}")
        print(f"APPROACH {approach['index'] + 1}: {approach['label']}")
        print(f"{'-' * 80}")
        results_by_lang = {}
        for lang in target_languages:
            code = approach["code"].get(lang)
            if not code:
                print(f"  [{approach['label']}] {lang}: no code block — skipping")
                continue
            config = lang_config[lang]

            if mode == "function":
                driver = drivers.get(lang)
                if not driver:
                    print(f"  [{approach['label']}] {lang}: no driver — skipping")
                    continue
                node_h = node_h_content if lang == "C++" else None
                prepared = _prepare_function_code(lang, code, driver, node_h)
            else:
                driver = None
                node_h = None
                prepared = _uncomment_main(lang, code)

            try:
                language_results = _run_one(
                    base_dir, mode, lang, config, prepared, driver, node_h,
                    testcases, question_id, question_name, approach,
                )
                results_by_lang[lang] = language_results
            except Exception as exc:
                print(f"  [{approach['label']}] {lang}: unexpected error: {exc}", flush=True)

        solutions_out.append({
            "label": approach["label"],
            "index": approach["index"],
            "results": results_by_lang,
        })

    write_execution_results_file(base_dir, STEP, question_id, solutions_out)

    print(f"\n{'=' * 80}")
    print("EDITORIAL EXECUTION SUMMARY")
    print(f"{'=' * 80}")
    for sol in solutions_out:
        for lang, tests in (sol["results"] or {}).items():
            passed = sum(1 for t in tests if t.get("passed"))
            print(f"  {sol['label']} | {lang}: {passed}/{len(tests)} passed")
    print("Done (informational step — pipeline not affected).")


def main():
    try:
        run()
    except Exception as exc:
        # Informational step: never propagate a non-zero exit to the pipeline.
        print(f"Editorial execution encountered an error (ignored): {exc}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
