---
name: OpenRouter gateway severs long streaming reasoning calls
description: Why streaming reasoning still empties out on hard problems, and the retry-based fix
---

The Replit OpenRouter proxy gateway intermittently **severs a streaming
response mid-flight** on long reasoning calls. Switching the testcase model to
Gemini 2.5 Pro (which streams reasoning tokens) was NOT a complete fix — the
gateway can still cut the connection during a **silent pause between the
reasoning phase and the first content token**. The socket idles ~80s, the
gateway's idle timeout closes it, and the stream just ends.

**How to distinguish stream outcomes (from the consumed stream):**
- Clean finish → a final chunk with `finish_reason` ("stop") **and** (with
  `stream_options={include_usage:true}`) a usage chunk carrying real cost.
- Budget cap → `finish_reason == "length"` (reasoning ate the `max_tokens`
  completion budget); a genuine cap problem — raise loudly.
- **Severed** → the for-loop just ends with **`finish_reason is None` and no
  usage chunk**. Cost/tokens read as 0 ONLY because the usage summary never
  arrived — not because nothing was generated. Any partial content is truncated
  and must be discarded.

**Reasoning streams on a SEPARATE delta field.** Gemini's reasoning arrives as
`delta.reasoning` (or `delta.model_extra["reasoning"]`), NOT `delta.content`.
A heartbeat that counts only `content` shows `chars=0` for the whole think
phase and looks (falsely) idle — count reasoning chars too.

**Fix (durable):** in `call_llm`'s streaming loop, detect `severed =
finish_reason is None`, discard partial content, and **retry the whole
streaming attempt at the SAME effort** up to `OPENROUTER_STREAM_RETRIES`
(default 3) with exponential backoff. Applies to ALL purposes, since the stall
is intermittent — a retry usually succeeds. Testcases keep a last-resort
lower-effort retry after that; the `finish_reason == "length"` case still
raises.

**Why same-effort retry (not lower):** the cut is a transport stall, not a
model/budget problem — the identical request typically completes on the next
attempt. Lowering effort only as a final fallback.

**How to apply:** any long streaming call through this gateway (testcases,
editorial) needs severed-stream detection + retry. Don't trust `tokens=0
cost=0` as "the model returned nothing"; with `finish_reason=None` it means the
stream was cut before the usage summary. If severance persists across retries,
the gateway's stream idle timeout is the root cause (infra-side fix).
