"""
LLM calls via Replit AI Integrations → OpenRouter (Chat Completions).

This uses the OpenAI SDK pointed at the Replit AI gateway. The gateway is
OpenRouter-compatible and is provisioned by the `python_openrouter_ai_integrations`
blueprint, which auto-injects (no manual key needed):

  AI_INTEGRATIONS_OPENROUTER_BASE_URL
  AI_INTEGRATIONS_OPENROUTER_API_KEY   (dummy value — auth is handled by the gateway)

Charges are billed to Replit credits. Only the Chat Completions API is supported.

Models are OpenRouter ids (provider-prefixed). Defaults preserve the previous
OpenAI models, now routed through OpenRouter. Override per purpose via env:

  OPENROUTER_MODEL_TESTCASES / _CHAT / _CODE / _ENRICHMENT   (legacy OPENAI_MODEL_* also honored)
  OPENROUTER_MODEL / OPENAI_MODEL                            (global fallback)

  defaults: chat / testcases / enrichment = openai/gpt-5.4
            code                          = openai/gpt-5.3-codex

Bare model names (no "/") are auto-prefixed with "openai/" for backward compat.

Reasoning effort (chat + testcases purposes):
  OPENAI_REASONING_EFFORT            (default: high)
  OPENAI_REASONING_EFFORT_TESTCASES  (default: high)

Timeouts:
  OPENAI_READ_TIMEOUT_SEC            (global override, seconds)
  OPENAI_TESTCASES_READ_TIMEOUT_SEC  (testcases only, default 1800)
  other purposes default to 300s.

Retries: OPENAI_MAX_RETRIES (default 8) — handled by the OpenAI SDK
(429 / 5xx / connection errors with exponential backoff).

Cost: OpenRouter returns the real USD cost of each call in the response usage
object (we request it via `usage.include=true`). No local pricing table is used.
"""

from __future__ import annotations

import os
import time

from openai import OpenAI

# Purpose → default OpenRouter model id.
_PURPOSE_DEFAULTS: dict[str, str] = {
    "testcases": "openai/gpt-5.4",
    "chat": "openai/gpt-5.4",
    "code": "openai/gpt-5.3-codex",
    "enrichment": "openai/gpt-5.4",
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

_DEFAULT_TESTCASES_TIMEOUT_SEC = 1800
_DEFAULT_OTHER_TIMEOUT_SEC = 300


def _make_client() -> OpenAI:
    """
    Build an OpenAI SDK client for OpenRouter.

    Prefers the Replit AI gateway (managed integration, no own key). If those
    vars are absent, falls back to a direct OpenRouter connection using your own
    OPENROUTER_API_KEY (base url defaults to https://openrouter.ai/api/v1).
    """
    base_url = os.environ.get("AI_INTEGRATIONS_OPENROUTER_BASE_URL")
    api_key = os.environ.get("AI_INTEGRATIONS_OPENROUTER_API_KEY")
    if not (base_url and api_key):
        # Direct OpenRouter with the user's own API key.
        api_key = os.environ.get("OPENROUTER_API_KEY")
        base_url = os.environ.get(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
        )
    if not base_url or not api_key:
        raise RuntimeError(
            "No OpenRouter credentials found. Either enable the Replit OpenRouter "
            "AI integration (sets AI_INTEGRATIONS_OPENROUTER_BASE_URL / "
            "AI_INTEGRATIONS_OPENROUTER_API_KEY) or set OPENROUTER_API_KEY."
        )
    max_retries = max(0, int(os.environ.get("OPENAI_MAX_RETRIES", "8")))
    return OpenAI(base_url=base_url, api_key=api_key, max_retries=max_retries)


def _canonical_purpose(purpose: str) -> str:
    p = purpose.lower().strip()
    if p.startswith("testcases"):
        return "testcases"
    if p not in _PURPOSE_DEFAULTS:
        return "chat"
    return p


def _normalize_model(model: str) -> str:
    model = model.strip()
    # OpenRouter requires provider-prefixed ids; default bare names to OpenAI.
    return model if "/" in model else f"openai/{model}"


def _resolve_model(purpose: str) -> str:
    p = _canonical_purpose(purpose)
    suffix = _ENV_SUFFIX[p]
    model = (
        os.environ.get(f"OPENROUTER_MODEL_{suffix}")
        or os.environ.get(f"OPENAI_MODEL_{suffix}")
        or os.environ.get("OPENROUTER_MODEL")
        or os.environ.get("OPENAI_MODEL")
        or _PURPOSE_DEFAULTS[p]
    )
    return _normalize_model(model)


def _resolve_read_timeout_sec(purpose: str) -> int:
    global_override = os.environ.get("OPENAI_READ_TIMEOUT_SEC", "").strip()
    if global_override:
        return max(1, int(global_override))
    if _canonical_purpose(purpose) == "testcases":
        raw = os.environ.get("OPENAI_TESTCASES_READ_TIMEOUT_SEC", "").strip()
        if raw:
            return max(1, int(raw))
        return _DEFAULT_TESTCASES_TIMEOUT_SEC
    return _DEFAULT_OTHER_TIMEOUT_SEC


def _resolve_reasoning_effort(purpose: str) -> str | None:
    p = _canonical_purpose(purpose)
    if p not in {"chat", "testcases"}:
        return None
    if p == "testcases":
        raw = os.environ.get("OPENAI_REASONING_EFFORT_TESTCASES")
    else:
        raw = os.environ.get("OPENAI_REASONING_EFFORT")
    effort = "high" if raw is None else str(raw).strip().lower()
    return effort if effort in _REASONING_EFFORT_ALLOWED else None


def _extract_usage(usage_obj, model_name: str) -> dict:
    """Normalize the OpenRouter usage object → flat dict incl. real USD cost."""
    raw: dict = {}
    if usage_obj is not None:
        try:
            raw = usage_obj.model_dump()
        except Exception:
            raw = dict(getattr(usage_obj, "__dict__", {}) or {})
    cost = raw.get("cost")
    if cost is None:
        details = raw.get("cost_details")
        if isinstance(details, dict):
            cost = details.get("upstream_inference_cost")
    return {
        "prompt_tokens": int(raw.get("prompt_tokens") or 0),
        "completion_tokens": int(raw.get("completion_tokens") or 0),
        "total_tokens": int(raw.get("total_tokens") or 0),
        "cost": float(cost or 0.0),
        "model": model_name,
    }


def call_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 1,
    purpose: str = "chat",
):
    """
    Make a single Chat Completions call through the Replit AI (OpenRouter) gateway.

    purpose:
      - "testcases"   — reasoning model for the testcase generator script
      - "chat"        — descriptions, signature, refactor, titles, difficulty, topics
      - "code"        — multi-language conversion / code_splitter
      - "enrichment"  — hints, real-life, follow-ups

    Returns (content, usage) where usage has:
      prompt_tokens, completion_tokens, total_tokens, cost (USD), model
    """
    model = _resolve_model(purpose)
    timeout_sec = _resolve_read_timeout_sec(purpose)
    effort = _resolve_reasoning_effort(purpose)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    # Ask OpenRouter to include the real USD cost in the usage object.
    extra_body: dict = {"usage": {"include": True}}
    if effort:
        extra_body["reasoning"] = {"effort": effort}

    kwargs: dict = {
        "model": model,
        "messages": messages,
        "timeout": timeout_sec,
        "extra_body": extra_body,
    }
    if temperature != 1:
        kwargs["temperature"] = temperature

    # Stream by default so the socket is never idle on long reasoning calls
    # (large testcase generation can run many minutes). Opt out with
    # OPENAI_DISABLE_STREAMING=1.
    use_streaming = (
        os.environ.get("OPENAI_DISABLE_STREAMING", "").strip()
        not in ("1", "true", "yes")
    )

    print(
        f"[LLM] starting call purpose={purpose} model={model} "
        f"effort={effort} timeout={timeout_sec}s streaming={use_streaming} "
        f"sys_chars={len(system_prompt)} user_chars={len(user_prompt)}",
        flush=True,
    )

    client = _make_client()
    started = time.monotonic()

    if use_streaming:
        kwargs["stream"] = True
        kwargs["stream_options"] = {"include_usage": True}
        parts: list[str] = []
        usage_obj = None
        resolved_model = model
        stream = client.chat.completions.create(**kwargs)
        last_log = time.monotonic()
        for chunk in stream:
            if getattr(chunk, "model", None):
                resolved_model = chunk.model
            if chunk.choices:
                delta = chunk.choices[0].delta
                if delta is not None and getattr(delta, "content", None):
                    parts.append(delta.content)
            if getattr(chunk, "usage", None):
                usage_obj = chunk.usage
            now = time.monotonic()
            if now - last_log >= 30.0:
                print(
                    f"[LLM] streaming heartbeat elapsed={now - started:.1f}s "
                    f"chars={sum(len(p) for p in parts)}",
                    flush=True,
                )
                last_log = now
        content = "".join(parts).strip()
        usage = _extract_usage(usage_obj, resolved_model)
    else:
        resp = client.chat.completions.create(**kwargs)
        content = (resp.choices[0].message.content or "").strip()
        usage = _extract_usage(resp.usage, resp.model or model)

    elapsed = time.monotonic() - started
    print(
        f"[LLM] returned in {elapsed:.1f}s purpose={purpose} model={usage['model']} "
        f"tokens={usage['total_tokens']} cost=${usage['cost']:.6f} chars={len(content)}",
        flush=True,
    )

    return content, usage
