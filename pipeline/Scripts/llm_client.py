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
  OPENAI_TESTCASES_READ_TIMEOUT_SEC — testcase generator only (default: 1800)
  Other purposes default to 300s when OPENAI_READ_TIMEOUT_SEC is unset.
"""

from __future__ import annotations

import json as _json
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

# Testcase script generation can run long (large N, reasoning models); default 30 min.
_DEFAULT_TESTCASES_TIMEOUT_SEC = 1800
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
    # Use tuple: (connect_timeout, read_timeout) so slow responses are also killed
    timeout_tuple = (30, timeout)
    last: requests.Response | None = None
    for attempt in range(max_retries):
        attempt_started = time.monotonic()
        print(
            f"[LLM] HTTP POST attempt {attempt + 1}/{max_retries} url={url} "
            f"connect_timeout=30s read_timeout={timeout}s",
            flush=True,
        )
        try:
            last = requests.post(url, headers=headers, json=payload, timeout=timeout_tuple)
        except Exception as exc:
            elapsed = time.monotonic() - attempt_started
            print(
                f"[LLM] HTTP exception after {elapsed:.1f}s on attempt {attempt + 1}: "
                f"{type(exc).__name__}: {exc}",
                flush=True,
            )
            raise
        elapsed = time.monotonic() - attempt_started
        print(
            f"[LLM] HTTP attempt {attempt + 1} returned status={last.status_code} "
            f"after {elapsed:.1f}s",
            flush=True,
        )
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


def _stream_responses_api(
    url: str, headers: dict, payload: dict, timeout: int
) -> tuple[str, dict, str | None]:
    """
    POST to the Responses API with stream=True and accumulate SSE events.

    Rationale: some PaaS providers (Render, etc.) drop long-idle HTTPS
    connections. When we call the Responses API non-streaming with
    reasoning effort=high, OpenAI holds the socket silent for many
    minutes before sending the full body in one shot — long enough for
    the egress proxy to kill the connection. Streaming keeps bytes
    flowing continuously (reasoning/progress/delta events), so the
    connection is never idle.

    Returns (text_content, usage_dict, model_name_or_None).
    Retries on transient HTTP errors before the stream starts.
    """
    streaming_payload = dict(payload)
    streaming_payload["stream"] = True

    max_retries = max(1, int(os.environ.get("OPENAI_MAX_RETRIES", "8")))
    base = float(os.environ.get("OPENAI_RETRY_BASE_SEC", "2"))
    timeout_tuple = (30, timeout)

    last_err_status: int | None = None
    last_err_body: str = ""

    for attempt in range(max_retries):
        attempt_started = time.monotonic()
        print(
            f"[LLM] streaming POST attempt {attempt + 1}/{max_retries} url={url} "
            f"connect_timeout=30s read_timeout={timeout}s",
            flush=True,
        )
        try:
            resp = requests.post(
                url,
                headers=headers,
                json=streaming_payload,
                timeout=timeout_tuple,
                stream=True,
            )
        except Exception as exc:
            elapsed = time.monotonic() - attempt_started
            print(
                f"[LLM] streaming HTTP exception after {elapsed:.1f}s on attempt "
                f"{attempt + 1}: {type(exc).__name__}: {exc}",
                flush=True,
            )
            raise

        if resp.status_code != 200:
            body_text = ""
            try:
                body_text = resp.text
            except Exception:
                pass
            try:
                resp.close()
            except Exception:
                pass
            elapsed = time.monotonic() - attempt_started
            print(
                f"[LLM] streaming attempt {attempt + 1} got status={resp.status_code} "
                f"after {elapsed:.1f}s body[:300]={body_text[:300]!r}",
                flush=True,
            )
            last_err_status = resp.status_code
            last_err_body = body_text
            if (
                attempt + 1 >= max_retries
                or resp.status_code not in _RETRYABLE_STATUS
            ):
                raise RuntimeError(
                    f"LLM streaming call failed: {resp.status_code} - {body_text[:500]}"
                )
            wait = min(base * (2**attempt), 120.0)
            if resp.status_code == 429:
                ra = resp.headers.get("Retry-After")
                if ra:
                    try:
                        wait = max(wait, float(ra))
                    except ValueError:
                        pass
            print(
                f"[LLM] streaming retrying in {wait:.1f}s "
                f"(attempt {attempt + 1}/{max_retries})",
                flush=True,
            )
            time.sleep(wait)
            continue

        # Status 200 — consume the SSE stream.
        text_parts: list[str] = []
        final_response_obj: dict | None = None
        events_seen = 0
        deltas_seen = 0
        last_log_at = time.monotonic()
        try:
            for raw_line in resp.iter_lines(chunk_size=8192, decode_unicode=True):
                if raw_line is None or raw_line == "":
                    continue
                if not raw_line.startswith("data:"):
                    # Could be "event: foo" lines — ignore, data carries the JSON.
                    continue
                data_str = raw_line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    evt = _json.loads(data_str)
                except Exception:
                    continue
                events_seen += 1
                evt_type = evt.get("type", "")
                if evt_type == "response.output_text.delta":
                    delta = evt.get("delta", "")
                    if isinstance(delta, str) and delta:
                        text_parts.append(delta)
                        deltas_seen += 1
                elif evt_type in ("response.completed", "response.done"):
                    final_response_obj = evt.get("response") or final_response_obj
                elif evt_type in (
                    "response.failed",
                    "response.error",
                    "error",
                ):
                    err = (
                        evt.get("error")
                        or (evt.get("response") or {}).get("error")
                        or evt
                    )
                    raise RuntimeError(f"Responses API stream error: {err}")
                # Periodic heartbeat log (every ~30s) so we can see progress.
                now_ts = time.monotonic()
                if now_ts - last_log_at >= 30.0:
                    print(
                        f"[LLM] streaming heartbeat: elapsed="
                        f"{now_ts - attempt_started:.1f}s events={events_seen} "
                        f"deltas={deltas_seen} chars="
                        f"{sum(len(p) for p in text_parts)}",
                        flush=True,
                    )
                    last_log_at = now_ts
        finally:
            try:
                resp.close()
            except Exception:
                pass

        total_elapsed = time.monotonic() - attempt_started
        content = "".join(text_parts).strip()
        usage: dict = {}
        model_name: str | None = None
        if final_response_obj:
            usage = final_response_obj.get("usage") or {}
            model_name = final_response_obj.get("model")
        print(
            f"[LLM] streaming completed in {total_elapsed:.1f}s "
            f"events={events_seen} deltas={deltas_seen} chars={len(content)}",
            flush=True,
        )
        return content, usage, model_name

    raise RuntimeError(
        f"LLM streaming call exhausted retries "
        f"(last_status={last_err_status}, body={last_err_body[:200]!r})"
    )


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

    # Diagnostic banner so Render logs show exactly what config the call ran with.
    _key_tail = (api_key or "")[-4:] if api_key else "----"
    _base_url_env = os.environ.get("OPENAI_BASE_URL", "")
    _global_to = os.environ.get("OPENAI_READ_TIMEOUT_SEC", "")
    _tc_to = os.environ.get("OPENAI_TESTCASES_READ_TIMEOUT_SEC", "")
    _eff_env = os.environ.get(
        "OPENAI_REASONING_EFFORT_TESTCASES" if purpose == "testcases" else "OPENAI_REASONING_EFFORT",
        "",
    )
    _api_mode = os.environ.get("OPENAI_API_MODE", "")
    _effort_in_payload = (payload.get("reasoning") or {}).get("effort") if isinstance(payload.get("reasoning"), dict) else None
    print(
        f"[LLM] starting call purpose={purpose} model={model} route={route} "
        f"effort={_effort_in_payload} timeout={timeout_sec}s key=...{_key_tail} "
        f"sys_chars={len(system_prompt)} user_chars={len(user_prompt)}",
        flush=True,
    )
    print(
        f"[LLM] env OPENAI_BASE_URL={_base_url_env!r} OPENAI_API_MODE={_api_mode!r} "
        f"OPENAI_READ_TIMEOUT_SEC={_global_to!r} OPENAI_TESTCASES_READ_TIMEOUT_SEC={_tc_to!r} "
        f"OPENAI_REASONING_EFFORT(_TESTCASES)={_eff_env!r}",
        flush=True,
    )

    _call_started = time.monotonic()

    # For the Responses API we use streaming so the socket is never idle —
    # this prevents Render/NAT/proxy from killing long reasoning calls.
    # Opt out only if OPENAI_DISABLE_STREAMING=1 is set.
    use_streaming = (
        url == RESPONSES_URL
        and os.environ.get("OPENAI_DISABLE_STREAMING", "").strip() not in ("1", "true", "yes")
    )

    # Hard wall-clock deadline: even if keep-alive bytes trickle in,
    # kill the call after timeout_sec total elapsed time.
    import threading

    response_box: list[requests.Response | None] = [None]
    stream_result_box: list[tuple[str, dict, str | None] | None] = [None]
    error_box: list[Exception | None] = [None]

    def _do_call():
        try:
            if use_streaming:
                stream_result_box[0] = _stream_responses_api(
                    url, headers, payload, timeout=timeout_sec
                )
            else:
                response_box[0] = _post_with_retries(
                    url, headers, payload, timeout=timeout_sec
                )
        except Exception as e:
            error_box[0] = e

    thread = threading.Thread(target=_do_call, daemon=True)
    thread.start()
    thread.join(timeout=timeout_sec + 30)  # extra 30s grace for retries

    if thread.is_alive():
        elapsed = time.monotonic() - _call_started
        print(
            f"[LLM] WALL-CLOCK TIMEOUT after {elapsed:.1f}s "
            f"(purpose={purpose}, model={model}, budget={timeout_sec}s)",
            flush=True,
        )
        raise RuntimeError(
            f"LLM call timed out after {timeout_sec}s wall-clock (purpose={purpose}, model={model})"
        )

    elapsed = time.monotonic() - _call_started
    if error_box[0] is not None:
        print(
            f"[LLM] raised in {elapsed:.1f}s purpose={purpose} model={model}: "
            f"{type(error_box[0]).__name__}: {error_box[0]}",
            flush=True,
        )
    elif use_streaming and stream_result_box[0] is not None:
        print(
            f"[LLM] returned in {elapsed:.1f}s (streaming) purpose={purpose} model={model}",
            flush=True,
        )
    elif response_box[0] is not None:
        print(
            f"[LLM] returned in {elapsed:.1f}s status={response_box[0].status_code} "
            f"purpose={purpose} model={model}",
            flush=True,
        )

    if error_box[0]:
        raise error_box[0]

    if use_streaming:
        assert stream_result_box[0] is not None
        content, raw_usage, streamed_model = stream_result_box[0]
        usage = _normalize_usage(raw_usage or {})
        usage["model"] = streamed_model or model
        return content, usage

    response = response_box[0]
    assert response is not None

    if response.status_code != 200:
        raise RuntimeError(
            f"LLM call failed: {response.status_code} - {response.text}"
        )

    data = response.json()

    if url == RESPONSES_URL:
        content = _text_from_responses_body(data)
        usage = _normalize_usage(data.get("usage") or {})
        usage["model"] = data.get("model") or model
        return content, usage

    choice0 = data["choices"][0]
    if "message" in choice0:
        content = choice0["message"]["content"]
    else:
        content = choice0.get("text", "")

    usage = _normalize_usage(data.get("usage") or {})
    usage["model"] = data.get("model") or model
    return content, usage
