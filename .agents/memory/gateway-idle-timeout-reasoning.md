---
name: Gateway idle-timeout vs hidden reasoning (streaming LLM calls)
description: Why long high-effort reasoning calls get their connection cut mid-stream, and the only real fix.
---

Symptom: a long LLM call (e.g. testcase generation) streams with `chars=0` for
~160s, then dies with `peer closed connection without sending complete message
body (incomplete chunked read)` and the step exits 1.

**Root cause:** OpenAI reasoning models (gpt-5.x) **hide their reasoning** — during
the think phase they send NOTHING over the socket. The Replit OpenRouter proxy
gateway has an idle timeout (~160s observed) and severs a silent connection. With
`reasoning.effort=high` the silent think window exceeds that cutoff before any
visible token is produced.

**Why streaming does NOT help:** there are no reasoning bytes to stream; OpenAI only
streams the visible answer, which doesn't begin until thinking is done. So nothing
keeps the socket "warm" during reasoning. Non-streaming is worse (zero bytes until
the whole answer is ready).

**The only single-shot lever:** shorten the silent think window so first visible
bytes arrive before the idle cutoff → **lower the reasoning effort** (testcases now
default `medium`, not `high`; override `OPENAI_REASONING_EFFORT_TESTCASES`). The
gateway idle timeout itself is Replit infra we can't change.

**Distinct from** the empty-content/`finish_reason=length` failure (that's the output
token *budget* being eaten by reasoning → fix with `max_tokens`). This one is a
*connection* drop, not an empty 200.
