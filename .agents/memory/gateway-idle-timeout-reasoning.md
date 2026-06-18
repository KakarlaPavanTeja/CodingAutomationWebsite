---
name: Gateway idle-timeout vs hidden reasoning (streaming LLM calls)
description: Why long high-effort reasoning calls get their connection cut mid-stream, and the real fix (use a model that streams its reasoning).
---

Symptom: a long LLM call (e.g. testcase generation) streams with `chars=0` for
~160s, then dies with `peer closed connection without sending complete message
body (incomplete chunked read)` (or ends with empty content, `finish_reason=None`)
and the step exits 1.

**Root cause:** OpenAI reasoning models (gpt-5.x) **hide their reasoning** — during
the think phase they send NOTHING over the socket. The Replit OpenRouter proxy
gateway has an idle timeout (~160s observed) and severs a silent connection. With
`reasoning.effort=high` the silent think window exceeds that cutoff before any
visible token is produced.

**Why streaming alone does NOT help (for OpenAI):** there are no reasoning bytes to
stream; OpenAI only streams the visible answer, which doesn't begin until thinking
is done. So nothing keeps the socket "warm" during reasoning.

**The real fix: use a model that STREAMS its reasoning.** The testcase generator was
switched from `openai/gpt-5.4` to `google/gemini-2.5-pro`. Gemini emits reasoning
tokens as it thinks, so the socket stays warm even at the max thinking budget
(`reasoning.effort=high`) and the gateway never cuts it — no quality compromise.
Lowering OpenAI's effort only shortens the silence at the cost of quality, so it's a
worse lever than picking a streaming-reasoning model.

**Why:** the gateway idle timeout is Replit infra we can't change, and there is no
gateway keep-alive ping we can rely on. The durable fix is model choice, not effort
tuning or retry.

**How to apply:** for any high-effort reasoning purpose routed through this gateway,
prefer a provider that streams reasoning (Gemini) over OpenAI's hidden-reasoning
models. A self-healing net also exists in `call_llm`: testcases empty content with
`finish_reason != "length"` retries once at the next-lower effort.

**Distinct from** the empty-content/`finish_reason=length` failure (that's the output
token *budget* being eaten by reasoning → fix with `max_tokens`). That one is a real
cap problem and still raises loudly.
