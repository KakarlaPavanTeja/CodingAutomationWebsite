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

## Gateway 403s are usually a WAF content block, NOT transient

The `open-router-gateway.replit.app` proxy runs an OWASP-CRS-style WAF. It
returns a **non-JSON HTML "403 Forbidden"** page (vs. real OpenRouter errors,
which are JSON like `{"error":{...}}`) when the request body contains
Java-RCE class-name signatures — confirmed blocked: `java.io.*` (File,
FileWriter, IOException, BufferedReader...) and `java.lang.Runtime`. NOT blocked:
`java.lang.management.*`, `Runtime.getRuntime().exec(...)`, generic shell/SQL/XSS
payloads. So it is a specific Java-class allowlist rule (944xxx family), not a
generic exploit scanner and not size/model/key related.

**Why it bit the pipeline:** the code-splitting system prompt
(`pipeline/Scripts/Prompts/splittingPrompt.py`) embeds a Java driver template
with five `java.io.*` imports, sent on EVERY `split_code` call regardless of
target language — so every call is blocked.

**Do NOT treat these 403s as transient / retryable.** `llm_client._is_waf_block`
detects the HTML body and fails fast with an actionable error. Bounded retry is
reserved for JSON 403s only.

**Real fix is gateway-side** (needs the gateway owner): whitelist/disable the
OWASP-CRS Java RCE rule for this proxy, or allowlist the pipeline's traffic.
Editing the prompt to dodge the signature is fragile and won't help when a
user's own Java solution legitimately uses `java.io.*`.

**Bisection method that worked:** send candidate text as a chat message with
`max_tokens=1` and check HTTP status (403 vs 200); binary-search smallest
blocking prefix, then test standalone fixed-size chunks to isolate the signature.
