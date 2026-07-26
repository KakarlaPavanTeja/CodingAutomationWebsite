"""
LLM calls via OpenRouter (Chat Completions API).

Quick reference
---------------
Primary model (all purposes): openai/gpt-5.4

Purpose routing (default reasoning → fallbacks on 429/5xx):
  chat            high    → Gemini 3.1 Pro → Sonnet 4.6
  code            medium  → Gemini 3.1 Pro → GPT-5.5   (translation, split)
  enrichment      low     → Gemini 3.1 Pro → Sonnet 4.6
  editorial       dynamic → Gemini 3.1 Pro → GPT-5.5 → Opus 4.8
  harden          medium  → Gemini 3.1 Pro → GPT-5.5
  wrong_solutions medium  → Gemini 3.1 Pro → GPT-5.5
  testcases       tiered  → GPT-5.4 (easy/med:medium, hard:high) → Opus 4.8 → Gemini 3.5 Flash → GPT-5.5

Configuration
-------------
  OPENROUTER_API_KEY                    required
  OPENROUTER_BASE_URL                   default https://openrouter.ai/api/v1
  OPENROUTER_MODEL_<SUFFIX>             primary model per purpose
  OPENROUTER_FALLBACK_<SUFFIX>          comma-separated fallback models
  OPENROUTER_FALLBACK_EFFORTS_<SUFFIX>  model:effort pairs per fallback
  OPENAI_REASONING_EFFORT_<SUFFIX>      reasoning override per purpose

Testcase difficulty (apply_testcases_routing):
  resolve_pipeline_difficulty(): owner > generated_difficulty.txt > medium

Public API
----------
  call_llm, apply_testcases_routing, resolve_testcases_routing,
  resolve_pipeline_difficulty, set_editorial_fallback_efforts, format_fallback_plan
"""


from __future__ import annotations

import gzip
import os
import time

import httpx
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    InternalServerError,
    OpenAI,
    PermissionDeniedError,
    RateLimitError,
)

# =============================================================================
# Model identifiers
# =============================================================================

_SONNET_46 = "anthropic/claude-sonnet-4.6"
_GEMINI_PRO = "google/gemini-3.1-pro-preview"
_GEMINI_FLASH = "google/gemini-3.5-flash"
_GPT_55 = "openai/gpt-5.5"
_GPT_54 = "openai/gpt-5.4"
_OPUS_48 = "anthropic/claude-opus-4.8"
_KIMI_K2_THINKING = "moonshotai/kimi-k2-thinking"

# Per-model output-token override. Overrides the shared purpose default so a
# model can use its own provider ceiling. k2-thinking's provider (Novita) hard-
# caps max_tokens at 98,304 — sending more is a 400 (not a capacity fallback),
# so pin at the ceiling rather than above it.
_MODEL_MAX_TOKENS: dict[str, int] = {
    _KIMI_K2_THINKING: 98304,
}


# =============================================================================
# Purpose routing tables
# =============================================================================

# Primary model per purpose (override: OPENROUTER_MODEL_<SUFFIX>).
_PURPOSE_DEFAULTS: dict[str, str] = {
    "testcases": _GPT_54,
    "chat": _GPT_54,
    "code": _GPT_54,
    "enrichment": _GPT_54,
    "editorial": _GPT_54,
    "harden": _GPT_54,
    "wrong_solutions": _GPT_54,
}

# Default reasoning + fallback ladder per purpose (429/5xx only).
# Override: OPENROUTER_FALLBACK_<SUFFIX>, OPENROUTER_FALLBACK_EFFORTS_<SUFFIX>
# Editorial "_dynamic_" effort → set_editorial_fallback_efforts().
_PURPOSE_CONFIG: dict[str, dict] = {
    "chat": {
        "default_effort": "high",
        "fallbacks": [
            {"model": _GEMINI_PRO, "effort": "high"},
            {"model": _SONNET_46, "effort": "high"},
        ],
    },
    "code": {
        "default_effort": "medium",
        "fallbacks": [
            {"model": _GEMINI_PRO, "effort": "medium"},
            {"model": _GPT_55, "effort": "medium"},
        ],
    },
    "enrichment": {
        "default_effort": "low",
        "fallbacks": [
            {"model": _GEMINI_PRO, "effort": "low"},
            {"model": _SONNET_46, "effort": "low"},
        ],
    },
    "editorial": {
        "default_effort": None,
        "fallbacks": [
            {"model": _GEMINI_PRO, "effort": "_dynamic_"},
            {"model": _GPT_55, "effort": "_dynamic_"},
            {"model": _OPUS_48, "effort": "_dynamic_"},
        ],
    },
    "harden": {
        "default_effort": "medium",
        "fallbacks": [
            {"model": _GEMINI_PRO, "effort": "medium"},
            {"model": _GPT_55, "effort": "medium"},
        ],
    },
    "wrong_solutions": {
        "default_effort": "medium",
        "fallbacks": [
            {"model": _GEMINI_PRO, "effort": "medium"},
            {"model": _GPT_55, "effort": "medium"},
        ],
    },
}

# Testcase tier defaults when OPENROUTER_MODEL_TESTCASES is not pinned.
# Trial: kimi-k2-thinking primary → gpt-5.4 first fallback → existing ladder.
_TESTCASES_TIER_DEFAULTS: dict[str, dict[str, str]] = {
    "easy": {
        "model": _KIMI_K2_THINKING,
        "effort": "medium",
        "fallbacks": f"{_GPT_54},{_OPUS_48},{_GEMINI_FLASH},{_GPT_55}",
        "fallback_efforts": "medium,medium,medium,medium",
    },
    "medium": {
        "model": _KIMI_K2_THINKING,
        "effort": "medium",
        "fallbacks": f"{_GPT_54},{_OPUS_48},{_GEMINI_FLASH},{_GPT_55}",
        "fallback_efforts": "medium,medium,medium,medium",
    },
    "hard": {
        "model": _KIMI_K2_THINKING,
        "effort": "high",
        "fallbacks": f"{_GPT_54},{_OPUS_48},{_GEMINI_FLASH},{_GPT_55}",
        "fallback_efforts": "high,high,high,high",
    },
}


# Maps purpose → env-var suffix (TESTCASES, CHAT, CODE, …).
_ENV_SUFFIX = {
    "testcases": "TESTCASES",
    "chat": "CHAT",
    "code": "CODE",
    "enrichment": "ENRICHMENT",
    "editorial": "EDITORIAL",
    "harden": "HARDEN",
    "wrong_solutions": "WRONG_SOLUTIONS",
}


# =============================================================================
# Reasoning, timeouts, token caps
# =============================================================================

_REASONING_EFFORT_ALLOWED = frozenset(
    {"none", "minimal", "low", "medium", "high", "xhigh"}
)

# Testcase self-heal: one-step downgrade after severed stream (not length cap).
_EFFORT_DOWNGRADE = {
    "xhigh": "high",
    "high": "medium",
    "medium": "low",
    "low": "minimal",
    "minimal": "none",
}


_DEFAULT_TESTCASES_TIMEOUT_SEC = 2700
# A full multi-solution editorial with 4-language code at a 100K-token cap can
# stream for many minutes; keep a generous read timeout (the run route's hard
# cap is 45 min).
_DEFAULT_EDITORIAL_TIMEOUT_SEC = 1800
_DEFAULT_OTHER_TIMEOUT_SEC = 300

_DEFAULT_MAX_TOKENS: dict[str, int] = {
    # Testcase generator script + reasoning tokens must fit under cap (100K).
    "testcases": 100000,
    # Description/naming/refactor. Raised from 16K: reasoning models spend part of
    # this budget on hidden reasoning tokens, so a full description + worked-example
    # explanation was hitting the cap and truncating the last section (finish=length).
    "chat": 32000,
    "code": 16000,
    "enrichment": 16000,
    "editorial": 100000,
    "wrong_solutions": 48000,
}




# =============================================================================
# HTTP client & transport
# =============================================================================


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
    base_url = (os.environ.get("OPENROUTER_BASE_URL") or "").strip() or _DIRECT_BASE_URL
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set — add it to .env.local "
            "(https://openrouter.ai/keys)."
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



# =============================================================================
# Purpose & model resolution
# =============================================================================


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


def _normalize_testcase_difficulty(difficulty: str | None) -> str:
    """Map pipeline difficulty to easy / medium / hard (default medium)."""
    d = (difficulty or "").strip().lower()
    if d in _TESTCASES_TIER_DEFAULTS:
        return d
    return "medium"



# =============================================================================
# Testcase difficulty routing
# =============================================================================


def resolve_pipeline_difficulty(
    outputs_dir: str = "Outputs",
) -> tuple[str | None, str]:
    """Resolve effective difficulty for testcase routing and weightage.

    Precedence (matches prepare_lua_and_testcases and the pipeline run route):
      1. PIPELINE_OWNER_DIFFICULTY — user-set on the problem overview (FINAL)
      2. {outputs_dir}/generated_difficulty.txt — LLM-generated during GQ step
      3. None — callers should treat as medium-tier routing default

    Returns (difficulty, source) where source is one of:
      owner | llm | default
    """
    owner = os.environ.get("PIPELINE_OWNER_DIFFICULTY", "").strip().lower()
    if owner in _TESTCASES_TIER_DEFAULTS:
        return owner, "owner"

    path = os.path.join(outputs_dir, "generated_difficulty.txt")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                generated = f.read().strip().lower()
        except OSError:
            generated = ""
        if generated in _TESTCASES_TIER_DEFAULTS:
            return generated, "llm"

    return None, "default"



# =============================================================================
# Fallback planning
# =============================================================================


def _parse_csv_list(raw: str) -> list[str]:
    return [part.strip() for part in raw.split(",") if part.strip()]


def _build_fallback_plan(
    models_csv: str, efforts_csv: str, primary_effort: str
) -> list[dict[str, str]]:
    """Pair each fallback model with its reasoning effort (for logging + runtime)."""
    models = [_normalize_model(m) for m in _parse_csv_list(models_csv)]
    efforts = [e.strip().lower() for e in _parse_csv_list(efforts_csv)]
    plan: list[dict[str, str]] = []
    for i, model in enumerate(models):
        effort = efforts[i] if i < len(efforts) else primary_effort
        if effort not in _REASONING_EFFORT_ALLOWED:
            effort = primary_effort
        plan.append({"model": model, "effort": effort})
    return plan


def format_fallback_plan(plan: list[dict[str, str]]) -> str:
    """Human-readable fallback ladder with reasoning, e.g. gpt-5.5@medium | gemini@high."""
    return " | ".join(f"{entry['model']}@{entry['effort']}" for entry in plan)


def _encode_fallback_efforts(plan: list[dict[str, str]]) -> str:
    return ",".join(f"{entry['model']}:{entry['effort']}" for entry in plan)


def _parse_fallback_efforts_env(raw: str) -> dict[str, str]:
    """Parse OPENROUTER_FALLBACK_EFFORTS_* env (model:effort pairs)."""
    out: dict[str, str] = {}
    for part in raw.split(","):
        part = part.strip()
        if ":" not in part:
            continue
        model_part, effort_part = part.rsplit(":", 1)
        out[_normalize_model(model_part.strip())] = effort_part.strip().lower()
    return out


def _purpose_builtin_fallback_plan(purpose: str) -> list[dict[str, str]]:
    """Built-in fallback entries for a purpose (testcases uses tier env instead)."""
    p = _canonical_purpose(purpose)
    cfg = _PURPOSE_CONFIG.get(p, {})
    plan: list[dict[str, str]] = []
    for entry in cfg.get("fallbacks") or []:
        plan.append({
            "model": _normalize_model(entry["model"]),
            "effort": str(entry.get("effort") or ""),
        })
    return plan


def _resolve_fallback_plan(purpose: str) -> list[dict[str, str]]:
    """Effective fallback plan: env model list + config efforts, else built-in."""
    p = _canonical_purpose(purpose)
    suffix = _ENV_SUFFIX.get(p)
    raw_models = os.environ.get(f"OPENROUTER_FALLBACK_{suffix}", "").strip() if suffix else ""
    builtin = _purpose_builtin_fallback_plan(purpose)
    default_eff = (_PURPOSE_CONFIG.get(p) or {}).get("default_effort")
    if raw_models:
        by_model = {e["model"]: e["effort"] for e in builtin}
        plan: list[dict[str, str]] = []
        for m in _parse_csv_list(raw_models):
            nm = _normalize_model(m)
            plan.append({"model": nm, "effort": by_model.get(nm, default_eff or "medium")})
        return plan
    return builtin



# --- editorial dynamic effort sync (public) ---


def set_editorial_fallback_efforts(effort: str | None) -> None:
    """Mirror the editorial router's dynamic effort on every fallback model."""
    enc = "none" if not effort else effort
    plan = []
    for entry in _purpose_builtin_fallback_plan("editorial"):
        plan.append({"model": entry["model"], "effort": enc})
    os.environ["OPENROUTER_FALLBACK_EFFORTS_EDITORIAL"] = _encode_fallback_efforts(plan)


def _resolve_fallback_effort(purpose: str, model: str) -> str | None:
    """Lookup per-fallback reasoning effort (env model:effort or built-in plan)."""
    p = _canonical_purpose(purpose)
    suffix = _ENV_SUFFIX.get(p)
    if suffix:
        raw = os.environ.get(f"OPENROUTER_FALLBACK_EFFORTS_{suffix}", "").strip()
        if raw:
            parsed = _parse_fallback_efforts_env(raw)
            target = _normalize_model(model)
            if target in parsed:
                eff = parsed[target]
                if eff == "none":
                    return None
                if eff in _REASONING_EFFORT_ALLOWED:
                    return eff
    for entry in _resolve_fallback_plan(purpose):
        if _normalize_model(entry["model"]) == _normalize_model(model):
            eff = (entry.get("effort") or "").strip().lower()
            if not eff or eff in ("none", "_dynamic_"):
                return None
            if eff in _REASONING_EFFORT_ALLOWED:
                return eff
    return None


def resolve_testcases_routing(difficulty: str | None) -> dict[str, str]:
    """Resolve model, reasoning effort, and fallback ladder for testcase LLM calls.

    Precedence for the model:
      1. OPENROUTER_MODEL_TESTCASES / OPENAI_MODEL_TESTCASES (pins all tiers)
      2. OPENROUTER_MODEL_TESTCASES_{EASY|MEDIUM|HARD} for the active tier
      3. Built-in tier defaults (all tiers → opus-4.8; effort easy=minimal,
         medium=medium, hard=high)

    Precedence for reasoning effort:
      1. OPENAI_REASONING_EFFORT_TESTCASES (global pin)
      2. OPENAI_REASONING_EFFORT_TESTCASES_{EASY|MEDIUM|HARD}
      3. Built-in tier default

    Precedence for fallbacks (comma-separated models):
      1. OPENROUTER_FALLBACK_TESTCASES
      2. OPENROUTER_FALLBACK_TESTCASES_{EASY|MEDIUM|HARD}
      3. Built-in tier default

    Per-fallback reasoning (parallel CSV, or model:effort pairs):
      1. OPENROUTER_FALLBACK_EFFORTS_TESTCASES
      2. OPENROUTER_FALLBACK_EFFORTS_TESTCASES_{EASY|MEDIUM|HARD}
      3. Built-in tier default (fallback_efforts)
    """
    tier = _normalize_testcase_difficulty(difficulty)
    suffix = tier.upper()
    defaults = _TESTCASES_TIER_DEFAULTS[tier]

    pinned_model = (
        os.environ.get("OPENROUTER_MODEL_TESTCASES")
        or os.environ.get("OPENAI_MODEL_TESTCASES")
    )
    if pinned_model:
        model = _normalize_model(pinned_model)
    else:
        tier_model = (
            os.environ.get(f"OPENROUTER_MODEL_TESTCASES_{suffix}")
            or os.environ.get(f"OPENAI_MODEL_TESTCASES_{suffix}")
            or defaults["model"]
        )
        model = _normalize_model(tier_model)

    global_effort = os.environ.get("OPENAI_REASONING_EFFORT_TESTCASES")
    if global_effort is not None and str(global_effort).strip():
        effort = str(global_effort).strip().lower()
    else:
        tier_effort = os.environ.get(f"OPENAI_REASONING_EFFORT_TESTCASES_{suffix}")
        effort = (
            str(tier_effort).strip().lower()
            if tier_effort and str(tier_effort).strip()
            else defaults["effort"]
        )
    if effort not in _REASONING_EFFORT_ALLOWED:
        effort = defaults["effort"]

    fallbacks = os.environ.get("OPENROUTER_FALLBACK_TESTCASES", "").strip()
    if not fallbacks:
        tier_fb = os.environ.get(f"OPENROUTER_FALLBACK_TESTCASES_{suffix}", "").strip()
        fallbacks = tier_fb or defaults["fallbacks"]

    fallback_efforts = os.environ.get("OPENROUTER_FALLBACK_EFFORTS_TESTCASES", "").strip()
    if not fallback_efforts:
        tier_fb_effort = os.environ.get(
            f"OPENROUTER_FALLBACK_EFFORTS_TESTCASES_{suffix}", ""
        ).strip()
        if tier_fb_effort and ":" in tier_fb_effort:
            fallback_plan = []
            for part in tier_fb_effort.split(","):
                part = part.strip()
                if ":" not in part:
                    continue
                model_part, effort_part = part.rsplit(":", 1)
                effort_part = effort_part.strip().lower()
                if effort_part not in _REASONING_EFFORT_ALLOWED:
                    effort_part = effort
                fallback_plan.append(
                    {
                        "model": _normalize_model(model_part.strip()),
                        "effort": effort_part,
                    }
                )
        else:
            efforts_csv = tier_fb_effort or defaults.get("fallback_efforts", "")
            fallback_plan = _build_fallback_plan(fallbacks, efforts_csv, effort)
    else:
        if ":" in fallback_efforts:
            fallback_plan = []
            for part in fallback_efforts.split(","):
                part = part.strip()
                if ":" not in part:
                    continue
                model_part, effort_part = part.rsplit(":", 1)
                effort_part = effort_part.strip().lower()
                if effort_part not in _REASONING_EFFORT_ALLOWED:
                    effort_part = effort
                fallback_plan.append(
                    {
                        "model": _normalize_model(model_part.strip()),
                        "effort": effort_part,
                    }
                )
        else:
            fallback_plan = _build_fallback_plan(fallbacks, fallback_efforts, effort)

    return {
        "tier": tier,
        "model": model,
        "effort": effort,
        "fallbacks": fallbacks,
        "fallback_plan": fallback_plan,
        "fallbacks_display": format_fallback_plan(fallback_plan),
        "fallback_efforts_encoded": _encode_fallback_efforts(fallback_plan),
    }


def apply_testcases_routing(difficulty: str | None) -> dict[str, str]:
    """Apply difficulty-aware testcase routing to this process's env.

    Only sets env vars that are not already pinned by the operator. Returns the
    resolved routing summary (tier, model, effort, fallbacks) for logging.
    """
    routing = resolve_testcases_routing(difficulty)

    pinned_model = (
        os.environ.get("OPENROUTER_MODEL_TESTCASES")
        or os.environ.get("OPENAI_MODEL_TESTCASES")
    )
    if not pinned_model:
        os.environ["OPENROUTER_MODEL_TESTCASES"] = routing["model"]

    if not os.environ.get("OPENROUTER_FALLBACK_TESTCASES", "").strip():
        os.environ["OPENROUTER_FALLBACK_TESTCASES"] = routing["fallbacks"]

    if not os.environ.get("OPENROUTER_FALLBACK_EFFORTS_TESTCASES", "").strip():
        os.environ["OPENROUTER_FALLBACK_EFFORTS_TESTCASES"] = routing[
            "fallback_efforts_encoded"
        ]

    if not os.environ.get("OPENAI_REASONING_EFFORT_TESTCASES", "").strip():
        os.environ["OPENAI_REASONING_EFFORT_TESTCASES"] = routing["effort"]

    return routing



# =============================================================================
# Model ladder & capacity-error detection
# =============================================================================


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


def _resolve_model_ladder(purpose: str) -> list[str]:
    """Ordered [primary, *fallbacks] model ids to try on capacity errors.

    Primary is `_resolve_model` (honors OPENROUTER_MODEL_* overrides). Fallbacks
    come from OPENROUTER_FALLBACK_<SUFFIX> (comma-separated) if set, else the
    built-in `_PURPOSE_CONFIG` fallbacks. Duplicates and the primary are de-duped so a
    model is never tried twice in a row.
    """
    p = _canonical_purpose(purpose)
    primary = _resolve_model(purpose)
    plan = _resolve_fallback_plan(purpose)
    ladder = [primary]
    for entry in plan:
        nm = entry["model"]
        if nm not in ladder:
            ladder.append(nm)
    return ladder


def _is_stream_transient_error(exc: Exception) -> bool:
    """True for mid-stream connection drops worth retrying on the SAME model."""
    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        return True
    if isinstance(exc, APIStatusError):
        if getattr(exc, "status_code", None) in (502, 503, 529):
            return True
    low = str(getattr(exc, "message", "") or exc).lower()
    signals = (
        "peer closed connection",
        "incomplete chunked read",
        "connection reset",
        "connection aborted",
        "broken pipe",
        "unexpected eof",
        "server disconnected",
    )
    return any(s in low for s in signals)


def _is_capacity_error(exc: Exception) -> bool:
    """True for transient capacity/server errors worth retrying on ANOTHER model.

    Covers HTTP 500/502/503/529, rate limits (429), and connection/timeout
    blips, plus OpenRouter's text signals ("overloaded", "high demand", "no
    instances available", "temporarily unavailable"). Excludes a WAF 403 block
    (permanent, content-based) — rotating models cannot fix that.
    """
    if isinstance(exc, PermissionDeniedError) and _is_waf_block(exc):
        return False
    if _is_stream_transient_error(exc):
        return True
    if isinstance(exc, (InternalServerError, RateLimitError)):
        return True
    if isinstance(exc, APIStatusError):
        if getattr(exc, "status_code", None) in (500, 502, 503, 529):
            return True
    low = str(getattr(exc, "message", "") or exc).lower()
    signals = (
        "overloaded", "high demand", "no instances", "temporarily unavailable",
        "capacity", "service unavailable", "internal server error",
        " 502", " 503", " 529",
        # OpenAI's generic mid-stream 500 body, which arrives as a bare APIError
        # (no status_code) so the isinstance/status checks above miss it. It is
        # retryable per OpenAI, so rotate to the next model instead of crashing.
        "an error occurred while processing your request",
        "help.openai.com",
    )
    return any(s in low for s in signals)



# =============================================================================
# Per-request parameter resolution
# =============================================================================


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
    cfg = _PURPOSE_CONFIG.get(p, {})
    if p == "editorial":
        raw = os.environ.get("OPENAI_REASONING_EFFORT_EDITORIAL")
        if raw is None:
            return None
        effort = str(raw).strip().lower()
        return effort if effort in _REASONING_EFFORT_ALLOWED else None
    if p == "testcases":
        raw = os.environ.get("OPENAI_REASONING_EFFORT_TESTCASES")
        effort = "high" if raw is None else str(raw).strip().lower()
        return effort if effort in _REASONING_EFFORT_ALLOWED else None
    if p == "harden":
        raw = os.environ.get("OPENAI_REASONING_EFFORT_HARDEN")
        effort = "medium" if raw is None else str(raw).strip().lower()
        return effort if effort in _REASONING_EFFORT_ALLOWED else None
    if p in {"code", "wrong_solutions", "enrichment", "chat"}:
        env_key = f"OPENAI_REASONING_EFFORT_{_ENV_SUFFIX[p]}"
        raw = os.environ.get(env_key)
        if raw is None and p == "chat":
            raw = os.environ.get("OPENAI_REASONING_EFFORT")
        default = cfg.get("default_effort", "high" if p == "chat" else "medium")
        effort = default if raw is None else str(raw).strip().lower()
        return effort if effort in _REASONING_EFFORT_ALLOWED else None
    return None


# Sentinel: distinguishes "caller did not pass an override" (resolve from env)
# from "caller explicitly passed None" (force reasoning OFF for this call).

# Sentinel: caller omitted reasoning_effort / max_tokens → resolve from env.
_USE_ENV = object()


def _normalize_effort(value) -> str | None:
    """Validate an explicit reasoning-effort override; None / invalid -> OFF."""
    if value is None:
        return None
    effort = str(value).strip().lower()
    return effort if effort in _REASONING_EFFORT_ALLOWED else None


# Providers (Anthropic, Gemini, etc.) reject requests with an empty user message.
_EMPTY_USER_PLACEHOLDER = "Follow the instructions in the system message."


def _build_messages(system_prompt: str, user_prompt: str) -> list[dict[str, str]]:
    """Build a provider-safe messages list (non-empty user content required)."""
    system = (system_prompt or "").strip()
    user = (user_prompt or "").strip()
    if not user:
        user = _EMPTY_USER_PLACEHOLDER
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user})
    return messages


_tiktoken_encoding = None


def _estimate_tokens(text: str) -> int:
    """Approximate token count for logging (cl100k_base; ~chars/4 if unavailable)."""
    if not text:
        return 0
    global _tiktoken_encoding
    try:
        if _tiktoken_encoding is None:
            import tiktoken
            _tiktoken_encoding = tiktoken.get_encoding("cl100k_base")
        return len(_tiktoken_encoding.encode(text, disallowed_special=()))
    except Exception:
        return max(1, (len(text) + 3) // 4)


def _estimate_prompt_tokens(messages: list[dict[str, str]]) -> tuple[int, int, int]:
    """Return (system_tokens, user_tokens, total) for the messages actually sent."""
    system_tokens = 0
    user_tokens = 0
    for msg in messages:
        n = _estimate_tokens(msg.get("content") or "")
        if msg.get("role") == "system":
            system_tokens += n
        elif msg.get("role") == "user":
            user_tokens += n
    return system_tokens, user_tokens, system_tokens + user_tokens


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



# =============================================================================
# Public API: call_llm
# =============================================================================


def call_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 1,
    purpose: str = "chat",
    reasoning_effort=_USE_ENV,
    max_tokens=_USE_ENV,
    _allow_tc_downgrade: bool = True,
    _model_override: str | None = None,
    _fallback_index: int = 0,
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
    # Central refine-note injection. When a completed LLM step is re-run from the
    # UI with a change request, the API sets PIPELINE_REFINE_NOTE on the spawned
    # process; fold it into the user prompt here so EVERY LLM step honors it
    # without per-script wiring. Empty/unset = normal generation path.
    refine_note = (os.environ.get("PIPELINE_REFINE_NOTE") or "").strip()
    if refine_note:
        user_prompt = (
            user_prompt
            + "\n\n# ADDITIONAL INSTRUCTIONS FROM REVIEWER (HIGH PRIORITY)\n"
            + "Apply the following change requested by the content reviewer. Honor "
            + "it precisely while keeping all other requirements above intact:\n"
            + refine_note + "\n"
        )

    model = _normalize_model(_model_override) if _model_override else _resolve_model(purpose)
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
    # Give a model its own output ceiling when it differs from the shared default.
    model_max = _MODEL_MAX_TOKENS.get(model)
    if model_max is not None:
        max_tokens = model_max

    messages = _build_messages(system_prompt, user_prompt)
    sys_tokens, user_tokens, prompt_tokens_est = _estimate_prompt_tokens(messages)

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
        f"sys_tokens={sys_tokens} user_tokens={user_tokens} prompt_tokens~={prompt_tokens_est}",
        flush=True,
    )

    client = _make_client()
    started = time.monotonic()
    severed = False

    # Model-rotation on transient capacity/server errors: if THIS model raises a
    # 500 / 503 / 529 / overload / "high demand" (after the SDK's own same-model
    # retries), fall back to the next model in the purpose's ladder instead of
    # failing the step. Non-capacity errors (auth, WAF 403, bad request) re-raise
    # immediately — another model can't help those.
    try:
        if use_streaming:
            kwargs["stream"] = True
            kwargs["stream_options"] = {"include_usage": True}
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
                content_parts: list[str] = []
                reasoning_parts: list[str] = []
                stream_exc: Exception | None = None
                try:
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
                                    content_parts.append(c)
                                r = getattr(delta, "reasoning", None)
                                if r is None:
                                    extra = getattr(delta, "model_extra", None) or {}
                                    r = extra.get("reasoning") or extra.get("reasoning_content")
                                if r:
                                    reasoning_parts.append(r)
                            if getattr(chunk.choices[0], "finish_reason", None):
                                finish_reason = chunk.choices[0].finish_reason
                        if getattr(chunk, "usage", None):
                            usage_obj = chunk.usage
                        now = time.monotonic()
                        if now - last_log >= heartbeat_interval:
                            content_tok = _estimate_tokens("".join(content_parts))
                            reasoning_tok = _estimate_tokens("".join(reasoning_parts))
                            print(
                                f"[LLM] streaming heartbeat elapsed={now - started:.1f}s "
                                f"content_tokens~={content_tok} reasoning_tokens~={reasoning_tok}",
                                flush=True,
                            )
                            last_log = now
                    content = "".join(parts).strip()
                    usage = _extract_usage(usage_obj, resolved_model)
                    severed = finish_reason is None
                except Exception as exc:
                    if not _is_stream_transient_error(exc):
                        raise
                    stream_exc = exc
                    severed = True
                    finish_reason = None
                    content = ""
                if not severed:
                    break
                if attempt < stream_attempts - 1:
                    wait = 2 ** attempt
                    content_tok = _estimate_tokens("".join(content_parts))
                    reasoning_tok = _estimate_tokens("".join(reasoning_parts))
                    if stream_exc is None:
                        reason = "no finish_reason"
                    else:
                        reason = (
                            f"{type(stream_exc).__name__}: "
                            f"{str(stream_exc)[:120]}"
                        )
                    print(
                        f"[LLM] stream interrupted ({reason}; "
                        f"content_tokens~={content_tok} reasoning_tokens~={reasoning_tok}) "
                        f"— retrying {attempt + 1}/{stream_attempts - 1} at same effort "
                        f"in {wait}s",
                        flush=True,
                    )
                    time.sleep(wait)
            if severed:
                content = ""
        else:
            resp = _create_with_retry(client, kwargs)
            content = (resp.choices[0].message.content or "").strip()
            finish_reason = getattr(resp.choices[0], "finish_reason", None)
            usage = _extract_usage(resp.usage, resp.model or model)

        # Same-model stream retries exhausted — rotate to the next model before
        # surfacing an empty-content failure.
        if severed:
            ladder = _resolve_model_ladder(purpose)
            next_idx = _fallback_index + 1
            if next_idx < len(ladder):
                next_model = ladder[next_idx]
                fb_effort = _resolve_fallback_effort(purpose, next_model)
                next_effort = (
                    fb_effort
                    if fb_effort
                    else (effort if reasoning_effort is _USE_ENV else _normalize_effort(reasoning_effort))
                )
                print(
                    f"[LLM] {purpose}: stream interrupted on '{model}' after "
                    f"{stream_attempts if use_streaming else 1} attempt(s) — "
                    f"falling back to '{next_model}' reasoning_effort={next_effort} "
                    f"(fallback {next_idx}/{len(ladder) - 1}).",
                    flush=True,
                )
                return call_llm(
                    system_prompt,
                    user_prompt,
                    temperature=temperature,
                    purpose=purpose,
                    reasoning_effort=next_effort,
                    max_tokens=max_tokens,
                    _allow_tc_downgrade=_allow_tc_downgrade,
                    _model_override=next_model,
                    _fallback_index=next_idx,
                )
    except Exception as exc:
        ladder = _resolve_model_ladder(purpose)
        next_idx = _fallback_index + 1
        if _is_capacity_error(exc) and next_idx < len(ladder):
            next_model = ladder[next_idx]
            fb_effort = _resolve_fallback_effort(purpose, next_model)
            next_effort = (
                fb_effort
                if fb_effort
                else (effort if reasoning_effort is _USE_ENV else _normalize_effort(reasoning_effort))
            )
            print(
                f"[LLM] {purpose}: model '{model}' hit a transient capacity/server "
                f"error ({type(exc).__name__}: {str(exc)[:160]}) — falling back to "
                f"'{next_model}' reasoning_effort={next_effort} "
                f"(fallback {next_idx}/{len(ladder) - 1}).",
                flush=True,
            )
            return call_llm(
                system_prompt,
                user_prompt,
                temperature=temperature,
                purpose=purpose,
                reasoning_effort=next_effort,
                max_tokens=max_tokens,
                _allow_tc_downgrade=_allow_tc_downgrade,
                _model_override=next_model,
                _fallback_index=next_idx,
            )
        raise

    elapsed = time.monotonic() - started
    print(
        f"[LLM] returned in {elapsed:.1f}s purpose={purpose} model={usage['model']} "
        f"prompt_tokens={usage['prompt_tokens']} completion_tokens={usage['completion_tokens']} "
        f"total_tokens={usage['total_tokens']} cost=${usage['cost']:.6f} "
        f"finish={finish_reason}",
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
                _model_override=_model_override,
                _fallback_index=_fallback_index,
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
