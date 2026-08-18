"""Advisory SLM validation of the optimal + brute solutions.

One LLM call (validate_solutions purpose) extracts small executable examples in
the optimal's stdin format and judges both solutions; the examples are then run
against the optimal/brute to check input-format, ground-truth, and agreement.
Everything here is advisory — callers never fail on its output.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from llm_client import call_llm  # noqa: E402
from usage_tracker import update_usage  # noqa: E402
from Prompts.validatesolutionsprompt import get_validate_solutions_prompt  # noqa: E402
from benchmark_suite import (  # noqa: E402
    run_solutions_batch,
    normalize,
    BENCHMARK_RUN_TIMEOUT,
)
from open_ended_checker import accepts  # noqa: E402


def _parse_slm_json(content: str) -> dict | None:
    """Parse the SLM's JSON, tolerating an accidental ```json fence. None on failure."""
    if not content or not content.strip():
        return None
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        stripped = text.rstrip()
        if stripped.endswith("```"):
            text = stripped[:-3]
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def validate_solutions_llm(description, optimal_code, brute_code, *, _call=None, record_usage=True):
    """Run the one SLM validation call. Returns the parsed dict or None on any failure.

    `_call` injects a fake call_llm in tests; when provided, usage is not recorded.
    """
    call = _call or call_llm
    try:
        system, user = get_validate_solutions_prompt(description, optimal_code, brute_code)
        content, usage = call(system, user, purpose="validate_solutions")
    except Exception:
        return None
    if record_usage and _call is None:
        try:
            update_usage(
                usage.get("prompt_tokens", 0),
                usage.get("completion_tokens", 0),
                "solution_validation",
                model=usage.get("model", "unknown"),
                purpose="validate_solutions",
                step_id="generate_brute_force",
                cost=usage.get("cost", 0.0),
            )
        except Exception:
            pass
    return _parse_slm_json(content)


def validate_examples(examples, optimal_code, brute_code, description, *, _batch=None,
                      checker=None):
    """Run the SLM examples against the optimal (and brute). Advisory checks:
    input-format (optimal didn't error), ground-truth (optimal output == SLM
    expected), and optimal-vs-brute agreement.

    `checker` is the open-ended problem's `is_valid_answer` (see open_ended_checker).
    Agreement used to short-circuit to True whenever a prose regex read the description
    as open-ended, which passed the check without running it — and fired on
    deterministic descriptions that merely spelled out a tie-break. The checker answers
    the same question for real: a brute answer it accepts agrees."""
    runner = _batch or (lambda code, inputs: run_solutions_batch(code, inputs, BENCHMARK_RUN_TIMEOUT))
    inputs = [e.get("input", "") for e in examples]
    if not inputs:
        return {"example_results": [], "optimal_ok": True, "brute_ok": True}

    opt = runner(optimal_code, inputs)
    brute = runner(brute_code, inputs) if brute_code else [None] * len(inputs)

    results = []
    optimal_ok = True
    brute_ok = True
    for e, o, b in zip(examples, opt, brute):
        out, status = o
        fmt_ok = status != "error"
        matches = status == "ok" and normalize(out) == normalize(e.get("expected_output", ""))
        if not fmt_ok or not matches:
            optimal_ok = False
        rec = {
            "input": e.get("input", ""),
            "optimal_status": status,
            "input_format_ok": fmt_ok,
            "matches_expected": matches,
        }
        if b is not None:
            bout, bstatus = b
            agrees = accepts(checker, e.get("input", ""), normalize(bout)) or (
                status == "ok" and bstatus == "ok" and normalize(bout) == normalize(out)
            )
            rec["brute_agrees"] = agrees
            if not agrees:
                brute_ok = False
        results.append(rec)
    return {"example_results": results, "optimal_ok": optimal_ok, "brute_ok": brute_ok}
