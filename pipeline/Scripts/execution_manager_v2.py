import os
import json
import base64
import mimetypes
import re
import sys
import uuid

import requests

from project_env import load_execution_manager_env

load_execution_manager_env()

_multi_target_languages = []

API_BASE_URL = "https://nxt-compiler-dev-api.ccbp.in"

S3_BUCKET = os.environ.get("S3_BUCKET", "new-assets.ccbp.in")
S3_PREFIX = "testing-coding-question-test-cases/"
AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")
AWS_PROFILE = os.environ.get("AWS_PROFILE")

UPLOAD_MODE = os.environ.get("EXEC_V2_UPLOAD_MODE", "proxy").strip().lower()  # proxy | s3
UPLOAD_SERVICE_URL = os.environ.get("EXEC_V2_UPLOAD_SERVICE_URL", "").strip()
UPLOAD_SERVICE_TOKEN = os.environ.get("EXEC_V2_UPLOAD_SERVICE_TOKEN", "").strip()
ENABLE_OUTPUT_S3 = os.environ.get("EXEC_V2_ENABLE_OUTPUT_S3", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

LARGE_IO_THRESHOLD_BYTES = 10 * 1024

LANG_CONFIG = {
    "C++": {
        "id": 7,
        "endpoint": "cpp",
        "dir": "Cpp",
        "solution": "solution.cpp",
        "driver": "driver.cpp",
        "main_file": "main.cpp",
        "default_execution_time_limit": 1.0,
    },
    "Python": {
        "id": 23,
        "endpoint": "py310",
        "dir": "Python",
        "solution": "solution.py",
        "driver": "driver.py",
        "main_file": "main.py",
        "default_execution_time_limit": 4.0,
    },
    "Java": {
        "id": 30,
        "endpoint": "java11",
        "dir": "Java",
        "solution": "solution.java",
        "driver": "driver.java",
        "main_file": "Main.java",
        "solution_file": "Solution.java",
        "default_execution_time_limit": 2.0,
    },
    "Node.js": {
        "id": 4,
        "endpoint": "nodejs",
        "dir": "NodeJS",
        "solution": "solution.js",
        "driver": "driver.js",
        "main_file": "Main.js",
        "solution_file": "Solution.js",
        "default_execution_time_limit": 2.0,
    },
}

NONFUNCTION_LANG_CONFIG = {
    "C++": {
        "id": 7,
        "endpoint": "cpp",
        "file_name": "CPP.cpp",
        "main_file": "main.cpp",
        "default_execution_time_limit": 1.0,
    },
    "Python": {
        "id": 23,
        "endpoint": "py310",
        "file_name": "PYTHON.py",
        "main_file": "main.py",
        "default_execution_time_limit": 4.0,
    },
    "Java": {
        "id": 30,
        "endpoint": "java11",
        "file_name": "JAVA.java",
        "main_file": "Main.java",
        "default_execution_time_limit": 2.0,
    },
    "Node.js": {
        "id": 4,
        "endpoint": "nodejs",
        "file_name": "NodeJS.js",
        "main_file": "Main.js",
        "default_execution_time_limit": 2.0,
    },
}

_S3_CLIENT = None
_UPLOAD_CONFIG_WARNING_PRINTED = False


def _short_path(path, base_dir):
    if not path or not base_dir:
        return path
    path = os.path.normpath(os.path.abspath(path))
    root = os.path.normpath(os.path.abspath(base_dir))
    if path == root or path.startswith(root + os.sep):
        return path[len(root):].lstrip(os.sep)
    return os.path.basename(path)


def _slugify(value):
    s = (value or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "question"


def _s3_virtual_hosted_public_url(key: str) -> str:
    key = (key or "").lstrip("/")
    return f"http://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}"


def _get_s3_client():
    global _S3_CLIENT
    if _S3_CLIENT is not None:
        return _S3_CLIENT
    try:
        import importlib

        boto3 = importlib.import_module("boto3")
    except ImportError as e:
        raise RuntimeError("boto3 is not installed. Run: pip install boto3") from e
    if AWS_PROFILE:
        session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    else:
        session = boto3.Session(region_name=AWS_REGION)
    _S3_CLIENT = session.client("s3")
    return _S3_CLIENT


def _upload_blob_to_s3(local_path, object_name):
    key = f"{S3_PREFIX}{object_name}"
    content_type, _ = mimetypes.guess_type(local_path)
    extra_args = {"ContentType": content_type or "text/plain; charset=utf-8"}
    try:
        client = _get_s3_client()
        client.upload_file(local_path, S3_BUCKET, key, ExtraArgs=extra_args)
        return True, _s3_virtual_hosted_public_url(key)
    except Exception as e:
        return False, str(e)


def _upload_blob_via_service(local_path, object_name):
    if not UPLOAD_SERVICE_URL:
        return False, "EXEC_V2_UPLOAD_SERVICE_URL is not set"
    url = f"{UPLOAD_SERVICE_URL.rstrip('/')}/upload"
    headers = {}
    if UPLOAD_SERVICE_TOKEN:
        headers["Authorization"] = f"Bearer {UPLOAD_SERVICE_TOKEN}"
    try:
        with open(local_path, "rb") as f:
            files = {"file": (object_name, f, "text/plain")}
            data = {"object_name": object_name}
            resp = requests.post(url, files=files, data=data, headers=headers, timeout=30)
        resp.raise_for_status()
        body = resp.json()
        key = (body.get("key") or "").strip()
        public_url = body.get("public_url")
        if key:
            return True, _s3_virtual_hosted_public_url(key)
        if not public_url:
            return False, f"Invalid response from upload service: {body}"
        return True, public_url
    except Exception as e:
        return False, str(e)


def _write_blob_and_get_s3_url(base_dir, question_id, question_name, order, io_kind, contents):
    qid = (question_id or "unknown").strip()
    qname = _slugify(question_name)
    filename = f"{qid}_{qname}_testcases_{order}_{io_kind}.txt"

    blobs_dir = os.path.join(base_dir, "Outputs", "s3_blobs")
    os.makedirs(blobs_dir, exist_ok=True)
    local_path = os.path.join(blobs_dir, filename)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(contents or "")

    if UPLOAD_MODE == "proxy":
        uploaded, info = _upload_blob_via_service(local_path, filename)
    else:
        uploaded, info = _upload_blob_to_s3(local_path, filename)
    if uploaded:
        return info, local_path, True
    print(f"  S3 upload error for {filename}: {info}", flush=True)
    return "", local_path, False


def _print_runtime_config(base_dir):
    env_candidates = (
        ".env.execution_manager_v2.example",
        ".env.execution_manager_v2",
        ".env",
    )
    found_env_files = [name for name in env_candidates if os.path.exists(os.path.join(base_dir, name))]
    print("\n[execution_manager_v2 config]")
    print(f"  Upload mode: {UPLOAD_MODE}")
    if UPLOAD_MODE == "proxy":
        print(f"  Upload service URL set: {'yes' if bool(UPLOAD_SERVICE_URL) else 'no'}")
    else:
        print(f"  AWS region: {AWS_REGION}")
        print(f"  S3 bucket: {S3_BUCKET}")
    print(f"  Output S3 enabled: {'yes' if ENABLE_OUTPUT_S3 else 'no'}")
    if found_env_files:
        print(f"  Env files found: {', '.join(found_env_files)}")
    else:
        print("  Env files found: none")
        print("  Note: create .env.execution_manager_v2 for local overrides.")


def _warn_if_upload_env_incomplete():
    global _UPLOAD_CONFIG_WARNING_PRINTED
    if _UPLOAD_CONFIG_WARNING_PRINTED:
        return

    if UPLOAD_MODE == "proxy" and not UPLOAD_SERVICE_URL:
        print(
            "\n[config warning] EXEC_V2_UPLOAD_MODE=proxy but EXEC_V2_UPLOAD_SERVICE_URL is not set.\n"
            "Large testcase inputs will fall back to inline base64 (no input_s3_url).\n"
            "Set EXEC_V2_UPLOAD_SERVICE_URL in .env.execution_manager_v2 or shell env."
        )
        _UPLOAD_CONFIG_WARNING_PRINTED = True
        return

    if UPLOAD_MODE == "s3" and not S3_BUCKET:
        print(
            "\n[config warning] EXEC_V2_UPLOAD_MODE=s3 but S3_BUCKET is empty.\n"
            "Large testcase inputs will fall back to inline base64 (no input_s3_url)."
        )
        _UPLOAD_CONFIG_WARNING_PRINTED = True


def _safe_text(value, max_len=80):
    text = str(value) if value is not None else ""
    text = text.replace("\n", " ").strip()
    if len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text


def _format_seconds(value):
    return f"{value:.6f}s" if isinstance(value, (int, float)) else "N/A"


def _format_memory_mb(value):
    return f"{value:.2f}MB" if isinstance(value, (int, float)) else "N/A"


def _print_table(title, headers, rows):
    print(f"\n{title}")
    if not rows:
        print("  (no rows)")
        return
    widths = []
    for i, header in enumerate(headers):
        max_cell = max(len(_safe_text(row[i])) for row in rows)
        widths.append(max(len(header), max_cell))
    sep = "+-" + "-+-".join("-" * w for w in widths) + "-+"
    header_row = "| " + " | ".join(headers[i].ljust(widths[i]) for i in range(len(headers))) + " |"
    print(sep)
    print(header_row)
    print(sep)
    for row in rows:
        print("| " + " | ".join(_safe_text(row[i]).ljust(widths[i]) for i in range(len(headers))) + " |")
    print(sep)


def _print_language_results_table(lang, language_results):
    headers = ["Test", "Status", "Pass", "API Time", "Memory"]
    rows = [
        [
            t.get("test_index"),
            t.get("status") or "API_ERROR",
            "Yes" if t.get("passed") else "No",
            _format_seconds(t.get("api_time")),
            _format_memory_mb(t.get("memory_mb")),
        ]
        for t in language_results
    ]
    _print_table(f"{lang} - Execution Details", headers, rows)


def _print_progress(
    lang,
    index,
    total,
    status,
    api_time=None,
    memory_mb=None,
    input_s3_used=False,
    output_s3_used=False,
    s3_error="",
    error_details="",
):
    parts = [
        f"[{lang}] Progress {index}/{total} - {status}",
        f"time={_format_seconds(api_time)}",
        f"memory={_format_memory_mb(memory_mb)}",
        f"input_s3={'yes' if input_s3_used else 'no'}",
        f"output_s3={'yes' if output_s3_used else 'no'}",
    ]
    if s3_error:
        parts.append(f"s3_error={_safe_text(s3_error, 140)}")
    if error_details:
        parts.append(f"error={_safe_text(error_details, 180)}")
    print(" | ".join(parts), flush=True)


def _print_error_table(all_results):
    headers = ["Language", "Test", "Order", "Status", "Error"]
    rows = []
    for lang, tests in all_results.items():
        for t in tests:
            if t.get("error"):
                rows.append(
                    [
                        lang,
                        t.get("test_index"),
                        t.get("order"),
                        t.get("status") or "API_ERROR",
                        _safe_text(t.get("error"), max_len=140),
                    ]
                )
    _print_table("Errors (if any)", headers, rows)


def _write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)


def load_file(path):
    if not os.path.exists(path):
        base = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        print(f"Error: File not found: {_short_path(path, base)}")
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _get_node_h_from_payload(question_payload):
    if not question_payload:
        return None
    repo_details = question_payload.get("language_code_repository_details") or []
    cpp_repo = next((r for r in repo_details if (r.get("language") or "").upper() == "CPP"), None)
    if not cpp_repo:
        return None
    code_repo = cpp_repo.get("code_repository") or []
    node_file = next((f for f in code_repo if (f.get("file_name") or "").strip() == "node.h"), None)
    if not node_file:
        return None
    raw = node_file.get("file_content", "")
    if not raw:
        return None
    try:
        return base64.b64decode(raw).decode("utf-8")
    except Exception:
        return raw if isinstance(raw, str) else None


def _get_node_h_from_file(base_dir):
    node_h_path = os.path.join(base_dir, "Outputs", "CodeContentFiles", "Cpp", "node.h")
    if not os.path.exists(node_h_path):
        return None
    try:
        with open(node_h_path, "r", encoding="utf-8") as f:
            content = f.read()
        return content or None
    except Exception:
        return None


def _build_testcase_io_objects(base_dir, tc, question_id, question_name, order):
    input_text = tc.get("input", "")
    output_text = tc.get("output", "")
    input_bytes = len((input_text or "").encode("utf-8"))
    output_bytes = len((output_text or "").encode("utf-8"))

    input_obj = {
        "input_type": "STDIN",
        "base64_encoded": True,
        "contents": base64.b64encode((input_text or "").encode("utf-8")).decode("utf-8"),
        "input_s3_url": None,
    }
    output_obj = {
        "output_type": "STDOUT",
        "base64_encoded": True,
        "contents": base64.b64encode((output_text or "").encode("utf-8")).decode("utf-8"),
        "multiple_possible_output": bool(tc.get("multiple_possible_output", False)),
        "multiple_output_contents": [],
    }
    input_s3_used = False
    output_s3_used = False
    s3_errors = []

    if input_bytes > LARGE_IO_THRESHOLD_BYTES:
        input_s3_url, local_path, uploaded = _write_blob_and_get_s3_url(
            base_dir, question_id, question_name, order, "input", input_text
        )
        if uploaded:
            input_s3_used = True
            input_obj = {
                "input_type": "STDIN",
                "base64_encoded": False,
                "contents": None,
                "input_s3_url": input_s3_url,
            }
        else:
            s3_errors.append(f"input upload failed: {_short_path(local_path, base_dir)}")

    if output_bytes > LARGE_IO_THRESHOLD_BYTES:
        if ENABLE_OUTPUT_S3:
            output_s3_url, local_path, uploaded = _write_blob_and_get_s3_url(
                base_dir, question_id, question_name, order, "output", output_text
            )
            if uploaded:
                output_s3_used = True
                output_obj = {
                    "output_type": "STDOUT",
                    "base64_encoded": False,
                    "contents": None,
                    "output_s3_url": output_s3_url,
                    "multiple_possible_output": bool(tc.get("multiple_possible_output", False)),
                    "multiple_output_contents": [],
                }
            else:
                s3_errors.append(f"output upload failed: {_short_path(local_path, base_dir)}")

    if tc.get("multiple_possible_output"):
        outs = tc.get("outputs") or []
        output_obj["multiple_output_contents"] = [
            base64.b64encode(str(o).encode("utf-8")).decode("utf-8") for o in outs
        ]

    return input_obj, output_obj, input_s3_used, output_s3_used, "; ".join(s3_errors)


def run_test_case_case2(base_dir, config, files_payload, tc, question_id, question_name, order):
    url = f"{API_BASE_URL}/{config['endpoint']}"
    request_id = str(uuid.uuid4())
    testcase_id = tc.get("id") or str(uuid.uuid4())

    input_obj, output_obj, input_s3_used, output_s3_used, s3_error = _build_testcase_io_objects(
        base_dir, tc, question_id, question_name, order
    )
    payload = {
        "language": config["id"],
        "files": files_payload,
        "main_file_path": config["main_file"],
        "request_id": request_id,
        "request_type": "CODE_EVALUATION_WITH_IO_TESTCASES",
        "default_execution_time_limit": config.get("default_execution_time_limit", 2.0),
        "ignore_trailing_whitespaces": True,
        "url": url,
        "testcases": [
            {
                "testcase_id": testcase_id,
                "execution_time_limit": None,
                "inputs": [input_obj],
                "outputs": [output_obj],
            }
        ],
    }

    headers = {"Content-Type": "application/json"}
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=20)
        response.raise_for_status()
        api_response = response.json()
        return {
            "_request_payload": payload,
            "_api_response": api_response,
            "_input_s3_used": input_s3_used,
            "_output_s3_used": output_s3_used,
            "_s3_error": s3_error,
        }
    except requests.exceptions.RequestException as e:
        return {
            "_request_error": str(e),
            "_request_payload": payload,
            "_api_response": None,
            "_input_s3_used": input_s3_used,
            "_output_s3_used": output_s3_used,
            "_s3_error": s3_error,
        }
    except json.JSONDecodeError:
        return {
            "_request_error": f"Failed to decode JSON response: {response.text}",
            "_request_payload": payload,
            "_api_response": None,
            "_input_s3_used": input_s3_used,
            "_output_s3_used": output_s3_used,
            "_s3_error": s3_error,
        }


def _decode_output_contents(output_obj):
    if not output_obj:
        return ""
    contents = output_obj.get("contents")
    if contents is None:
        return ""
    if output_obj.get("base64_encoded", False):
        try:
            return base64.b64decode(contents).decode("utf-8", errors="replace")
        except Exception:
            return ""
    return str(contents)


def _extract_api_error_message(api_response):
    if not isinstance(api_response, dict):
        return ""
    top_level_candidates = [
        api_response.get("error"),
        api_response.get("message"),
        api_response.get("error_message"),
        api_response.get("compilation_error"),
        api_response.get("compilation_error_message"),
    ]
    for msg in top_level_candidates:
        if isinstance(msg, str) and msg.strip():
            return msg.strip()

    results = api_response.get("results") or []
    if results and isinstance(results[0], dict):
        r0 = results[0]
        for key in (
            "error",
            "message",
            "error_message",
            "compilation_error",
            "compilation_error_message",
            "stderr",
            "stderr_text",
        ):
            msg = r0.get(key)
            if isinstance(msg, str) and msg.strip():
                return msg.strip()
    return ""


def _build_files_payload(config, solution_code, driver_code_raw, node_h_content=None):
    solution_file_name = config.get("solution_file", config["solution"])
    files = [
        {
            "base64_encoded": True,
            "file_contents": base64.b64encode(driver_code_raw.encode("utf-8")).decode("utf-8"),
            "file_path": config["main_file"],
        },
        {
            "base64_encoded": True,
            "file_contents": base64.b64encode(solution_code.encode("utf-8")).decode("utf-8"),
            "file_path": solution_file_name,
        },
    ]
    if node_h_content:
        files.append(
            {
                "base64_encoded": True,
                "file_contents": base64.b64encode(node_h_content.encode("utf-8")).decode("utf-8"),
                "file_path": "node.h",
            }
        )
    return files


##############################################################################
# NON-FUNCTION BASED EXECUTION
##############################################################################

def run_test_case_nonfunction(base_dir, config, code_content, tc, question_id, question_name, order):
    """Execute a single non-function test case using v2 IO testcase API — sends one file."""
    url = f"{API_BASE_URL}/{config['endpoint']}"
    code_b64 = base64.b64encode(code_content.encode("utf-8")).decode("utf-8")

    input_obj, output_obj, input_s3_used, output_s3_used, s3_error = _build_testcase_io_objects(
        base_dir, tc, question_id, question_name, order
    )

    testcase_id = tc.get("id") or str(uuid.uuid4())
    request_id = str(uuid.uuid4())

    files_payload = [
        {
            "base64_encoded": True,
            "file_contents": code_b64,
            "file_path": config["main_file"],
        }
    ]

    payload = {
        "language": config["id"],
        "files": files_payload,
        "main_file_path": config["main_file"],
        "request_id": request_id,
        "request_type": "CODE_EVALUATION_WITH_IO_TESTCASES",
        "default_execution_time_limit": config.get("default_execution_time_limit", 2.0),
        "ignore_trailing_whitespaces": True,
        "url": url,
        "testcases": [
            {
                "testcase_id": testcase_id,
                "execution_time_limit": None,
                "inputs": [input_obj],
                "outputs": [output_obj],
            }
        ],
    }

    headers = {"Content-Type": "application/json"}
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=20)
        if response.status_code == 413:
            return {"_request_error": "PAYLOAD_TOO_LARGE", "_input_s3_used": input_s3_used, "_output_s3_used": output_s3_used, "_s3_error": s3_error}
        response.raise_for_status()
        return {"_api_response": response.json(), "_input_s3_used": input_s3_used, "_output_s3_used": output_s3_used, "_s3_error": s3_error}
    except requests.exceptions.RequestException as e:
        return {"_request_error": str(e), "_input_s3_used": input_s3_used, "_output_s3_used": output_s3_used, "_s3_error": s3_error}
    except json.JSONDecodeError:
        return {"_request_error": f"Failed to decode JSON: {response.text}", "_input_s3_used": input_s3_used, "_output_s3_used": output_s3_used, "_s3_error": s3_error}


def run_all_tests_nonfunction(base_dir=None, selected_lang=None):
    """Run non-function based execution using the v2 IO testcase API (same format as function-based)."""
    base_dir = base_dir or os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    testcases_path = os.path.join(base_dir, "Outputs", "testcases.json")
    if not os.path.exists(testcases_path):
        print("Error: Outputs/testcases.json not found.")
        return False, {}, []

    with open(testcases_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)
        question_payload = test_data[0] if isinstance(test_data, list) else test_data
        testcases = question_payload.get("test_cases") or question_payload.get("testcases", [])

    if not testcases:
        print("No test cases found.")
        return False, {}, []

    generated_dir = os.path.join(base_dir, "Outputs", "generatedFullCode")
    if not os.path.exists(generated_dir):
        print("Error: Outputs/generatedFullCode directory not found.")
        return False, {}, []

    # Extract question metadata for S3 uploads
    question_id = question_payload.get("question_id") or question_payload.get("id") or "unknown"
    question_name = question_payload.get("question_name") or question_payload.get("name") or "unknown"

    all_results = {}
    target_languages = list(NONFUNCTION_LANG_CONFIG.keys())

    if selected_lang == "__multi__":
        target_languages = _multi_target_languages
        print(f"\nFiltered to run only: {', '.join(target_languages)}")
    elif selected_lang:
        mapped_lang = None
        for k in NONFUNCTION_LANG_CONFIG.keys():
            if k.lower() == selected_lang or k.lower().replace(".", "") == selected_lang:
                mapped_lang = k
                break
        if mapped_lang:
            target_languages = [mapped_lang]
            print(f"\nFiltered to run only: {mapped_lang}")
        else:
            print(f"\nWarning: Language \"{selected_lang}\" not supported. Running all.")

    for lang in target_languages:
        config = NONFUNCTION_LANG_CONFIG[lang]
        print(f"\n{'=' * 80}")
        print(f"TESTING {lang.upper()} - {len(testcases)} TEST CASES (NONFUNCTION IO PAYLOAD)")
        print(f"{'=' * 80}")

        code_file_path = os.path.join(generated_dir, config["file_name"])
        code_content = load_file(code_file_path)
        if not code_content:
            print(f"Warning: missing {config['file_name']}. Skipping.")
            continue

        language_results = []
        passed_count = 0
        global_error_occurred = False

        for i, tc in enumerate(testcases):
            order = tc.get("order", i + 1)
            expected_output = (tc.get("output") or "").strip()

            result = run_test_case_nonfunction(
                base_dir=base_dir,
                config=config,
                code_content=code_content,
                tc=tc,
                question_id=question_id,
                question_name=question_name,
                order=order,
            )

            test_res = {
                "test_index": i + 1,
                "order": order,
                "passed": False,
                "api_time": None,
                "memory_mb": None,
                "status": None,
                "error": None,
                "input_s3_used": bool(result.get("_input_s3_used")) if result else False,
                "output_s3_used": bool(result.get("_output_s3_used")) if result else False,
                "s3_error": (result.get("_s3_error") or "") if result else "",
            }

            if not result:
                test_res["error"] = "API request failed"
                language_results.append(test_res)
                _print_progress(lang, i + 1, len(testcases), "API_ERROR",
                    api_time=test_res["api_time"], memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"], output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"], error_details=test_res["error"])
                continue

            if result.get("_request_error"):
                test_res["error"] = f"API request failed: {result.get('_request_error')}"
                language_results.append(test_res)
                _print_progress(lang, i + 1, len(testcases), "API_ERROR",
                    api_time=test_res["api_time"], memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"], output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"], error_details=test_res["error"][:180])
                if "PAYLOAD_TOO_LARGE" in (result.get("_request_error") or ""):
                    continue
                continue

            api_result = result.get("_api_response") or {}

            if api_result.get("is_compilation_error"):
                test_res["status"] = "COMPILATION_ERROR"
                api_error = _extract_api_error_message(api_result)
                test_res["error"] = f"Compilation error: {api_error}" if api_error else "Compilation error"
                language_results.append(test_res)
                _print_progress(lang, i + 1, len(testcases), "COMPILATION_ERROR",
                    api_time=test_res["api_time"], memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"], output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"])
                global_error_occurred = True
                break

            results_list = api_result.get("results") or []
            if not results_list:
                test_res["error"] = "No results returned"
                language_results.append(test_res)
                _print_progress(lang, i + 1, len(testcases), "NO_RESULTS",
                    api_time=test_res["api_time"], memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"], output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"])
                continue

            r0 = results_list[0]
            test_res["status"] = r0.get("status")
            test_res["api_time"] = r0.get("execution_time")
            test_res["memory_mb"] = r0.get("memory_consumed")

            output_entries = r0.get("outputs") or []
            stdout_entry = next((o for o in output_entries if o.get("output_type") == "STDOUT"), None)
            stderr_entry = next((o for o in output_entries if o.get("output_type") == "STDERR"), None)
            actual_output = _decode_output_contents(stdout_entry)
            stderr_text = _decode_output_contents(stderr_entry)

            if test_res["status"] == "CORRECT":
                test_res["passed"] = True
                passed_count += 1
            elif test_res["status"] == "WRONG_ANSWER":
                test_res["error"] = f"Wrong answer. Expected: \"{expected_output[:80]}\" Got: \"{actual_output[:80]}\""
            elif test_res["status"] == "TIME_LIMIT_EXCEEDED":
                test_res["error"] = "Time limit exceeded"
            elif test_res["status"] == "MEMORY_LIMIT_EXCEEDED":
                test_res["error"] = "Memory limit exceeded"
            elif test_res["status"] == "RUNTIME_ERROR":
                test_res["error"] = f"Runtime error: {stderr_text[:200]}" if stderr_text else "Runtime error"
                global_error_occurred = True
            else:
                if actual_output.strip() == expected_output:
                    test_res["passed"] = True
                    test_res["status"] = "CORRECT"
                    passed_count += 1
                else:
                    test_res["error"] = f"Status: {test_res['status']}. Expected: \"{expected_output[:80]}\" Got: \"{actual_output[:80]}\""

            _print_progress(
                lang, i + 1, len(testcases), test_res["status"] or "UNKNOWN",
                api_time=test_res["api_time"],
                memory_mb=test_res["memory_mb"],
                input_s3_used=test_res["input_s3_used"],
                output_s3_used=test_res["output_s3_used"],
                s3_error=test_res["s3_error"],
                error_details=test_res.get("error", "")[:180] if not test_res["passed"] else "",
            )
            language_results.append(test_res)

            if global_error_occurred:
                break

        all_results[lang] = language_results
        _print_language_results_table(lang, language_results)
        print(f"{lang}: passed {passed_count}/{len(language_results)}")
        if global_error_occurred:
            print(f"Halting remaining languages due to error in {lang}.")
            break

    all_passed = bool(all_results) and all(
        tests and all(t.get("passed") for t in tests) for tests in all_results.values()
    )
    return all_passed, all_results, testcases


def run_all_tests_v2(base_dir=None, testcases_path=None, selected_lang=None):
    base_dir = base_dir or os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    testcases_path = testcases_path or os.path.join(base_dir, "Outputs", "testcases.json")
    if not os.path.exists(testcases_path):
        print("Error: Outputs/testcases.json not found.")
        return False, {}, []

    with open(testcases_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)
        question_payload = test_data[0] if isinstance(test_data, list) else test_data
        testcases = question_payload.get("test_cases") or question_payload.get("testcases", [])

    if not testcases:
        print("No test cases found.")
        return False, {}, []

    question = question_payload.get("question") or {}
    question_id = question.get("question_id", "unknown")
    question_name = question.get("short_text", "question")

    node_h_content = _get_node_h_from_payload(question_payload) or _get_node_h_from_file(base_dir)
    all_results = {}
    target_languages = list(LANG_CONFIG.keys())

    if selected_lang == "__multi__":
        target_languages = _multi_target_languages
        print(f"\nFiltered to run only: {', '.join(target_languages)}")
    elif selected_lang:
        mapped_lang = None
        for k in LANG_CONFIG.keys():
            if k.lower() == selected_lang or k.lower().replace(".", "") == selected_lang:
                mapped_lang = k
                break
        if mapped_lang:
            target_languages = [mapped_lang]
            print(f"\nFiltered to run only: {mapped_lang}")
        else:
            print(f"\nWarning: Language \"{selected_lang}\" not supported. Running all languages.")

    for lang in target_languages:
        config = LANG_CONFIG[lang]
        print(f"\n{'=' * 80}")
        print(f"TESTING {lang.upper()} - {len(testcases)} TEST CASES (CASE-2 IO PAYLOAD)")
        print(f"{'=' * 80}")

        content_dir = os.path.join(base_dir, "Outputs", "CodeContentFiles", config["dir"])
        solution_path = os.path.join(content_dir, config["solution"])
        driver_path = os.path.join(content_dir, config["driver"])

        solution_code = load_file(solution_path)
        driver_code_raw = load_file(driver_path)
        if not solution_code or not driver_code_raw:
            print(f"Warning: missing files for {lang}. Skipping.")
            continue

        node_h = node_h_content if lang == "C++" else None
        files_payload = _build_files_payload(config, solution_code, driver_code_raw, node_h)

        language_results = []
        passed_count = 0
        global_error_occurred = False

        for i, tc in enumerate(testcases):
            order = tc.get("order", i + 1)
            expected_output = (tc.get("output") or "").strip()

            result = run_test_case_case2(
                base_dir=base_dir,
                config=config,
                files_payload=files_payload,
                tc=tc,
                question_id=question_id,
                question_name=question_name,
                order=order,
            )
            test_res = {
                "test_index": i + 1,
                "order": order,
                "passed": False,
                "api_time": None,
                "memory_mb": None,
                "status": None,
                "error": None,
                "input_s3_used": bool(result.get("_input_s3_used")) if result else False,
                "output_s3_used": bool(result.get("_output_s3_used")) if result else False,
                "s3_error": (result.get("_s3_error") or "") if result else "",
            }

            if not result:
                test_res["error"] = "API request failed"
                language_results.append(test_res)
                _print_progress(
                    lang,
                    i + 1,
                    len(testcases),
                    "API_ERROR",
                    api_time=test_res["api_time"],
                    memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"],
                    output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"],
                    error_details=test_res["error"],
                )
                continue
            if result.get("_request_error"):
                test_res["error"] = f"API request failed: {result.get('_request_error')}"
                language_results.append(test_res)
                _print_progress(
                    lang,
                    i + 1,
                    len(testcases),
                    "API_ERROR",
                    api_time=test_res["api_time"],
                    memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"],
                    output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"],
                    error_details=test_res["error"],
                )
                continue

            api_result = result.get("_api_response") or {}

            if api_result.get("is_compilation_error"):
                test_res["status"] = "COMPILATION_ERROR"
                api_error = _extract_api_error_message(api_result)
                test_res["error"] = f"Compilation error: {api_error}" if api_error else "Compilation error"
                language_results.append(test_res)
                _print_progress(
                    lang,
                    i + 1,
                    len(testcases),
                    "COMPILATION_ERROR",
                    api_time=test_res["api_time"],
                    memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"],
                    output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"],
                )
                global_error_occurred = True
                break

            results_list = api_result.get("results") or []
            if not results_list:
                test_res["error"] = "No results returned"
                language_results.append(test_res)
                _print_progress(
                    lang,
                    i + 1,
                    len(testcases),
                    "NO_RESULTS",
                    api_time=test_res["api_time"],
                    memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"],
                    output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"],
                )
                continue

            r0 = results_list[0]
            test_res["status"] = r0.get("status")
            test_res["api_time"] = r0.get("execution_time")
            test_res["memory_mb"] = r0.get("memory_consumed")

            output_entries = r0.get("outputs") or []
            stdout_entry = next((o for o in output_entries if o.get("output_type") == "STDOUT"), None)
            stderr_entry = next((o for o in output_entries if o.get("output_type") == "STDERR"), None)
            actual_output = _decode_output_contents(stdout_entry)
            stderr_text = _decode_output_contents(stderr_entry)

            if test_res["status"] == "CORRECT":
                test_res["passed"] = True
                passed_count += 1
                _print_progress(
                    lang,
                    i + 1,
                    len(testcases),
                    "CORRECT",
                    api_time=test_res["api_time"],
                    memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"],
                    output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"],
                )
            else:
                api_error = _extract_api_error_message(api_result)
                test_res["error"] = (
                    f"Expected: {expected_output}\n"
                    f"Actual:   {actual_output.strip()}\n"
                    f"Stderr:   {stderr_text.strip()}"
                    + (f"\nAPI error: {api_error}" if api_error else "")
                )
                if test_res["status"] in {"RUNTIME_ERROR", "COMPILATION_ERROR"}:
                    global_error_occurred = True
                _print_progress(
                    lang,
                    i + 1,
                    len(testcases),
                    test_res["status"] or "FAILED",
                    api_time=test_res["api_time"],
                    memory_mb=test_res["memory_mb"],
                    input_s3_used=test_res["input_s3_used"],
                    output_s3_used=test_res["output_s3_used"],
                    s3_error=test_res["s3_error"],
                )

            language_results.append(test_res)
            if global_error_occurred:
                break

        all_results[lang] = language_results
        _print_language_results_table(lang, language_results)
        print(f"{lang}: passed {passed_count}/{len(language_results)}")
        if global_error_occurred:
            print(f"Halting remaining languages due to error in {lang}.")
            break

    all_passed = bool(all_results) and all(
        tests and all(t.get("passed") for t in tests) for tests in all_results.values()
    )
    return all_passed, all_results, testcases


def main():
    is_nonfunction = "--nonfunction" in sys.argv

    selected_lang = None
    # Support multiple language args: python cpp java nodejs
    if len(sys.argv) > 1:
        requested_langs = [arg.lower() for arg in sys.argv[1:] if not arg.startswith("--")]
        lang_config = NONFUNCTION_LANG_CONFIG if is_nonfunction else LANG_CONFIG
        if len(requested_langs) == 1:
            selected_lang = requested_langs[0]
        elif len(requested_langs) > 1:
            filtered = []
            for req in requested_langs:
                for k in lang_config.keys():
                    if k.lower() == req or k.lower().replace(".", "").replace("+", "p") == req:
                        if k not in filtered:
                            filtered.append(k)
            if filtered:
                selected_lang = "__multi__"
                global _multi_target_languages
                _multi_target_languages = filtered

    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    if is_nonfunction:
        print(f"\n[execution_manager_v2] Running in NON-FUNCTION mode")
    _print_runtime_config(base_dir)
    _warn_if_upload_env_incomplete()

    if not is_nonfunction and UPLOAD_MODE == "proxy":
        # Health check: ensure the proxy upload service is alive before starting execution.
        # Only relevant in proxy mode — in direct S3 mode (EXEC_V2_UPLOAD_MODE=s3) we upload
        # straight to S3 via boto3, so there is no proxy service to health-check.
        S3_HEALTH_URL = f"{UPLOAD_SERVICE_URL.rstrip('/')}/health" if UPLOAD_SERVICE_URL else ""
        if S3_HEALTH_URL:
            print(f"\nChecking S3 upload service health: {S3_HEALTH_URL}")
            try:
                health_resp = requests.get(S3_HEALTH_URL, timeout=300)
                health_data = health_resp.json()
                if health_data.get("ok"):
                    print("S3 upload service is live.")
                else:
                    print(f"Warning: S3 upload service returned unexpected response: {health_data}")
                    print("Proceeding anyway — large testcases may fall back to inline base64.")
            except Exception as e:
                print(f"Warning: S3 upload service health check failed: {e}")
                print("Proceeding anyway — large testcases may fall back to inline base64.")

    if is_nonfunction:
        all_passed, all_results, testcases = run_all_tests_nonfunction(base_dir=base_dir, selected_lang=selected_lang)
    else:
        all_passed, all_results, testcases = run_all_tests_v2(base_dir=base_dir, selected_lang=selected_lang)

    if not all_results:
        return

    mode_label = "nonfunction" if is_nonfunction else "v2"
    print(f"\n{'=' * 80}")
    print(f"SUMMARY (execution_manager_{mode_label})")
    print(f"{'=' * 80}")
    summary_rows = []
    for lang, tests in all_results.items():
        passed_count = len([t for t in tests if t.get("passed")])
        total_count = len(tests)
        pass_rate = (passed_count / total_count) * 100 if total_count else 0
        summary_rows.append([lang, f"{passed_count}/{total_count}", f"{pass_rate:.1f}%"])
    _print_table("Language Summary", ["Language", "Passed", "Pass Rate"], summary_rows)
    _print_error_table(all_results)
    print(f"All passed: {all_passed}")
    print(f"Total testcases processed: {len(testcases)}")


if __name__ == "__main__":
    main()

