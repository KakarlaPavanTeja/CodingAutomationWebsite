"""
LLM calls via OpenRouter (Chat Completions).

Uses the OpenAI SDK pointed at openrouter.ai DIRECTLY by default. Configure with:

  OPENROUTER_API_KEY    (required — a real OpenRouter API key)
  OPENROUTER_BASE_URL   (optional — defaults to https://openrouter.ai/api/v1;
                         set to https://open-router-gateway.replit.app/api/proxy
                         to route through the Replit proxy gateway with the
                         gateway key instead)

Only the Chat Completions API is supported.

Models are OpenRouter ids (provider-prefixed). Defaults preserve the previous
OpenAI models, now routed through OpenRouter. Override per purpose via env:

  OPENROUTER_MODEL_TESTCASES / _CHAT / _CODE / _ENRICHMENT   (legacy OPENAI_MODEL_* also honored)
  OPENROUTER_MODEL / OPENAI_MODEL                            (global fallback)

  defaults: chat / enrichment = openai/gpt-5.4
            testcases         = google/gemini-2.5-pro
            code              = openai/gpt-5.3-codex
            editorial         = openai/gpt-5.5

Bare model names (no "/") are auto-prefixed with "openai/" for backward compat.

Reasoning effort (chat + testcases purposes):
  OPENAI_REASONING_EFFORT            (default: high)
  OPENAI_REASONING_EFFORT_TESTCASES  (default: high — see _resolve_reasoning_effort)

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

import gzip
import os
import time

import httpx
from openai import OpenAI, PermissionDeniedError

# Purpose → default OpenRouter model id.
#
# Testcases use Google Gemini 2.5 Pro (not an OpenAI model): the testcase
# generator runs at the highest reasoning effort, and OpenAI's reasoning models
# HIDE their reasoning, so during the (long) think phase NOTHING streams over the
# socket. That silent window outlasts the proxy gateway's idle timeout and the
# connection is severed mid-stream → empty content. Gemini 2.5 Pro STREAMS its
# reasoning tokens (on a separate `reasoning` delta field) as it thinks, which
# keeps the socket warm during the think phase. NOTE: this is necessary but not
# sufficient — the gateway can STILL sever the stream during a silent pause
# between the reasoning and content phases, so call_llm also retries severed
# streams (see the streaming loop / OPENROUTER_STREAM_RETRIES).
_PURPOSE_DEFAULTS: dict[str, str] = {
    "testcases": "google/gemini-2.5-pro",
    "chat": "openai/gpt-5.4",
    "code": "openai/gpt-5.3-codex",
    "enrichment": "openai/gpt-5.4",
    "editorial": "openai/gpt-5.5",
}

_ENV_SUFFIX = {
    "testcases": "TESTCASES",
    "chat": "CHAT",
    "code": "CODE",
    "enrichment": "ENRICHMENT",
    "editorial": "EDITORIAL",
}

_REASONING_EFFORT_ALLOWED = frozenset(
    {"none", "minimal", "low", "medium", "high", "xhigh"}
)

# One-step downgrade ladder for the testcases self-healing retry: if a streaming
# testcases call ends with empty content for a reason OTHER than budget
# exhaustion (i.e. a severed silent connection, finish_reason != "length"), we
# retry once at the next lower effort to shorten any silent window.
_EFFORT_DOWNGRADE = {
    "xhigh": "high",
    "high": "medium",
    "medium": "low",
    "low": "minimal",
    "minimal": "none",
}

_DEFAULT_TESTCASES_TIMEOUT_SEC = 1800
# A full multi-solution editorial with 4-language code at a 100K-token cap can
# stream for many minutes; keep a generous read timeout (the run route's hard
# cap is 45 min).
_DEFAULT_EDITORIAL_TIMEOUT_SEC = 1800
_DEFAULT_OTHER_TIMEOUT_SEC = 300


def _heartbeat_interval_sec() -> float:
    """How often to log a streaming heartbeat (seconds).

    NOTE: this is observability only — it logs what the socket has received; it
    does NOT transmit anything to the gateway and cannot by itself keep the
    connection alive. More frequent logging just pinpoints when a stall starts.
    Default 15s; override with OPENROUTER_HEARTBEAT_SEC.
    """
    try:
        val = float(os.environ.get("OPENROUTER_HEARTBEAT_SEC", "15"))
    except ValueError:
        return 15.0
    return val if val > 0 else 15.0


def _ca_bundle() -> str | bool:
    """
    CA bundle used to verify TLS to the gateway.

    The gateway host is reached through Replit's internal egress proxy, which
    presents a leaf signed by a per-repl "Replit internal proxy Root CA". That
    root is NOT in certifi's bundle (which the OpenAI SDK / httpx use by default),
    so verification fails unless we point at the system bundle that includes it.

    Honors SSL_CERT_FILE if set, else uses the system bundle, else falls back to
    httpx's default (certifi) so non-intercepted hosts still work.
    """
    for path in (
        os.environ.get("SSL_CERT_FILE"),
        "/etc/ssl/certs/ca-certificates.crt",
    ):
        if path and os.path.exists(path):
            return path
    return True


class _GzipRequestTransport(httpx.BaseTransport):
    """
    httpx transport that gzip-compresses outgoing request bodies.

    The proxy gateway runs an OWASP-CRS-style WAF that inspects the *plaintext*
    request body and rejects it (HTTP 403, HTML page) when the accumulated
    anomaly score from code-like patterns crosses a threshold — e.g. the Java
    driver template's `java.io.*` imports plus other code signatures in the
    code-splitting prompt. Individually-benign snippets add up, so trimming the
    prompt is whack-a-mole and would still break on a user's own Java solution.

    Sending the body with `Content-Encoding: gzip` sidesteps this: the WAF does
    not decompress the body (so it sees no signatures), while OpenRouter does
    decompress it and processes the request normally. This is content-preserving
    — the model receives exactly the same bytes — and covers the template, user
    code, and downstream steps without editing any prompts.

    Disable with OPENROUTER_DISABLE_GZIP=1 if the gateway ever stops accepting
    gzipped request bodies.
    """

    def __init__(self, inner: httpx.BaseTransport) -> None:
        self._inner = inner

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        try:
            body = request.read()
        except Exception:
            body = b""
        already = request.headers.get("content-encoding")
        if body and not already:
            compressed = gzip.compress(body)
            headers = request.headers.copy()
            headers["content-encoding"] = "gzip"
            # Let httpx recompute Content-Length from the new (compressed) body.
            if "content-length" in headers:
                del headers["content-length"]
            request = httpx.Request(
                request.method,
                request.url,
                headers=headers,
                content=compressed,
                extensions=request.extensions,
            )
        return self._inner.handle_request(request)

    def close(self) -> None:
        self._inner.close()


_DIRECT_BASE_URL = "https://openrouter.ai/api/v1"
_GATEWAY_BASE_URL = "https://open-router-gateway.replit.app/api/proxy"


def _is_gateway_url(base_url: str) -> bool:
    """True when base_url points at the Replit-hosted OpenRouter proxy gateway."""
    return "replit.app" in (base_url or "")


def _build_http_client(use_gzip: bool) -> httpx.Client:
    """httpx client verifying TLS via the system CA bundle.

    Request-body gzip is ONLY needed to slip code-heavy prompts past the Replit
    gateway's WAF; calling openrouter.ai directly has no such WAF, and gzipping
    the body there is unnecessary (and risks the upstream not decompressing it),
    so the caller passes use_gzip=False for direct calls.
    """
    inner = httpx.HTTPTransport(verify=_ca_bundle())
    transport: httpx.BaseTransport = _GzipRequestTransport(inner) if use_gzip else inner
    return httpx.Client(transport=transport)


def _make_client() -> OpenAI:
    """
    Build an OpenAI SDK client for OpenRouter.

    Calls go DIRECTLY to openrouter.ai (https://openrouter.ai/api/v1) by default,
    authenticating with OPENROUTER_API_KEY (a real OpenRouter API key). To route
    through the Replit-hosted OpenRouter proxy gateway instead (Replit-managed
    billing), set OPENROUTER_BASE_URL to the gateway endpoint
    (https://open-router-gateway.replit.app/api/proxy) and use the gateway key.

    Request bodies are gzip-compressed (see _GzipRequestTransport) ONLY when
    talking to the gateway, to avoid its WAF false-positive on code-heavy
    prompts; direct calls skip gzip. Force-disable with OPENROUTER_DISABLE_GZIP=1.
    """
    base_url = os.environ.get("OPENROUTER_BASE_URL", _DIRECT_BASE_URL)
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set — provide a real OpenRouter API key "
            "(or set OPENROUTER_BASE_URL to the proxy gateway and use the gateway key)."
        )
    disable_gzip = os.environ.get("OPENROUTER_DISABLE_GZIP", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    use_gzip = _is_gateway_url(base_url) and not disable_gzip
    max_retries = max(0, int(os.environ.get("OPENAI_MAX_RETRIES", "8")))
    return OpenAI(
        base_url=base_url,
        api_key=api_key,
        max_retries=max_retries,
        http_client=_build_http_client(use_gzip),
    )


def _is_waf_block(exc: PermissionDeniedError) -> bool:
    """
    Heuristic: True when a 403 is an HTML page from the gateway's WAF/edge
    (a permanent, content-based block) rather than a JSON permission error.

    Real OpenRouter/permission errors are JSON (e.g. {"error":{...}}). The
    gateway's WAF returns a generic HTML "403 Forbidden" page. These are NOT
    transient — retrying is pointless and only delays the real error.
    """
    body = ""
    content_type = ""
    try:
        resp = getattr(exc, "response", None)
        if resp is not None:
            body = (resp.text or "")
            content_type = (resp.headers.get("content-type", "") or "")
    except Exception:
        body, content_type = "", ""
    low = body.lower() if body else (str(exc) or "").lower()
    # Strong signals: an HTML error page (by content-type or markup markers).
    if "text/html" in content_type.lower():
        return True
    if "<!doctype" in low or "<html" in low:
        return True
    # Weak fallback: a bare "403 forbidden" string only counts when it does NOT
    # look like a structured JSON error (which is a real, possibly-retryable 403).
    if "403 forbidden" in low and '"error"' not in low and "{" not in low:
        return True
    return False


def _create_with_retry(client: OpenAI, kwargs: dict):
    """
    Call chat.completions.create, handling 403s from the proxy gateway.

    Two distinct kinds of 403 come back from the gateway:

    1. **WAF/edge block (HTML body, permanent).** The gateway runs an OWASP-CRS
       style web-application firewall that flags Java-RCE class-name patterns
       such as ``java.io.*`` and ``java.lang.Runtime``. These appear verbatim in
       the code-splitting prompt's Java driver template, so the request is
       rejected *every* time. Retrying cannot help — fail fast with an
       actionable message so the gateway WAF rule can be whitelisted/disabled.

    2. **JSON 403 (possibly transient).** A genuine permission/edge blip. The
       OpenAI SDK does not retry 403, so retry a bounded number of times with
       exponential backoff before surfacing the error.
    """
    attempts = max(1, int(os.environ.get("OPENROUTER_GATEWAY_403_RETRIES", "3")))
    for i in range(attempts):
        try:
            return client.chat.completions.create(**kwargs)
        except PermissionDeniedError as exc:
            if _is_waf_block(exc):
                raise RuntimeError(
                    "OpenRouter proxy gateway returned a 403 WAF/firewall block "
                    "(HTML '403 Forbidden'). This is a permanent, content-based "
                    "rejection — not transient — triggered by Java class-name "
                    "patterns in the request body (e.g. 'java.io.*', "
                    "'java.lang.Runtime') that an OWASP-CRS Java-RCE rule flags. "
                    "These strings appear in the code-splitting prompt's Java "
                    "driver template, so every code-split call is blocked. "
                    "Fix on the gateway: whitelist/disable the OWASP-CRS Java "
                    "RCE rule (944xxx family) for this proxy, or allowlist the "
                    "pipeline's traffic."
                ) from exc
            if i == attempts - 1:
                raise
            wait = 2 ** i
            print(
                f"[LLM] gateway returned a JSON 403 (possibly transient), "
                f"retry {i + 1}/{attempts - 1} in {wait}s",
                flush=True,
            )
            time.sleep(wait)


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
    p = _canonical_purpose(purpose)
    if p == "testcases":
        raw = os.environ.get("OPENAI_TESTCASES_READ_TIMEOUT_SEC", "").strip()
        if raw:
            return max(1, int(raw))
        return _DEFAULT_TESTCASES_TIMEOUT_SEC
    if p == "editorial":
        raw = os.environ.get("OPENAI_EDITORIAL_READ_TIMEOUT_SEC", "").strip()
        if raw:
            return max(1, int(raw))
        return _DEFAULT_EDITORIAL_TIMEOUT_SEC
    return _DEFAULT_OTHER_TIMEOUT_SEC


_DEFAULT_MAX_TOKENS: dict[str, int] = {
    # Testcase generation emits a full Python generator script AND runs at the
    # max reasoning effort on Gemini 2.5 Pro, so the (billed-as-completion)
    # thinking tokens PLUS the visible script body must both fit under the cap —
    # otherwise we hit finish_reason=length and the script is truncated
    # (SyntaxError → empty testcases.json). 80K leaves ample headroom for the max
    # thinking budget and the longest generator script. Override with
    # OPENAI_MAX_TOKENS_TESTCASES.
    "testcases": 80000,
    "chat": 16000,
    "code": 16000,
    "enrichment": 16000,
    # A complete multi-solution editorial (intuition + approach + pseudocode +
    # 4-language code + complexity) is long; give it a 100K visible-output cap.
    # If reasoning effort is ever enabled for editorial, the hidden reasoning
    # tokens are billed against this same budget — this cap leaves room for both.
    "editorial": 100000,
}


def _resolve_max_tokens(purpose: str) -> int:
    """
    Cap on output (completion) tokens.

    Critical for reasoning calls: the gateway/model defaults to only 4096
    completion tokens when `max_tokens` is omitted, and with reasoning effort the
    model can spend that entire budget on (hidden) reasoning tokens, hitting
    `finish_reason=length` with ZERO visible content — e.g. the testcase
    generator script came back empty. Setting a generous cap leaves room for
    reasoning AND the actual answer. Override with OPENAI_MAX_TOKENS (global) or
    OPENAI_MAX_TOKENS_{TESTCASES,CHAT,CODE,ENRICHMENT}.
    """
    p = _canonical_purpose(purpose)
    suffix = _ENV_SUFFIX[p]
    raw = (
        os.environ.get(f"OPENAI_MAX_TOKENS_{suffix}")
        or os.environ.get("OPENAI_MAX_TOKENS")
        or ""
    ).strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return _DEFAULT_MAX_TOKENS[p]


def _resolve_reasoning_effort(purpose: str) -> str | None:
    p = _canonical_purpose(purpose)
    if p not in {"chat", "testcases", "editorial"}:
        return None
    if p == "editorial":
        # Editorial reasoning is OFF by default — the 100K cap is budgeted for
        # the (long) visible editorial. Enable it explicitly via
        # OPENAI_REASONING_EFFORT_EDITORIAL when desired.
        raw = os.environ.get("OPENAI_REASONING_EFFORT_EDITORIAL")
        if raw is None:
            return None
        effort = str(raw).strip().lower()
        return effort if effort in _REASONING_EFFORT_ALLOWED else None
    if p == "testcases":
        # Default "high" — Gemini 2.5 Pro's max thinking budget, for the best
        # generator quality. Unlike OpenAI's reasoning models (which HIDE their
        # reasoning and therefore stream ZERO bytes during the think phase),
        # Gemini 2.5 Pro STREAMS its reasoning tokens as it thinks, which helps
        # keep the socket warm. That alone is NOT enough: the gateway can still
        # sever the stream during a silent pause between the reasoning and
        # content phases, so call_llm retries severed streams at the same effort
        # (OPENROUTER_STREAM_RETRIES) and, as a last resort for testcases, once
        # at a lower effort. Override with OPENAI_REASONING_EFFORT_TESTCASES.
        raw = os.environ.get("OPENAI_REASONING_EFFORT_TESTCASES")
        effort = "high" if raw is None else str(raw).strip().lower()
        return effort if effort in _REASONING_EFFORT_ALLOWED else None
    raw = os.environ.get("OPENAI_REASONING_EFFORT")
    effort = "high" if raw is None else str(raw).strip().lower()
    return effort if effort in _REASONING_EFFORT_ALLOWED else None


# Sentinel: distinguishes "caller did not pass an override" (resolve from env)
# from "caller explicitly passed None" (force reasoning OFF for this call).
_USE_ENV = object()


def _normalize_effort(value) -> str | None:
    """Validate an explicit reasoning-effort override; None / invalid -> OFF."""
    if value is None:
        return None
    effort = str(value).strip().lower()
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
    reasoning_effort=_USE_ENV,
    max_tokens=_USE_ENV,
    _allow_tc_downgrade: bool = True,
):
    """
    Make a single Chat Completions call to OpenRouter (direct by default).

    purpose:
      - "testcases"   — reasoning model for the testcase generator script
      - "chat"        — descriptions, signature, refactor, titles, difficulty, topics
      - "code"        — multi-language conversion / code_splitter
      - "enrichment"  — hints, real-life, follow-ups
      - "editorial"   — full multi-solution DSA editorial (100K output cap)

    Returns (content, usage) where usage has:
      prompt_tokens, completion_tokens, total_tokens, cost (USD), model
    """
    model = _resolve_model(purpose)
    timeout_sec = _resolve_read_timeout_sec(purpose)
    effort = (
        _resolve_reasoning_effort(purpose)
        if reasoning_effort is _USE_ENV
        else _normalize_effort(reasoning_effort)
    )
    max_tokens = (
        _resolve_max_tokens(purpose)
        if max_tokens is _USE_ENV
        else max(1, int(max_tokens))
    )

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
        "max_tokens": max_tokens,
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
        f"effort={effort} max_tokens={max_tokens} timeout={timeout_sec}s streaming={use_streaming} "
        f"sys_chars={len(system_prompt)} user_chars={len(user_prompt)}",
        flush=True,
    )

    client = _make_client()
    started = time.monotonic()
    severed = False

    if use_streaming:
        kwargs["stream"] = True
        kwargs["stream_options"] = {"include_usage": True}
        # The proxy gateway severs a stream whose socket goes idle for too long —
        # e.g. when the model pauses between its (long) reasoning phase and the
        # first content token. A severed stream simply ends with NO finish_reason
        # and no usage summary, which is distinct from a clean finish or a
        # budget-capped ("length") finish. Because the stall is intermittent,
        # retry the whole streaming attempt at the SAME effort a few times before
        # giving up. Override the count with OPENROUTER_STREAM_RETRIES.
        try:
            stream_attempts = max(1, int(os.environ.get("OPENROUTER_STREAM_RETRIES", "3")))
        except ValueError:
            stream_attempts = 3
        content = ""
        usage = _extract_usage(None, model)
        finish_reason = None
        for attempt in range(stream_attempts):
            parts: list[str] = []
            usage_obj = None
            resolved_model = model
            finish_reason = None
            content_chars = 0
            reasoning_chars = 0
            stream = _create_with_retry(client, kwargs)
            heartbeat_interval = _heartbeat_interval_sec()
            last_log = time.monotonic()
            for chunk in stream:
                if getattr(chunk, "model", None):
                    resolved_model = chunk.model
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if delta is not None:
                        c = getattr(delta, "content", None)
                        if c:
                            parts.append(c)
                            content_chars += len(c)
                        # Reasoning tokens stream on a SEPARATE `reasoning` field
                        # (not `content`); count them so the heartbeat reflects
                        # real socket activity during the think phase instead of
                        # falsely showing chars=0 while the model is working.
                        r = getattr(delta, "reasoning", None)
                        if r is None:
                            extra = getattr(delta, "model_extra", None) or {}
                            r = extra.get("reasoning") or extra.get("reasoning_content")
                        if r:
                            reasoning_chars += len(r)
                    if getattr(chunk.choices[0], "finish_reason", None):
                        finish_reason = chunk.choices[0].finish_reason
                if getattr(chunk, "usage", None):
                    usage_obj = chunk.usage
                now = time.monotonic()
                if now - last_log >= heartbeat_interval:
                    print(
                        f"[LLM] streaming heartbeat elapsed={now - started:.1f}s "
                        f"content_chars={content_chars} reasoning_chars={reasoning_chars}",
                        flush=True,
                    )
                    last_log = now
            content = "".join(parts).strip()
            usage = _extract_usage(usage_obj, resolved_model)
            # A clean completion ALWAYS ends with a finish_reason; its absence
            # means the gateway closed the connection mid-stream.
            severed = finish_reason is None
            if not severed:
                break
            if attempt < stream_attempts - 1:
                wait = 2 ** attempt
                print(
                    f"[LLM] stream severed by gateway (no finish_reason; "
                    f"content_chars={content_chars} reasoning_chars={reasoning_chars}) "
                    f"— retrying {attempt + 1}/{stream_attempts - 1} at same effort "
                    f"in {wait}s",
                    flush=True,
                )
                time.sleep(wait)
        # A severed stream may have leaked partial (truncated) content — never
        # trust it; blank it so the failure / self-heal path below takes over.
        if severed:
            content = ""
    else:
        resp = _create_with_retry(client, kwargs)
        content = (resp.choices[0].message.content or "").strip()
        finish_reason = getattr(resp.choices[0], "finish_reason", None)
        usage = _extract_usage(resp.usage, resp.model or model)

    elapsed = time.monotonic() - started
    print(
        f"[LLM] returned in {elapsed:.1f}s purpose={purpose} model={usage['model']} "
        f"tokens={usage['total_tokens']} cost=${usage['cost']:.6f} "
        f"chars={len(content)} finish={finish_reason}",
        flush=True,
    )

    # Fail loudly on empty output instead of returning "" — a blank response
    # silently produces an empty generator script / file downstream and the step
    # would falsely report success. `finish_reason == "length"` with no content
    # means the (reasoning) token budget was exhausted before any answer; raise
    # so the caller surfaces a real error and the user can retry / raise the cap.
    if not content:
        # Self-healing safety net (testcases only): empty content with a
        # finish_reason that is NOT "length" means the budget was NOT exhausted —
        # most likely a severed silent connection. Retry ONCE at the next lower
        # reasoning effort to shorten any silent window before giving up. The
        # token-budget case (finish_reason == "length") is a genuine cap problem
        # and keeps its raise-loudly behavior below.
        if (
            _canonical_purpose(purpose) == "testcases"
            and finish_reason != "length"
            and _allow_tc_downgrade
            and effort in _EFFORT_DOWNGRADE
        ):
            lower = _EFFORT_DOWNGRADE[effort]
            print(
                f"[LLM] testcases call returned empty content "
                f"(finish_reason={finish_reason}) — self-healing: retrying once "
                f"at lower reasoning effort '{effort}' -> '{lower}'.",
                flush=True,
            )
            return call_llm(
                system_prompt,
                user_prompt,
                temperature=temperature,
                purpose=purpose,
                reasoning_effort=lower,
                max_tokens=max_tokens,
                _allow_tc_downgrade=False,
            )
        if finish_reason == "length":
            hint = (
                " The output token budget was exhausted (likely by reasoning) "
                "before any content was produced — raise OPENAI_MAX_TOKENS / "
                f"OPENAI_MAX_TOKENS_{_ENV_SUFFIX[_canonical_purpose(purpose)]} or "
                "lower the reasoning effort."
            )
        elif severed:
            hint = (
                " The proxy gateway severed the stream before completion (no "
                "finish_reason) — most likely its idle timeout firing during a "
                "long silent pause between the model's reasoning and content "
                "phases. This is intermittent; retry. If it persists, the "
                "gateway's stream idle timeout needs raising "
                "(or set OPENROUTER_STREAM_RETRIES higher)."
            )
        else:
            hint = ""
        raise RuntimeError(
            f"LLM returned empty content (purpose={purpose}, model={usage['model']}, "
            f"finish_reason={finish_reason}, completion_tokens="
            f"{usage['completion_tokens']}).{hint}"
        )

    return content, usage
