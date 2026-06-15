"""
LLM Usage Tracker — records every call to the Replit Postgres `llm_usage` table
via the internal API, with a local JSON backup.

Cost is taken directly from the LLM response (OpenRouter returns the real USD
cost of each call — see llm_client.call_llm). There is no local pricing table.

Environment variables used:
  INTERNAL_API_URL        — base URL of this Next.js app (set by the run route)
  INTERNAL_API_SECRET     — shared secret matching CRON_SECRET on the server
  PIPELINE_USER_ID        — set by the API route before spawning the script
  PIPELINE_PROBLEM_ID     — set by the API route before spawning the script
  PIPELINE_STEP_ID        — set by the API route before spawning the script
  PIPELINE_BASE_DIR       — base directory for the problem
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime

import requests as _requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_BASE = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(_BASE, "Outputs")
USAGE_TRACKER_FILE = os.path.join(OUTPUT_DIR, "usage_tracker.json")


# ---------------------------------------------------------------------------
# Replit internal API insert
# ---------------------------------------------------------------------------
# The pipeline run handler (src/app/api/pipeline/run/route.ts) sets these
# env vars before spawning python.
_INTERNAL_API_URL = os.environ.get("INTERNAL_API_URL", "")
_INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")


def _insert_remote(row: dict) -> bool:
    """POST a usage row to the internal /api/internal/llm-usage endpoint."""
    if not _INTERNAL_API_URL or not _INTERNAL_API_SECRET:
        return False
    url = f"{_INTERNAL_API_URL.rstrip('/')}/api/internal/llm-usage"
    headers = {
        "Content-Type": "application/json",
        "X-Internal-Secret": _INTERNAL_API_SECRET,
    }
    try:
        resp = _requests.post(url, json=row, headers=headers, timeout=10)
        if resp.status_code in (200, 201):
            return True
        print(f"[usage_tracker] internal insert failed ({resp.status_code}): {resp.text[:200]}", flush=True)
        return False
    except Exception as e:
        print(f"[usage_tracker] internal insert error: {e}", flush=True)
        return False


# ---------------------------------------------------------------------------
# Local JSON fallback
# ---------------------------------------------------------------------------
def _append_local(row: dict) -> None:
    """Append usage entry to local usage_tracker.json as fallback."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    tracker = {}
    if os.path.exists(USAGE_TRACKER_FILE):
        try:
            with open(USAGE_TRACKER_FILE, "r") as f:
                tracker = json.load(f)
        except Exception:
            tracker = {}

    tracker.setdefault("total_requests", 0)
    tracker.setdefault("total_tokens", 0)
    tracker.setdefault("total_cost_usd", 0.0)
    tracker.setdefault("prompt_tokens", 0)
    tracker.setdefault("completion_tokens", 0)
    tracker.setdefault("history", [])

    tracker["total_requests"] += 1
    tracker["total_tokens"] += row.get("total_tokens", 0)
    tracker["total_cost_usd"] += row.get("cost_usd", 0)
    tracker["prompt_tokens"] += row.get("prompt_tokens", 0)
    tracker["completion_tokens"] += row.get("completion_tokens", 0)
    tracker["last_updated"] = datetime.now().isoformat()

    tracker["history"].append({
        "timestamp": datetime.now().isoformat(),
        "model": row.get("model", "unknown"),
        "purpose": row.get("purpose", ""),
        "problem_name": row.get("problem_name", ""),
        "problem_id": row.get("problem_id"),
        "step_id": row.get("step_id"),
        "prompt_tokens": row.get("prompt_tokens", 0),
        "completion_tokens": row.get("completion_tokens", 0),
        "total_tokens": row.get("total_tokens", 0),
        "cost_usd": round(row.get("cost_usd", 0), 6),
    })

    # Keep last 500
    if len(tracker["history"]) > 500:
        tracker["history"] = tracker["history"][-500:]

    with open(USAGE_TRACKER_FILE, "w") as f:
        json.dump(tracker, f, indent=2)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def update_usage(
    prompt_tokens: int,
    completion_tokens: int,
    problem_name: str,
    *,
    model: str = "unknown",
    purpose: str = "unknown",
    step_id: str | None = None,
    cost: float = 0.0,
) -> dict:
    """
    Track an LLM call. Inserts into the `llm_usage` table via the internal API,
    falls back to local JSON.

    Parameters:
      prompt_tokens      - input token count
      completion_tokens  - output token count
      problem_name       - human-readable label (e.g. "two_sum_description")
      model              - model name from LLM response (e.g. "openai/gpt-5.4")
      purpose            - call purpose (chat, code, testcases, enrichment, etc.)
      step_id            - pipeline step id (e.g. "generate_question", "create_testcases")
      cost               - real USD cost from the LLM response (OpenRouter usage.cost)
    """
    total_tokens = prompt_tokens + completion_tokens
    try:
        cost = float(cost or 0.0)
    except (TypeError, ValueError):
        cost = 0.0

    # Resolve IDs from environment (set by the API route)
    user_id = os.environ.get("PIPELINE_USER_ID") or None
    problem_id = os.environ.get("PIPELINE_PROBLEM_ID") or None
    resolved_step = step_id or os.environ.get("PIPELINE_STEP_ID") or None

    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "problem_id": problem_id,
        "problem_name": problem_name,
        "model": model,
        "purpose": purpose,
        "step_id": resolved_step,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "cost_usd": round(cost, 6),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    # Try Replit internal endpoint first
    success = _insert_remote(row)

    # Always write local too (as backup / for local debugging)
    _append_local(row)

    if success:
        print(f"[usage] {model} | {purpose} | {total_tokens} tokens | ${cost:.6f} → DB ✓", flush=True)
    else:
        print(f"[usage] {model} | {purpose} | {total_tokens} tokens | ${cost:.6f} → local only", flush=True)

    return row


# ---------------------------------------------------------------------------
# Legacy compat — load_usage_tracker / save_usage_tracker
# ---------------------------------------------------------------------------
def load_usage_tracker() -> dict:
    if os.path.exists(USAGE_TRACKER_FILE):
        with open(USAGE_TRACKER_FILE, "r") as f:
            return json.load(f)
    return {"total_requests": 0, "total_tokens": 0, "total_cost_usd": 0.0,
            "prompt_tokens": 0, "completion_tokens": 0, "last_updated": None, "history": []}


def save_usage_tracker(tracker: dict) -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(USAGE_TRACKER_FILE, "w") as f:
        json.dump(tracker, f, indent=2)
