"""
OpenAI calls via Chat Completions, Responses, or legacy Completions as needed.

  OPENAI_MODEL_TESTCASES   — testcase script generation (default: gpt-5.4, Responses API)
  OPENAI_MODEL_CHAT        — instruction-following (default: gpt-5.4, Responses API)
  OPENAI_MODEL_CODE        — code conversion / splitting (default: gpt-5.3-codex)
  OPENAI_MODEL_ENRICHMENT  — enrichment (default: gpt-5.4)

  OPENAI_REASONING_EFFORT  — for purpose=chat on Responses: high|xhigh|… (default: high)
  OPENAI_REASONING_EFFORT_TESTCASES — for purpose=testcases on Responses (default: high)
  OPENAI_API_MODE          — force: responses | chat | completions
  OPENAI_MODEL             — fallback if a purpose-specific model env is unset

Requires: export OPENAI_API_KEY=sk-...

  OPENAI_MAX_RETRIES     — retries on 429/502/503/… (default: 8)
  OPENAI_RETRY_BASE_SEC  — initial backoff seconds (default: 2)

  OPENAI_READ_TIMEOUT_SEC — HTTP read timeout for all purposes (seconds), if set
  OPENAI_TESTCASES_READ_TIMEOUT_SEC — testcase generator only (default: 900)
  Other purposes default to 300s when OPENAI_READ_TIMEOUT_SEC is unset.
"""

from __future__ import annotations

import os
import re
import time
import requests

CHAT_URL = "https://api.openai.com/v1/chat/completions"
COMPLETIONS_URL = "https://api.openai.com/v1/completions"
RESPONSES_URL = "https://api.openai.com/v1/responses"

# Chat uses full gpt-5.4 (not mini/nano). (default_model, preferred_route)
_PURPOSE_DEFAULTS: dict[str, tuple[str, str]] = {
    "testcases": ("gpt-5.4", "responses"),
    "chat": ("gpt-5.4", "responses"),
    "code": ("gpt-5.3-codex", "responses"),
    "enrichment": ("gpt-5.4", "responses"),
}

_ENV_SUFFIX = {
    "testcases": "TESTCASES",
    "chat": "CHAT",
    "code": "CODE",
    "enrichment": "ENRICHMENT",
}

_REASONING_EFFORT_ALLOWED = frozenset(
    {"none", "minimal", "low", "medium", "high", "xhigh"}
)

_RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})

# Testcase script generation can run long (large N, reasoning models); default 15 min.
_DEFAULT_TESTCASES_TIMEOUT_SEC = 900
_DEFAULT_OTHER_TIMEOUT_SEC = 300


def _resolve_read_timeout_sec(purpose: str) -> int:
    global_override = os.environ.get("OPENAI_READ_TIMEOUT_SEC", "").strip()
    if global_override:
        return max(1, int(global_override))
    if purpose.lower().strip() == "testcases":
        raw = os.environ.get("OPENAI_TESTCASES_READ_TIMEOUT_SEC", "").strip()
        if raw:
            return max(1, int(raw))
        return _DEFAULT_TESTCASES_TIMEOUT_SEC
    return _DEFAULT_OTHER_TIMEOUT_SEC


def _post_with_retries(url: str, headers: dict, payload: dict, timeout: int) -> requests.Response:
    """POST with exponential backoff on transient OpenAI errors."""
    max_retries = max(1, int(os.environ.get("OPENAI_MAX_RETRIES", "8")))
    base = float(os.environ.get("OPENAI_RETRY_BASE_SEC", "2"))
    last: requests.Response | None = None
    for attempt in range(max_retries):
        last = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if last.status_code == 200:
            return last
        if attempt + 1 >= max_retries or last.status_code not in _RETRYABLE_STATUS:
            break
        wait = min(base * (2**attempt), 120.0)
        if last.status_code == 429:
            ra = last.headers.get("Retry-After")
            if ra:
                try:
                    wait = max(wait, float(ra))
                except ValueError:
                    pass
        print(
            f"OpenAI returned {last.status_code}, waiting {wait:.1f}s "
            f"(attempt {attempt + 1}/{max_retries})...",
            flush=True,
        )
        time.sleep(wait)
    assert last is not None
    return last


def _normalize_usage(usage: dict) -> dict:
    if not usage:
        return {}
    return {
        "prompt_tokens": usage.get("prompt_tokens") or usage.get("input_tokens", 0),
        "completion_tokens": usage.get("completion_tokens")
        or usage.get("output_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
    }


def _text_from_responses_body(data: dict) -> str:
    parts: list[str] = []
    for item in data.get("output", []):
        if item.get("type") != "message":
            continue
        for block in item.get("content", []):
            if block.get("type") == "output_text" and "text" in block:
                parts.append(block["text"])
    return "".join(parts).strip()


def _model_prefers_responses_api(model: str) -> bool:
    """Models that should use Responses API instead of chat/completions."""
    m = model.lower().strip()
    if "chat-latest" in m or ("gpt-5" in m and "chat" in m):
        return False
    if "codex" in m:
        return True
    if re.match(r"^o[134](-|$)", m) or m.startswith("o1") or m.startswith("o3"):
        return True
    if "gpt-5.2-pro" in m or "gpt-5.1-codex" in m:
        return True
    if re.match(r"^gpt-5\.\d+$", m):
        return True
    if m.startswith("gpt-5") and "chat" not in m and "mini" not in m and "nano" not in m:
        if "codex" in m or "pro" in m:
            return True
    return False


def _resolve_route(model: str, preferred: str) -> str:
    mode = os.environ.get("OPENAI_API_MODE", "").strip().lower()
    if mode == "responses":
        return "responses"
    if mode == "chat":
        return "chat"
    if mode == "completions":
        return "completions"
    if _model_prefers_responses_api(model):
        return "responses"
    return preferred


def _resolve_model(purpose: str) -> tuple[str, str]:
    purpose = purpose.lower().strip()
    if purpose not in _PURPOSE_DEFAULTS:
        purpose = "chat"
    default_model, preferred_route = _PURPOSE_DEFAULTS[purpose]
    suffix = _ENV_SUFFIX.get(purpose, "CHAT")
    model = (
        os.environ.get(f"OPENAI_MODEL_{suffix}")
        or os.environ.get("OPENAI_MODEL")
        or default_model
    )
    route = _resolve_route(model, preferred_route)
    return model, route


def call_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 1,
    purpose: str = "chat",
):
    """
    purpose:
      - "testcases"   — thinking / reasoning for testcase generator script
      - "chat"        — GPT-5.4 + reasoning effort for descriptions, signature, refactor, titles, …
      - "code"        — multi-language code (conversion, code_splitter)
      - "enrichment"  — hints, real-life, follow-ups
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY environment variable not set")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    model, route = _resolve_model(purpose)

    if route == "responses":
        url = RESPONSES_URL
        payload: dict = {
            "model": model,
            "input": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if temperature != 1:
            payload["temperature"] = temperature
        if purpose in {"chat", "testcases"}:
            if purpose == "testcases":
                _raw_eff = os.environ.get("OPENAI_REASONING_EFFORT_TESTCASES")
                default_effort = "high"
            else:
                _raw_eff = os.environ.get("OPENAI_REASONING_EFFORT")
                default_effort = "high"
            effort = default_effort if _raw_eff is None else str(_raw_eff).strip().lower()
            if effort in _REASONING_EFFORT_ALLOWED:
                payload["reasoning"] = {"effort": effort}
    elif route == "completions":
        url = COMPLETIONS_URL
        prompt = f"{system_prompt}\n\n{user_prompt}".strip()
        payload = {
            "model": model,
            "prompt": prompt,
        }
        if temperature != 1:
            payload["temperature"] = temperature
    else:
        url = CHAT_URL
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if temperature != 1:
            payload["temperature"] = temperature

    timeout_sec = _resolve_read_timeout_sec(purpose)
    response = _post_with_retries(url, headers, payload, timeout=timeout_sec)

    if response.status_code != 200:
        raise RuntimeError(
            f"LLM call failed: {response.status_code} - {response.text}"
        )

    data = response.json()

    if url == RESPONSES_URL:
        content = _text_from_responses_body(data)
        usage = _normalize_usage(data.get("usage") or {})
        return content, usage

    choice0 = data["choices"][0]
    if "message" in choice0:
        content = choice0["message"]["content"]
    else:
        content = choice0.get("text", "")

    usage = _normalize_usage(data.get("usage") or {})
    return content, usage
