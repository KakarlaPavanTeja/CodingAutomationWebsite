---
name: Replit egress proxy TLS interception
description: Why HTTPS to *.replit.app hosts fails certifi verification inside a repl and how to fix it
---

Outbound HTTPS from inside a repl to a `*.replit.app` host (e.g. an internal
proxy gateway like `open-router-gateway.replit.app`) is intercepted by Replit's
internal egress proxy. The proxy presents a leaf cert signed by a per-repl root
named `Replit internal proxy Root CA - <repl-id>`.

**Symptom:** `SSL: CERTIFICATE_VERIFY_FAILED ... unable to get local issuer
certificate`. Public hosts (openrouter.ai, api.openai.com, google) verify fine —
only the intercepted `.replit.app` host fails.

**Why:** Python's httpx (used by the OpenAI SDK and most clients) verifies
against **certifi's** bundle by default, which does NOT contain the Replit proxy
root. httpx ignores `SSL_CERT_FILE` unless you pass `verify=<path>` explicitly.

**Fix:** Verify against the **system** bundle `/etc/ssl/certs/ca-certificates.crt`
— it DOES include the Replit internal proxy root (and all public CAs). For an
OpenAI-SDK client, pass a custom client:
`OpenAI(..., http_client=httpx.Client(verify="/etc/ssl/certs/ca-certificates.crt"))`.
Prefer honoring `SSL_CERT_FILE` first, then the system bundle, then fall back to
`True` (certifi) so non-intercepted hosts still work.

**How to apply:** Any time a repl makes server-side HTTPS calls to another
Replit-hosted service via the OpenAI SDK / httpx / aiohttp, point TLS verification
at the system CA bundle, not certifi.

## Transient 403s from the gateway

The `open-router-gateway.replit.app` proxy is itself a hosted service and can
return a **non-JSON HTML "403 Forbidden"** at its edge during cold-starts or
momentary blips — distinguishable from a real OpenRouter error, which is JSON
(e.g. `{"error":{...,"code":400}}`). The OpenAI SDK does NOT retry 403, so a
single blip kills a long pipeline run. Mitigation: bounded retry-with-backoff on
`PermissionDeniedError` around `chat.completions.create`. Do not assume 403 means
a bad key/model — verify with a direct probe first; the model allowlist includes
gpt-5.4 and gpt-5.3-codex.
