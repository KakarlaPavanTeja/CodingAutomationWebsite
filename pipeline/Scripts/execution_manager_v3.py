"""
execution_manager_v3.py — batch-submit + poll runner for the NEW compiler.
===========================================================================
Production runner for Python, C++, and Java.

Difference is ONLY the calling layer:

  execution_manager_v2  ->  N synchronous POSTs, one per testcase, to
                            nxt-compiler-dev-api.ccbp.in/{lang}
  this script           ->  ONE POST /compile with ALL testcases inline,
                            then GET /status/{request_id} until terminal,
                            against the new orchestrator
                            (https://nw-compiler.alpha.earlywave.in).

Everything else — loading Outputs/testcases.json, building driver+solution
files per language, node.h for C++, the emitted @@TCRESULT@@ sentinels and
the persisted execution_results.json — is reused verbatim from
execution_manager_v2 so the frontend parser keeps working unchanged.

Designed for VERY LARGE testcases sent all at once. Small IO stays inline as
plain text; inputs above the S3 threshold (same as execution_manager_v2,
default 50 KB) are uploaded and referenced via ``url`` on the input object
(legacy ``input_s3_url`` is normalized before submit).

Usage (same shape as execution_manager_v2):
    python execution_manager_v3.py                     # all supported langs, function-based
    python execution_manager_v3.py python              # single language
    python execution_manager_v3.py cpp java            # multiple languages
    python execution_manager_v3.py --nonfunction       # single-file (generatedFullCode)
    python execution_manager_v3.py --url http://localhost:8000   # local orchestrator
    python execution_manager_v3.py --dump-sample-s3-payload     # print example JSON
    python execution_manager_v3.py --quiet python               # minimal terminal output
    python execution_manager_v3.py --capture-api --inline-only python  # save request/response JSON

Env overrides:
    NEW_COMPILER_URL          base orchestrator URL
    NEW_COMPILER_POLL_SECS    poll interval (default 1.0)
    NEW_COMPILER_MAX_POLLS    max poll attempts (default 120)
    NEW_COMPILER_SUBMIT_TIMEOUT  submit POST timeout secs (default 60)
    NEW_COMPILER_S3_THRESHOLD_BYTES  input size above which S3 is used (default 51200)
    NEW_COMPILER_FORCE_S3_INPUTS     if true, upload every input to S3 (testing)
    NEW_COMPILER_FORCE_S3_OUTPUTS    if true, upload every expected output to S3 (testing)
    NEW_COMPILER_CAPTURE_API         if true, write request/response JSON to captures/
    NEW_COMPILER_INLINE_ONLY         if true, never use S3 (all inputs inline)
    NEW_COMPILER_CAPTURE_DIR         override capture output root directory
"""

import math
import os
import re
import sys
import time
import json
from datetime import datetime, timezone

import requests
from concurrent.futures import ThreadPoolExecutor

# Reuse execution_manager_v2's plumbing so output/format stays identical.
import execution_manager_v2 as emv
from execution_manager_v2 import (
    load_file,
    emit_language_results,
    write_execution_results_file,
    _print_language_results_table,
    _emit_lang_end,
    _print_table,
    _print_progress,
    _decode_output_contents,
    _extract_api_error_message,
    _get_node_h_from_payload,
    _get_node_h_from_file,
    _write_blob_and_get_s3_url,
    LARGE_IO_THRESHOLD_BYTES,
)
from project_env import load_execution_manager_env

# ---------------------------------------------------------------------------
# CONFIG — new orchestrator
# ---------------------------------------------------------------------------

NEW_COMPILER_URL = os.environ.get(
    "NEW_COMPILER_URL", "https://nw-compiler.alpha.earlywave.in"
).rstrip("/")
POLL_INTERVAL_SECONDS = float(os.environ.get("NEW_COMPILER_POLL_SECS", "1.0"))
MAX_POLL_ATTEMPTS = int(os.environ.get("NEW_COMPILER_MAX_POLLS", "120"))
SUBMIT_TIMEOUT_SECONDS = int(os.environ.get("NEW_COMPILER_SUBMIT_TIMEOUT", "60"))
POLL_TIMEOUT_SECONDS = int(os.environ.get("NEW_COMPILER_POLL_TIMEOUT", "30"))
# Tolerate transient network blips during polling before giving up on a run.
POLL_MAX_CONSECUTIVE_ERRORS = int(os.environ.get("NEW_COMPILER_POLL_MAX_ERRORS", "6"))

# Send code/IO as plain text (matches the new compiler's sample payload and
# keeps large payloads from inflating ~33% under base64). Flip if the API
# ever requires base64 file_contents.
BASE64_ENCODE_FILES = False
BASE64_ENCODE_IO = False

S3_INPUT_THRESHOLD_BYTES = int(
    os.environ.get("NEW_COMPILER_S3_THRESHOLD_BYTES", str(LARGE_IO_THRESHOLD_BYTES))
)
FORCE_S3_INPUTS = os.environ.get("NEW_COMPILER_FORCE_S3_INPUTS", "").lower() in (
    "1", "true", "yes"
)
FORCE_S3_OUTPUTS = os.environ.get("NEW_COMPILER_FORCE_S3_OUTPUTS", "").lower() in (
    "1", "true", "yes"
)
QUIET = False
# Languages run concurrently against the orchestrator (it queues submissions, so
# the wall clock is one language's, not the sum). Same shape editorial_execution_manager
# uses for its (approach, language) pairs. Set to 1 to go back to sequential.
LANG_PARALLELISM = int(os.environ.get("NEW_COMPILER_LANG_PARALLELISM", "5") or "5")
CAPTURE_API = False
INLINE_ONLY = False
LIMIT_TESTCASES = 0  # 0 = all
CAPTURE_DIR_ROOT = ""

# The new compiler supports only these three languages.
#   22 -> Python 3.9,  7 -> C++,  30 -> Java 11   (language id is a STRING)
# Function-based layout mirrors execution_manager_v2.LANG_CONFIG (CodeContentFiles).
LANG_CONFIG = {
    "C++": {
        "id": "7",
        "dir": "Cpp",
        "solution": "solution.cpp",
        "driver": "driver.cpp",
        "main_file": "main.cpp",
        "default_execution_time_limit": 5,
    },
    "Python": {
        "id": "22",
        "dir": "Python",
        "solution": "solution.py",
        "driver": "driver.py",
        "main_file": "main.py",
        "default_execution_time_limit": 5,
    },
    "Java": {
        "id": "30",
        "dir": "Java",
        "solution": "solution.java",
        "solution_file": "Solution.java",
        "driver": "driver.java",
        "main_file": "Main.java",
        "default_execution_time_limit": 5,
    },
}

NONFUNCTION_LANG_CONFIG = {
    "C++": {"id": "7", "file_name": "CPP.cpp", "main_file": "main.cpp", "default_execution_time_limit": 5},
    "Python": {"id": "22", "file_name": "PYTHON.py", "main_file": "main.py", "default_execution_time_limit": 5},
    "Java": {"id": "30", "file_name": "JAVA.java", "main_file": "Main.java", "default_execution_time_limit": 5},
}

_multi_target_languages = []

# Node.js stays on execution_manager_v2 (legacy per-testcase compiler API).
V2_ONLY_LANG_TOKENS = frozenset({"nodejs", "node"})


def _lang_token_is_v2_only(token):
    norm = (token or "").lower().replace(".", "").replace("+", "p")
    return norm in V2_ONLY_LANG_TOKENS


def _selected_lang_from_v3_tokens(tokens):
    """Map CLI language tokens to run_all_tests_batch selected_lang."""
    if len(tokens) == 1:
        return tokens[0]
    if len(tokens) > 1:
        filtered = []
        for req in tokens:
            for k in LANG_CONFIG.keys():
                norm = k.lower().replace(".", "").replace("+", "p")
                if k.lower() == req or norm == req:
                    if k not in filtered:
                        filtered.append(k)
        if filtered:
            global _multi_target_languages
            _multi_target_languages = filtered
            return "__multi__"
    return None


def _run_emv2_langs(lang_tokens, nonfunction, base_dir, persist_results=True):
    """Run Node.js (and only Node.js) via execution_manager_v2."""
    if len(lang_tokens) == 1:
        selected = lang_tokens[0]
    else:
        emv._multi_target_languages = ["Node.js"]
        selected = "__multi__"
    if nonfunction:
        return emv.run_all_tests_nonfunction(
            base_dir=base_dir, selected_lang=selected, persist_results=persist_results
        )
    return emv.run_all_tests_v2(
        base_dir=base_dir, selected_lang=selected, persist_results=persist_results
    )


# ---------------------------------------------------------------------------
# Payload builders (new-compiler format)
# ---------------------------------------------------------------------------

def _maybe_b64(text, encode):
    if not encode:
        return text or "", False
    import base64
    return base64.b64encode((text or "").encode("utf-8")).decode("utf-8"), True


def _build_files_payload(code_files):
    """code_files: list of (file_path, contents). Returns the new-compiler files[]."""
    files = []
    for file_path, contents in code_files:
        payload_contents, encoded = _maybe_b64(contents, BASE64_ENCODE_FILES)
        entry = {"file_path": file_path, "file_contents": payload_contents}
        if encoded:
            entry["base64_encoded"] = True
        files.append(entry)
    return files


def normalize_testcase_inputs(testcases):
    """Map legacy input_s3_url -> url for EC2 compiler compatibility."""
    for tc in testcases:
        for inp in tc.get("inputs", []):
            legacy_url = inp.pop("input_s3_url", None)
            if legacy_url and not inp.get("url"):
                inp["url"] = legacy_url
            if inp.get("url") and inp.get("contents") in ("", None):
                inp.pop("contents", None)
        for out in tc.get("outputs", []):
            legacy_url = out.pop("output_s3_url", None)
            if legacy_url and not out.get("url"):
                out["url"] = legacy_url
            if out.get("url") and out.get("contents") in ("", None):
                out.pop("contents", None)
    return testcases


def _build_input_object(base_dir, tc, question_id, question_name, order, input_text):
    """Inline plain text for small inputs; S3/HTTP url for large ones."""
    input_bytes = len((input_text or "").encode("utf-8"))
    input_s3_used = False
    s3_error = ""

    if not INLINE_ONLY and (FORCE_S3_INPUTS or input_bytes > S3_INPUT_THRESHOLD_BYTES):
        input_url, local_path, uploaded = _write_blob_and_get_s3_url(
            base_dir, question_id, question_name, order, "input", input_text
        )
        if uploaded:
            input_s3_used = True
            return {
                "input_type": "STDIN",
                "url": input_url,
                "base64_encoded": False,
            }, input_s3_used, s3_error
        s3_error = f"input upload failed: {local_path}"

    in_contents, in_b64 = _maybe_b64(input_text, BASE64_ENCODE_IO)
    return {
        "input_type": "STDIN",
        "contents": in_contents,
        "base64_encoded": in_b64,
    }, input_s3_used, s3_error


def _build_output_object(base_dir, tc, question_id, question_name, order, expected_text):
    """Inline plain text for small outputs; S3/HTTP url for large or forced ones."""
    output_bytes = len((expected_text or "").encode("utf-8"))
    output_s3_used = False
    s3_error = ""

    if not INLINE_ONLY and (FORCE_S3_OUTPUTS or output_bytes > S3_INPUT_THRESHOLD_BYTES):
        output_url, local_path, uploaded = _write_blob_and_get_s3_url(
            base_dir, question_id, question_name, order, "output", expected_text
        )
        if uploaded:
            output_s3_used = True
            output_obj = {
                "output_type": "STDOUT",
                "url": output_url,
                "multiple_possible_output": bool(tc.get("multiple_possible_output", False)),
                "base64_encoded": False,
            }
            if tc.get("multiple_possible_output"):
                outs = tc.get("outputs") or []
                output_obj["multiple_output_contents"] = [
                    _maybe_b64(str(o), BASE64_ENCODE_IO)[0] for o in outs
                ]
            return output_obj, output_s3_used, s3_error
        s3_error = f"output upload failed: {local_path}"

    out_contents, out_b64 = _maybe_b64(expected_text, BASE64_ENCODE_IO)
    output_obj = {
        "output_type": "STDOUT",
        "contents": out_contents,
        "multiple_possible_output": bool(tc.get("multiple_possible_output", False)),
        "base64_encoded": out_b64,
    }
    if tc.get("multiple_possible_output"):
        outs = tc.get("outputs") or []
        output_obj["multiple_output_contents"] = [
            _maybe_b64(str(o), BASE64_ENCODE_IO)[0] for o in outs
        ]
    return output_obj, output_s3_used, s3_error


def _build_testcases_payload(base_dir, testcases, question_id, question_name):
    """Build the full testcases[] array (ALL testcases, sent at once).

    Returns (payload_testcases, id_index) where id_index maps testcase_id ->
    metadata so batch results can be matched back.
    """
    payload_testcases = []
    id_index = {}
    s3_input_count = 0
    s3_output_count = 0
    for i, tc in enumerate(testcases):
        order = tc.get("order", i + 1)
        tc_id = str(tc.get("id") or f"tc-{i + 1}")
        input_text = tc.get("input", "") or ""
        expected_text = (tc.get("output") or "")

        input_obj, input_s3_used, input_s3_error = _build_input_object(
            base_dir, tc, question_id, question_name, order, input_text
        )
        output_obj, output_s3_used, output_s3_error = _build_output_object(
            base_dir, tc, question_id, question_name, order, expected_text
        )
        if input_s3_used:
            s3_input_count += 1
        if output_s3_used:
            s3_output_count += 1
        s3_error = "; ".join(filter(None, [input_s3_error, output_s3_error]))

        payload_testcases.append({
            "testcase_id": tc_id,
            "inputs": [input_obj],
            "outputs": [output_obj],
        })
        id_index[tc_id] = {
            "test_index": i + 1,
            "order": order,
            "input": input_text,
            "expected": expected_text.strip(),
            "input_s3_used": input_s3_used,
            "output_s3_used": output_s3_used,
            "s3_error": s3_error,
        }
    return payload_testcases, id_index, s3_input_count, s3_output_count



def build_sample_s3_compile_payload():
    """Example /compile body with one S3 input + one inline input for API testing."""
    inline_input = "3\n1 2 3\n"
    inline_output = "6\n"
    s3_input_url = (
        "http://new-assets.ccbp.in.s3.ap-south-1.amazonaws.com/"
        "testing-coding-question-test-cases/"
        "unknown_question_testcases_12_input.txt"
    )
    s3_output_url = (
        "http://new-assets.ccbp.in.s3.ap-south-1.amazonaws.com/"
        "testing-coding-question-test-cases/"
        "unknown_question_testcases_12_output.txt"
    )
    large_placeholder = "# large IO uploaded to S3; compiler fetches via url"
    return {
        "language": "22",
        "files": [{
            "file_path": "main.py",
            "file_contents": "import solution\n",
            "base64_encoded": False,
        }],
        "main_file_path": "main.py",
        "response_queue_url": "",
        "show_outputs": "ALL",
        "ignore_trailing_whitespaces": True,
        "request_type": "CODE_EVALUATION_WITH_IO_TESTCASES",
        "default_execution_time_limit": 5,
        "testcases": [
            {
                "testcase_id": "tc-inline-1",
                "inputs": [{
                    "input_type": "STDIN",
                    "contents": inline_input,
                    "base64_encoded": False,
                }],
                "outputs": [{
                    "output_type": "STDOUT",
                    "contents": inline_output,
                    "multiple_possible_output": False,
                    "base64_encoded": False,
                }],
            },
            {
                "testcase_id": "tc-s3-1",
                "inputs": [{
                    "input_type": "STDIN",
                    "url": s3_input_url,
                    "base64_encoded": False,
                }],
                "outputs": [{
                    "output_type": "STDOUT",
                    "url": s3_output_url,
                    "multiple_possible_output": False,
                    "base64_encoded": False,
                }],
            },
        ],
        "_note": large_placeholder,
    }


def dump_sample_s3_payload():
    payload = build_sample_s3_compile_payload()
    print(json.dumps(payload, indent=2))


def _default_capture_root():
    explicit = os.environ.get("NEW_COMPILER_CAPTURE_DIR", "").strip()
    if explicit:
        return explicit
    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(scripts_dir), "temp_compiler_sandbox", "captures")


def _new_capture_dir(lang):
    root = CAPTURE_DIR_ROOT or _default_capture_root()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_lang = re.sub(r"[^a-zA-Z0-9]+", "_", lang or "unknown")
    path = os.path.join(root, f"{stamp}_{safe_lang}")
    os.makedirs(path, exist_ok=True)
    return path


def _write_capture_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def _summarize_testcase_payload(tc):
    inputs = tc.get("inputs") or []
    outputs = tc.get("outputs") or []
    inp = inputs[0] if inputs else {}
    out = outputs[0] if outputs else {}
    in_contents = inp.get("contents")
    out_contents = out.get("contents")
    return {
        "testcase_id": tc.get("testcase_id"),
        "input_type": inp.get("input_type"),
        "base64_encoded": inp.get("base64_encoded"),
        "has_input_url": bool(inp.get("url")),
        "input_url": inp.get("url"),
        "input_contents_len": len(in_contents) if isinstance(in_contents, str) else 0,
        "input_contents_is_empty_string": in_contents == "",
        "input_contents_is_null": in_contents is None,
        "output_type": out.get("output_type"),
        "has_output_url": bool(out.get("url")),
        "output_url": out.get("url"),
        "output_contents_len": len(out_contents) if isinstance(out_contents, str) else 0,
        "output_contents_is_empty_string": out_contents == "",
        "output_contents_is_null": out_contents is None,
    }


def capture_api_exchange(capture_dir, compile_url, compile_payload, submit_resp,
                         status_data, submit_ms, lang, language_results):
    """Persist request/response artifacts for compiler debugging (no s3_blobs)."""
    os.makedirs(capture_dir, exist_ok=True)
    _write_capture_json(os.path.join(capture_dir, "compile_request.json"), compile_payload)
    _write_capture_json(
        os.path.join(capture_dir, "compile_testcases.json"),
        compile_payload.get("testcases") or [],
    )
    _write_capture_json(os.path.join(capture_dir, "submit_response.json"), submit_resp or {})
    _write_capture_json(os.path.join(capture_dir, "status_response.json"), status_data or {})

    testcase_summaries = [_summarize_testcase_payload(tc) for tc in (compile_payload.get("testcases") or [])]
    result_summaries = []
    for tr in language_results or []:
        result_summaries.append({
            "test_index": tr.get("test_index"),
            "order": tr.get("order"),
            "status": tr.get("status"),
            "passed": tr.get("passed"),
            "input_s3_used": tr.get("input_s3_used"),
            "error_head": (tr.get("error") or "")[:500],
            "stderr_head": (tr.get("stderr") or "")[:500],
        })

    manifest = {
        "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "compiler_url": compile_url,
        "language": lang,
        "request_id": (submit_resp or {}).get("request_id"),
        "submit_ms": submit_ms,
        "overall_status": (status_data or {}).get("status"),
        "inline_only": INLINE_ONLY,
        "testcase_payload_summaries": testcase_summaries,
        "result_summaries": result_summaries,
        "passed": sum(1 for tr in (language_results or []) if tr.get("passed")),
        "total": len(language_results or []),
    }
    _write_capture_json(os.path.join(capture_dir, "manifest.json"), manifest)
    if not QUIET:
        print(f"Captured API exchange -> {capture_dir}", flush=True)
    return capture_dir


# ---------------------------------------------------------------------------
# Submit + poll
# ---------------------------------------------------------------------------

def build_compile_payload(lang_id, main_file, files_payload, payload_testcases,
                        default_time_limit):
    return {
        "language": lang_id,
        "files": files_payload,
        "main_file_path": main_file,
        "response_queue_url": "",
        "show_outputs": "ALL",
        "ignore_trailing_whitespaces": True,
        "request_type": "CODE_EVALUATION_WITH_IO_TESTCASES",
        "default_execution_time_limit": default_time_limit,
        "testcases": normalize_testcase_inputs(payload_testcases),
    }


def submit_compile(base_url, compile_payload):
    url = f"{base_url}/compile"
    start = time.perf_counter()
    resp = requests.post(url, json=compile_payload, timeout=SUBMIT_TIMEOUT_SECONDS)
    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
    resp.raise_for_status()
    data = resp.json()
    return data, elapsed_ms, url


def poll_budget(time_limit: float, num_inputs: int) -> int:
    """Poll attempts to allow for a batch of `num_inputs` cases at `time_limit`s each.

    MAX_POLL_ATTEMPTS alone is a flat wall-clock cap (120 polls x 1s = 2 min),
    which a large suite legitimately exceeds — the run then returns TIMEOUT and
    every result is discarded even though execution would have succeeded. Scale
    with the batch's worst case and keep the flat value as the floor.
    """
    return max(
        MAX_POLL_ATTEMPTS,
        int(math.ceil(max(0.0, time_limit) * max(0, num_inputs) / POLL_INTERVAL_SECONDS)) + 30,
    )


def poll_status(base_url, request_id, max_attempts=None, label=""):
    url = f"{base_url}/status/{request_id}"
    attempts = max_attempts if max_attempts is not None else MAX_POLL_ATTEMPTS
    consecutive_errors = 0
    for attempt in range(1, attempts + 1):
        try:
            resp = requests.get(url, timeout=POLL_TIMEOUT_SECONDS)
            resp.raise_for_status()
            data = resp.json()
        except (requests.exceptions.RequestException, json.JSONDecodeError) as e:
            # A transient network blip (e.g. connection reset) during ONE poll
            # must not abort the whole run — retry a few times, then give up.
            consecutive_errors += 1
            if not QUIET:
                print(f"  {label}poll {attempt:>3}/{attempts} -> network error "
                      f"({consecutive_errors}/{POLL_MAX_CONSECUTIVE_ERRORS}): "
                      f"{type(e).__name__}", flush=True)
            if consecutive_errors >= POLL_MAX_CONSECUTIVE_ERRORS:
                return {"status": "ERROR", "response": {
                    "error": f"Polling failed after {consecutive_errors} "
                             f"consecutive network errors: {e}"}}
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        consecutive_errors = 0
        status = data.get("status", "UNKNOWN")
        if not QUIET:
            print(f"  {label}poll {attempt:>3}/{attempts} -> {status}", flush=True)
        if status in ("SUCCESS", "FAILED", "NOT_FOUND", "ERROR"):
            return data
        time.sleep(POLL_INTERVAL_SECONDS)
    return {"status": "TIMEOUT", "response": {}}


# ---------------------------------------------------------------------------
# Result mapping -> execution_manager_v2's test_res schema
# ---------------------------------------------------------------------------

def _blank_test_res(meta):
    return {
        "test_index": meta["test_index"],
        "order": meta["order"],
        "passed": False,
        "api_time": None,
        "memory_mb": None,
        "status": None,
        "error": None,
        "input_s3_used": bool(meta.get("input_s3_used")),
        "output_s3_used": bool(meta.get("output_s3_used")),
        "s3_error": meta.get("s3_error") or "",
        "input": meta["input"],
        "expected": meta["expected"],
        "got": "",
        "stderr": "",
    }


def _decode_result_outputs(result):
    """Best-effort STDOUT/STDERR extraction from a per-testcase result."""
    outputs = result.get("outputs") or []
    stdout_entry = next((o for o in outputs if o.get("output_type") == "STDOUT"), None)
    stderr_entry = next((o for o in outputs if o.get("output_type") == "STDERR"), None)
    got = _decode_output_contents(stdout_entry) if stdout_entry else (result.get("stdout") or "")
    stderr = _decode_output_contents(stderr_entry) if stderr_entry else (result.get("stderr") or "")
    return got, stderr


def build_language_results(status_data, id_index, ordered_ids):
    """Turn the polled batch response into an ordered list of test_res dicts."""
    body = status_data.get("response") or {}
    overall = status_data.get("status")

    results_by_id = {}
    for r in body.get("results", []) or []:
        rid = str(r.get("testcase_id") or r.get("test_case_id") or "")
        if rid:
            results_by_id[rid] = r

    # A submit/compile-level failure (e.g. compilation error) — attach to every tc.
    global_error = None
    if overall in ("FAILED", "ERROR", "TIMEOUT", "NOT_FOUND"):
        global_error = (
            body.get("error")
            or _extract_api_error_message(body)
            or f"Batch status: {overall}"
        )

    language_results = []
    passed_count = 0
    for tc_id in ordered_ids:
        meta = id_index[tc_id]
        test_res = _blank_test_res(meta)
        r = results_by_id.get(tc_id)

        if r is None:
            test_res["status"] = "NO_RESULT"
            test_res["error"] = global_error or "No result returned for this testcase"
        else:
            status = r.get("status")
            test_res["status"] = status
            test_res["api_time"] = r.get("execution_time")
            test_res["memory_mb"] = r.get("memory_consumed")
            got, stderr = _decode_result_outputs(r)
            test_res["got"] = got
            test_res["stderr"] = stderr
            if status == "CORRECT":
                test_res["passed"] = True
                passed_count += 1
            else:
                test_res["error"] = (
                    f"Expected: {meta['expected']}\n"
                    f"Actual:   {got.strip()}\n"
                    f"Stderr:   {stderr.strip()}"
                    + (f"\nStatus: {status}" if status else "")
                )
        language_results.append(test_res)
    return language_results, passed_count, global_error


# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------



def _resolve_question_meta(base_dir, question_payload, nonfunction):
    """Derive question id/name for S3 blob keys (fallback to problem folder)."""
    if nonfunction:
        question_id = question_payload.get("question_id") or question_payload.get("id")
        question_name = question_payload.get("question_name") or question_payload.get("name")
    else:
        question = question_payload.get("question") or {}
        question_id = question.get("question_id")
        question_name = question.get("question_name") or question.get("name")

    if not question_id or str(question_id).strip().lower() == "unknown":
        question_id = (
            os.environ.get("PIPELINE_PROBLEM_ID")
            or os.path.basename(os.path.normpath(base_dir))
        )
    if not question_name or str(question_name).strip().lower() == "unknown":
        titles_path = os.path.join(base_dir, "Outputs", "generated_titles.txt")
        try:
            with open(titles_path, "r", encoding="utf-8") as f:
                first = next((ln.strip() for ln in f if ln.strip()), "")
            if first:
                # Trailing "- 95%" only, matching
                # prepare_lua_and_testcases.get_problem_name() — splitting on
                # the first "-" truncated hyphenated titles.
                question_name = re.sub(
                    r"\s*-\s*\d+(?:\.\d+)?%\s*$", "", first.lstrip("- ")
                ).strip() or question_id
            else:
                question_name = question_id
        except OSError:
            question_name = question_id
    return str(question_id), str(question_name or question_id)


def _s3_credentials_available():
    try:
        import importlib
        boto3 = importlib.import_module("boto3")
        creds = boto3.Session(
            profile_name=os.environ.get("AWS_PROFILE") or None,
            region_name=os.environ.get("AWS_REGION", "ap-south-1"),
        ).get_credentials()
        return creds is not None and bool(getattr(creds, "access_key", None))
    except Exception:
        return False

def _load_testcases(base_dir, testcases_path=None):
    testcases_path = testcases_path or os.path.join(base_dir, "Outputs", "testcases.json")
    if not os.path.exists(testcases_path):
        print("Error: Outputs/testcases.json not found.")
        return None, None
    with open(testcases_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)
    question_payload = test_data[0] if isinstance(test_data, list) else test_data
    testcases = question_payload.get("test_cases") or question_payload.get("testcases", [])
    return question_payload, testcases


def _resolve_target_languages(config_keys, selected_lang):
    if selected_lang == "__multi__":
        return list(_multi_target_languages)
    if selected_lang:
        for k in config_keys:
            norm = k.lower().replace(".", "").replace("+", "p")
            if k.lower() == selected_lang or norm == selected_lang:
                return [k]
        print(f"\nWarning: Language \"{selected_lang}\" not supported. Running all supported.")
    return list(config_keys)


def _run_one_language(lang, code_files, main_file, lang_id, default_time_limit,
                      testcases, payload_testcases, id_index, quiet=False):
    """Submit + poll ONE language against an already-built testcase payload.

    The payload (and its S3 uploads) is language-independent, so the caller builds
    it once for the whole run and hands the same object to every language. Building
    it here re-uploaded every input and output blob once per language, to the exact
    same S3 keys — that duplicated upload WAS the gap between languages.
    """
    if not quiet:
        print(f"\n{'=' * 80}")
        print(f"TESTING {lang.upper()} - {len(testcases)} TEST CASES (BATCH SUBMIT + POLL)")
        print(f"{'=' * 80}")

    files_payload = _build_files_payload(code_files)
    ordered_ids = [t["testcase_id"] for t in payload_testcases]
    compile_payload = build_compile_payload(
        lang_id, main_file, files_payload, payload_testcases, default_time_limit
    )
    capture_dir = _new_capture_dir(lang) if CAPTURE_API else None

    if not quiet:
        total_bytes = len(json.dumps(payload_testcases).encode("utf-8"))
        print(f"[{lang}] Submitting {len(payload_testcases)} testcases in one request "
              f"(~{total_bytes / 1024:.1f} KB payload) to "
              f"{NEW_COMPILER_URL}/compile", flush=True)

    try:
        submit_resp, submit_ms, compile_url = submit_compile(
            NEW_COMPILER_URL, compile_payload
        )
    except requests.exceptions.RequestException as e:
        print(f"[{lang}] Submit failed: {e}", flush=True)
        language_results = []
        for tc_id in ordered_ids:
            tr = _blank_test_res(id_index[tc_id])
            tr["status"] = "API_ERROR"
            tr["error"] = f"Submit failed: {e}"
            language_results.append(tr)
        if capture_dir:
            capture_api_exchange(
                capture_dir, f"{NEW_COMPILER_URL}/compile", compile_payload,
                {"error": str(e)}, {"status": "SUBMIT_FAILED"}, 0, lang, language_results,
            )
        return language_results, 0, True

    request_id = submit_resp.get("request_id")
    if not quiet:
        print(f"[{lang}] Submitted in {submit_ms}ms, request_id={request_id}", flush=True)
    if not request_id:
        # Some deployments may return results inline on /compile.
        if submit_resp.get("results") or submit_resp.get("response"):
            status_data = submit_resp if "response" in submit_resp else {"status": "SUCCESS", "response": submit_resp}
        else:
            language_results = []
            for tc_id in ordered_ids:
                tr = _blank_test_res(id_index[tc_id])
                tr["status"] = "API_ERROR"
                tr["error"] = "No request_id in submit response"
                language_results.append(tr)
            return language_results, 0, True
    else:
        status_data = poll_status(
            NEW_COMPILER_URL,
            request_id,
            max_attempts=poll_budget(default_time_limit, len(ordered_ids)),
            label=f"[{lang}] ",
        )

    language_results, passed_count, global_error = build_language_results(
        status_data, id_index, ordered_ids
    )

    if capture_dir:
        capture_api_exchange(
            capture_dir, compile_url, compile_payload, submit_resp,
            status_data, submit_ms, lang, language_results,
        )

    return language_results, passed_count, bool(global_error)


def run_all_tests_batch(base_dir=None, testcases_path=None, selected_lang=None,
                        nonfunction=False, quiet=False, persist_results=True):
    base_dir = base_dir or os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    question_payload, testcases = _load_testcases(base_dir, testcases_path)
    if question_payload is None:
        return False, {}, []
    if not testcases:
        print("No test cases found.")
        return False, {}, []

    if nonfunction:
        config_map = NONFUNCTION_LANG_CONFIG
        generated_dir = os.path.join(base_dir, "Outputs", "generatedFullCode")
    else:
        config_map = LANG_CONFIG
    question_id, question_name = _resolve_question_meta(base_dir, question_payload, nonfunction)

    needs_s3 = (
        FORCE_S3_INPUTS
        or FORCE_S3_OUTPUTS
        or any(
            len((tc.get("input") or "").encode("utf-8")) > S3_INPUT_THRESHOLD_BYTES
            or len((tc.get("output") or "").encode("utf-8")) > S3_INPUT_THRESHOLD_BYTES
            for tc in testcases
        )
    )
    if needs_s3 and not _s3_credentials_available():
        msg = (
            "AWS credentials not found for S3 testcase uploads; "
            "large inputs will fall back to inline. "
            "Add pipeline/.env.execution_manager_v2 with AWS_ACCESS_KEY_ID / "
            "AWS_SECRET_ACCESS_KEY (or set AWS_PROFILE)."
        )
        if quiet:
            print(f"execution_manager_v3: warning: {msg}", flush=True)
        else:
            print(f"\n[warning] {msg}\n", flush=True)

    node_h_content = _get_node_h_from_payload(question_payload) or _get_node_h_from_file(base_dir)
    target_languages = _resolve_target_languages(list(config_map.keys()), selected_lang)
    if not quiet and (selected_lang == "__multi__" or (selected_lang and len(target_languages) == 1)):
        print(f"\nFiltered to run only: {', '.join(target_languages)}")

    # ONE upload pass for the whole run. Every language sends the identical
    # testcases[] array (same S3 keys, same inline bodies), so building it per
    # language just re-uploaded the same blobs N times.
    if LIMIT_TESTCASES and LIMIT_TESTCASES > 0:
        testcases = testcases[:LIMIT_TESTCASES]
    payload_testcases, id_index, s3_input_count, s3_output_count = _build_testcases_payload(
        base_dir, testcases, question_id, question_name
    )
    if not quiet:
        print(f"\nTestcase payload built once for all languages: "
              f"{s3_input_count} S3 input(s), {len(testcases) - s3_input_count} inline input(s); "
              f"{s3_output_count} S3 output(s), {len(testcases) - s3_output_count} inline output(s)",
              flush=True)

    jobs = []
    for lang in target_languages:
        config = config_map[lang]

        if nonfunction:
            code_path = os.path.join(generated_dir, config["file_name"])
            code_content = load_file(code_path)
            if not code_content:
                print(f"Warning: missing {config['file_name']}. Skipping.")
                continue
            code_files = [(config["main_file"], code_content)]
        else:
            content_dir = os.path.join(base_dir, "Outputs", "CodeContentFiles", config["dir"])
            solution_code = load_file(os.path.join(content_dir, config["solution"]))
            driver_code = load_file(os.path.join(content_dir, config["driver"]))
            if not solution_code or not driver_code:
                print(f"Warning: missing files for {lang}. Skipping.")
                continue
            solution_file_name = config.get("solution_file", config["solution"])
            code_files = [
                (config["main_file"], driver_code),
                (solution_file_name, solution_code),
            ]
            if lang == "C++" and node_h_content:
                code_files.append(("node.h", node_h_content))

        jobs.append((lang, config, code_files))

    # Languages run concurrently: each is one submit + poll against an orchestrator
    # that queues work anyway, so the wall clock becomes the slowest language rather
    # than their sum. Results are collected in target_languages order, so the report
    # and the printed tables stay byte-identical to the sequential version.
    all_results = {}
    workers = max(1, min(LANG_PARALLELISM, len(jobs)))
    if jobs and not quiet and workers > 1:
        print(f"\nRunning {len(jobs)} language(s) in parallel ({workers} worker(s))...",
              flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            lang: pool.submit(
                _run_one_language, lang, code_files, config["main_file"], config["id"],
                config.get("default_execution_time_limit", 5), testcases,
                payload_testcases, id_index, quiet,
            )
            for lang, config, code_files in jobs
        }
        for lang in [j[0] for j in jobs]:
            try:
                language_results, passed_count, halted = futures[lang].result()
            except Exception as e:
                # One language crashing (unexpected error) must not discard the
                # results already gathered for the others — record and continue.
                print(f"[{lang}] Unexpected error, skipping language: "
                      f"{type(e).__name__}: {e}", flush=True)
                language_results, passed_count, halted = [], 0, True

            all_results[lang] = language_results
            if not quiet:
                for tr in language_results:
                    _print_progress(
                        lang, tr["test_index"], len(testcases), tr["status"] or "UNKNOWN",
                        api_time=tr["api_time"], memory_mb=tr["memory_mb"],
                    )
                emit_language_results("execute_tests", "Reference Solution", 0, lang, language_results)
                _print_language_results_table(lang, language_results)
                print(f"{lang}: passed {passed_count}/{len(language_results)}")
                _emit_lang_end(lang, len(testcases), len(language_results), passed_count, halted)

    if persist_results:
        write_execution_results_file(
            base_dir, "execute_tests", question_id,
            [{"label": "Reference Solution", "index": 0, "results": all_results}],
            total_testcases=len(testcases),
        )

    all_passed = bool(all_results) and all(
        tests and all(t.get("passed") for t in tests) for tests in all_results.values()
    )
    return all_passed, all_results, testcases


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    load_execution_manager_env()
    argv = sys.argv[1:]

    if "--dump-sample-s3-payload" in argv:
        dump_sample_s3_payload()
        return

    nonfunction = "--nonfunction" in argv
    global QUIET
    QUIET = "--quiet" in argv or os.environ.get("NEW_COMPILER_QUIET", "").lower() in (
        "1", "true", "yes"
    )
    if QUIET:
        os.environ["SUPPRESS_S3_UPLOAD_LOGS"] = "1"

    global CAPTURE_API, INLINE_ONLY, LIMIT_TESTCASES, CAPTURE_DIR_ROOT
    CAPTURE_API = (
        "--capture-api" in argv
        or os.environ.get("NEW_COMPILER_CAPTURE_API", "").lower() in ("1", "true", "yes")
    )
    INLINE_ONLY = (
        "--inline-only" in argv
        or os.environ.get("NEW_COMPILER_INLINE_ONLY", "").lower() in ("1", "true", "yes")
    )
    if "--capture-dir" in argv:
        idx = argv.index("--capture-dir")
        if idx + 1 < len(argv):
            CAPTURE_DIR_ROOT = argv[idx + 1]
    elif os.environ.get("NEW_COMPILER_CAPTURE_DIR"):
        CAPTURE_DIR_ROOT = os.environ.get("NEW_COMPILER_CAPTURE_DIR", "")
    if "--limit-testcases" in argv:
        idx = argv.index("--limit-testcases")
        if idx + 1 < len(argv):
            try:
                LIMIT_TESTCASES = int(argv[idx + 1])
            except ValueError:
                LIMIT_TESTCASES = 0

    # --url <base> override
    base_url_override = None
    if "--url" in argv:
        idx = argv.index("--url")
        if idx + 1 < len(argv):
            base_url_override = argv[idx + 1]
    if base_url_override:
        global NEW_COMPILER_URL
        NEW_COMPILER_URL = base_url_override.rstrip("/")

    config_map = NONFUNCTION_LANG_CONFIG if nonfunction else LANG_CONFIG

    # positional language args (skip flags and the --url value)
    requested = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--url":
            i += 2
            continue
        if a == "--dump-sample-s3-payload":
            i += 1
            continue
        if a == "--quiet":
            i += 1
            continue
        if a == "--capture-api":
            i += 1
            continue
        if a == "--inline-only":
            i += 1
            continue
        if a == "--capture-dir":
            i += 2
            continue
        if a == "--limit-testcases":
            i += 2
            continue
        if a.startswith("--"):
            i += 1
            continue
        requested.append(a.lower())
        i += 1

    v2_tokens = [t for t in requested if _lang_token_is_v2_only(t)]
    v3_tokens = [t for t in requested if not _lang_token_is_v2_only(t)]
    selected_lang = _selected_lang_from_v3_tokens(v3_tokens) if v3_tokens else None

    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))

    if v2_tokens and not v3_tokens:
        if not QUIET:
            print("\n[execution_manager_v3] Node.js -> execution_manager_v2 (legacy compiler)")
        all_passed, all_results, testcases = _run_emv2_langs(
            v2_tokens, nonfunction, base_dir, persist_results=True,
        )
    elif v2_tokens and v3_tokens:
        if not QUIET:
            print("\n[execution_manager_v3] NEW compiler — batch submit + poll")
            print(f"  Orchestrator : {NEW_COMPILER_URL}")
            print("  Node.js will run via execution_manager_v2 after Python/C++/Java")
        all_results = {}
        all_passed = True
        testcases = []
        question_id = "unknown"
        if v3_tokens:
            p3, r3, tc3 = run_all_tests_batch(
                base_dir=base_dir, selected_lang=selected_lang, nonfunction=nonfunction,
                quiet=QUIET, persist_results=False,
            )
            all_results.update(r3)
            all_passed = all_passed and p3
            testcases = tc3
            if tc3:
                qp, _ = _load_testcases(base_dir)
                question_id, _ = _resolve_question_meta(base_dir, qp, nonfunction)
        p2, r2, tc2 = _run_emv2_langs(
            v2_tokens, nonfunction, base_dir, persist_results=False,
        )
        all_results.update(r2)
        all_passed = all_passed and p2
        if not testcases:
            testcases = tc2
        write_execution_results_file(
            base_dir, "execute_tests", question_id,
            [{"label": "Reference Solution", "index": 0, "results": all_results}],
            total_testcases=len(testcases) if testcases else None,
        )
    else:
        if not QUIET:
            print("\n[execution_manager_v3] NEW compiler — batch submit + poll")
            print(f"  Orchestrator : {NEW_COMPILER_URL}")
            print(f"  Poll         : every {POLL_INTERVAL_SECONDS}s, max {MAX_POLL_ATTEMPTS} attempts")
            print(f"  Mode         : {'nonfunction (single file)' if nonfunction else 'function (driver+solution)'}")
            print(f"  Encoding     : files_b64={BASE64_ENCODE_FILES}, io_b64={BASE64_ENCODE_IO}")
            print(f"  S3 inputs    : threshold={S3_INPUT_THRESHOLD_BYTES} B, force={FORCE_S3_INPUTS}")
            print(f"  S3 outputs   : threshold={S3_INPUT_THRESHOLD_BYTES} B, force={FORCE_S3_OUTPUTS}")

        all_passed, all_results, testcases = run_all_tests_batch(
            base_dir=base_dir, selected_lang=selected_lang, nonfunction=nonfunction,
            quiet=QUIET,
        )

    if not all_results:
        return

    if QUIET:
        parts = []
        for lang, tests in all_results.items():
            passed_count = len([t for t in tests if t.get("passed")])
            parts.append(f"{lang} {passed_count}/{len(tests)}")
        print(
            f"execution_manager_v3: {'; '.join(parts)}; "
            f"all_passed={all_passed}; wrote Outputs/execution_results.json",
            flush=True,
        )
        return

    print(f"\n{'=' * 80}")
    print("SUMMARY (execution_manager_v3 — batch)")
    print(f"{'=' * 80}")
    summary_rows = []
    for lang, tests in all_results.items():
        passed_count = len([t for t in tests if t.get("passed")])
        total_count = len(tests)
        rate = (passed_count / total_count) * 100 if total_count else 0
        summary_rows.append([lang, f"{passed_count}/{total_count}", f"{rate:.1f}%"])
    _print_table("Language Summary", ["Language", "Passed", "Pass Rate"], summary_rows)
    print(f"All passed: {all_passed}")
    print(f"Total testcases processed: {len(testcases)}")
    print("[EXEC_EVENT] run_end", flush=True)


if __name__ == "__main__":
    main()
