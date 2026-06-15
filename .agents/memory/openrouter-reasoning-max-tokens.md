---
name: OpenRouter reasoning calls need an explicit max_tokens
description: Why reasoning-effort LLM calls through the gateway can return empty content, and the fix
---

When omitting `max_tokens`, the OpenRouter proxy gateway / model defaults the
**completion** budget to only **4096 tokens**. For calls with `reasoning:
{effort: ...}` (gpt-5.x), hidden reasoning tokens are billed as completion
tokens and can consume that entire 4096 budget BEFORE any visible content is
emitted → response comes back with `finish_reason="length"` and **empty
content** (0 chars), while still billing tokens/cost.

**Symptom seen:** testcase generation "succeeded" but produced no testcases —
the empty LLM response was written as an empty generator script, which ran with
exit 0 and wrote no `testcases.json`, yet the step reported success. Short-output
calls (code split, short chat) were unaffected because reasoning+content fit
under 4096.

**Fix (durable):**
1. Always send a generous `max_tokens` (esp. for reasoning purposes). Defaults
   now: testcases 32000, chat/code/enrichment 16000. Override via
   `OPENAI_MAX_TOKENS` or `OPENAI_MAX_TOKENS_{TESTCASES,CHAT,CODE,ENRICHMENT}`.
2. `call_llm` raises on empty content (captures `finish_reason`) instead of
   returning "" — so a blank/truncated response fails loudly rather than
   silently producing empty downstream artifacts.
3. Callers that run/produce files (e.g. testcase_manager) must verify the
   artifact actually exists and is non-empty; an exit-0 no-op is NOT success.

**Why:** an empty-but-billed response is the worst failure mode — silent. The
token cap, the loud guard, and the artifact check are three independent layers.
