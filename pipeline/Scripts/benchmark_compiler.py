"""
Remote Python execution for benchmark/harden via the new compiler API.

Used when BENCHMARK_USE_COMPILER=1 so Replit does not spawn local subprocesses
for every fuzz/mutation run.
"""

from __future__ import annotations

import math
import os
from typing import List, Tuple

from project_env import load_execution_manager_env

load_execution_manager_env()

from execution_manager_v3 import (  # noqa: E402
    BASE64_ENCODE_IO,
    MAX_POLL_ATTEMPTS,
    NEW_COMPILER_URL,
    POLL_INTERVAL_SECONDS,
    _build_input_object,
    _decode_result_outputs,
    _maybe_b64,
    build_compile_payload,
    normalize_testcase_inputs,
    poll_status,
    submit_compile,
)

PYTHON_LANG_ID = "22"
MAIN_FILE = "main.py"
BENCHMARK_QUESTION_ID = "benchmark"
BENCHMARK_QUESTION_NAME = "benchmark"


def _resolve_base_dir() -> str:
    return os.getcwd()


def _map_result_status(api_status: str | None) -> str:
    s = (api_status or "").upper()
    if s in ("TIME_LIMIT_EXCEEDED", "TLE", "TIMEOUT") or (
        "TIME" in s and ("LIMIT" in s or "EXCEED" in s)
    ):
        return "timeout"
    if s in (
        "COMPILATION_ERROR",
        "COMPILE_ERROR",
        "RUNTIME_ERROR",
        "INTERNAL_ERROR",
        "ERROR",
        "FAILED",
        "NO_RESULT",
        "NOT_FOUND",
    ):
        return "error"
    return "ok"


def _build_benchmark_testcases(
    base_dir: str, inputs: List[str]
) -> tuple[list[dict], list[str]]:
    payload_testcases: list[dict] = []
    ordered_ids: list[str] = []
    for i, input_text in enumerate(inputs):
        tc_id = f"bench-{i + 1}"
        order = i + 1
        tc = {"order": order}
        input_obj, _, _ = _build_input_object(
            base_dir,
            tc,
            BENCHMARK_QUESTION_ID,
            BENCHMARK_QUESTION_NAME,
            order,
            input_text,
        )
        out_contents, out_b64 = _maybe_b64("", BASE64_ENCODE_IO)
        payload_testcases.append(
            {
                "testcase_id": tc_id,
                "inputs": [input_obj],
                "outputs": [
                    {
                        "output_type": "STDOUT",
                        "contents": out_contents,
                        "multiple_possible_output": False,
                        "base64_encoded": out_b64,
                    }
                ],
            }
        )
        ordered_ids.append(tc_id)
    return payload_testcases, ordered_ids


def _poll_budget(timeout: float, num_inputs: int) -> int:
    return max(
        MAX_POLL_ATTEMPTS,
        int(math.ceil(timeout * num_inputs / POLL_INTERVAL_SECONDS)) + 30,
    )


def run_solutions_batch_compiler(
    code_str: str,
    inputs: List[str],
    timeout: float,
) -> List[Tuple[str, str]]:
    if not inputs:
        return []

    base_dir = _resolve_base_dir()
    payload_testcases, ordered_ids = _build_benchmark_testcases(base_dir, inputs)
    files_payload = [
        {
            "file_path": MAIN_FILE,
            "file_contents": code_str,
            "base64_encoded": False,
        }
    ]
    time_limit = max(1, int(math.ceil(timeout)))
    compile_payload = build_compile_payload(
        PYTHON_LANG_ID,
        MAIN_FILE,
        files_payload,
        normalize_testcase_inputs(payload_testcases),
        time_limit,
    )

    try:
        data, _, _ = submit_compile(NEW_COMPILER_URL, compile_payload)
    except Exception:
        return [("", "error") for _ in inputs]

    request_id = data.get("request_id") or data.get("id")
    if not request_id:
        return [("", "error") for _ in inputs]

    status_data = poll_status(
        NEW_COMPILER_URL,
        request_id,
        max_attempts=_poll_budget(timeout, len(inputs)),
    )
    overall = status_data.get("status")
    body = status_data.get("response") or {}

    if overall in ("FAILED", "ERROR", "TIMEOUT", "NOT_FOUND"):
        err = body.get("error") or f"Batch status: {overall}"
        return [(str(err), "error") for _ in inputs]

    results_by_id: dict[str, dict] = {}
    for r in body.get("results", []) or []:
        rid = str(r.get("testcase_id") or r.get("test_case_id") or "")
        if rid:
            results_by_id[rid] = r

    out: List[Tuple[str, str]] = []
    for tc_id in ordered_ids:
        r = results_by_id.get(tc_id)
        if r is None:
            out.append(("", "error"))
            continue
        got, stderr = _decode_result_outputs(r)
        status = _map_result_status(r.get("status"))
        if status == "error":
            out.append(((got or "") + (stderr or ""), "error"))
        elif status == "timeout":
            out.append(("", "timeout"))
        else:
            out.append((got or "", "ok"))
    return out


def run_solution_compiler(
    code_str: str,
    stdin_str: str,
    timeout: float,
) -> Tuple[str, str]:
    rows = run_solutions_batch_compiler(code_str, [stdin_str], timeout)
    return rows[0] if rows else ("", "error")
