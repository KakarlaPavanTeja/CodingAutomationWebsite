"""
LLM Usage Tracker — writes every call to Supabase `llm_usage` table.

Pricing is loaded from pipeline/pricing.json (updated daily or manually).
Falls back to hardcoded defaults if the file is missing.

Environment variables used:
  SUPABASE_URL            — e.g. https://xxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY — service role key (server-side only)
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
# Pricing: per 1M tokens  { model_pattern: (input_per_1M, output_per_1M) }
# Updated 2026-04-05 from https://platform.openai.com/docs/pricing
# ---------------------------------------------------------------------------
PRICING_FILE = os.path.join(os.path.dirname(SCRIPT_DIR), "pricing.json")

_DEFAULT_PRICING: dict[str, tuple[float, float]] = {
    # GPT-5 family
    "gpt-5.4":            (1.25, 10.00),
    "gpt-5.3-codex":      (1.25, 10.00),
    "gpt-5.2-pro":        (1.25, 10.00),
    "gpt-5.1-codex":      (1.25, 10.00),
    "gpt-5":              (1.25, 10.00),
    # GPT-5 reasoning
    "gpt-5-reasoning":    (1.25, 10.00),
    # GPT-4o family
    "gpt-4o":             (2.50,  10.00),
    "gpt-4o-mini":        (0.15,   0.60),
    "gpt-4o-2024-11-20":  (2.50,  10.00),
    # GPT-4
    "gpt-4-turbo":        (10.00, 30.00),
    "gpt-4":              (30.00, 60.00),
    # o-series reasoning
    "o4-mini":            (1.10,   4.40),
    "o3":                 (2.00,   8.00),
    "o3-mini":            (1.10,   4.40),
    "o1":                 (15.00, 60.00),
    "o1-mini":            (1.10,   4.40),
    "o1-preview":         (15.00, 60.00),
    # GPT-3.5
    "gpt-3.5-turbo":      (0.50,   1.50),
}

_pricing_cache: dict[str, tuple[float, float]] | None = None


def _load_pricing() -> dict[str, tuple[float, float]]:
    """Load pricing from pricing.json, fall back to defaults."""
    global _pricing_cache
    if _pricing_cache is not None:
        return _pricing_cache

    pricing = dict(_DEFAULT_PRICING)
    if os.path.exists(PRICING_FILE):
        try:
            with open(PRICING_FILE, "r") as f:
                data = json.load(f)
            models = data if isinstance(data, dict) else data.get("models", {})
            for model_name, vals in models.items():
                if isinstance(vals, (list, tuple)) and len(vals) == 2:
                    pricing[model_name.lower()] = (float(vals[0]), float(vals[1]))
                elif isinstance(vals, dict):
                    pricing[model_name.lower()] = (
                        float(vals.get("input", vals.get("prompt", 0))),
                        float(vals.get("output", vals.get("completion", 0))),
                    )
        except Exception as e:
            print(f"[usage_tracker] Warning: failed to load {PRICING_FILE}: {e}")

    _pricing_cache = pricing
    return pricing


def get_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Calculate cost in USD for given model and token counts."""
    pricing = _load_pricing()
    model_lower = model.lower().strip()

    # Exact match first
    if model_lower in pricing:
        inp, out = pricing[model_lower]
    else:
        # Prefix match (e.g. "gpt-5.4-0125" matches "gpt-5.4")
        matched = None
        for key in sorted(pricing.keys(), key=len, reverse=True):
            if model_lower.startswith(key):
                matched = key
                break
        if matched:
            inp, out = pricing[matched]
        else:
            # Unknown model — use conservative estimate
            print(f"[usage_tracker] Warning: no pricing for model '{model}', using $1.25/$10.00 per 1M")
            inp, out = (1.25, 10.00)

    return (prompt_tokens * inp / 1_000_000) + (completion_tokens * out / 1_000_000)


# ---------------------------------------------------------------------------
# Supabase insert
# ---------------------------------------------------------------------------
_SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
_SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _insert_supabase(row: dict) -> bool:
    """Insert a row into llm_usage via Supabase REST API. Returns True on success."""
    if not _SUPABASE_URL or not _SUPABASE_SERVICE_KEY:
        return False
    url = f"{_SUPABASE_URL}/rest/v1/llm_usage"
    headers = {
        "apikey": _SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {_SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    try:
        resp = _requests.post(url, json=row, headers=headers, timeout=10)
        if resp.status_code in (200, 201):
            return True
        print(f"[usage_tracker] Supabase insert failed ({resp.status_code}): {resp.text[:200]}", flush=True)
        return False
    except Exception as e:
        print(f"[usage_tracker] Supabase insert error: {e}", flush=True)
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
) -> dict:
    """
    Track an LLM call. Inserts into Supabase llm_usage, falls back to local JSON.

    Parameters:
      prompt_tokens      - input token count
      completion_tokens  - output token count
      problem_name       - human-readable label (e.g. "two_sum_description")
      model              - model name from LLM response (e.g. "gpt-5.4")
      purpose            - call purpose (chat, code, testcases, enrichment, etc.)
      step_id            - pipeline step id (e.g. "generate_question", "create_testcases")
    """
    total_tokens = prompt_tokens + completion_tokens
    cost = get_cost(model, prompt_tokens, completion_tokens)

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

    # Try Supabase first
    success = _insert_supabase(row)

    # Always write local too (as backup / for local debugging)
    _append_local(row)

    if success:
        print(f"[usage] {model} | {purpose} | {total_tokens} tokens | ${cost:.6f} → Supabase ✓", flush=True)
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
