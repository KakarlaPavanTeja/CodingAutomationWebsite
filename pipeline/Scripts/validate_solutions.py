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
