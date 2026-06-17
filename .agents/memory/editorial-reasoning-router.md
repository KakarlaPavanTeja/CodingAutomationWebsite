---
name: Editorial reasoning auto-router
description: How editorial generation decides reasoning effort (A/B/C) per problem, and the call_llm override semantics that back it.
---

Editorial generation auto-selects how much model "thinking" (reasoning effort) a
problem needs, instead of a fixed global setting.

**The contract (user-requested):** A = plain model (no reasoning), B = reasoning
`medium`, C = reasoning `high`. A tiny classifier call picks the letter from the
problem statement + one reference solution, then the editorial gpt-5.5 call runs
with the mapped effort.

**Precedence (highest first):**
1. `OPENAI_REASONING_EFFORT_EDITORIAL` set AND non-blank → manual override, skip the
   router. (Blank/whitespace is treated as unset on purpose — otherwise a
   misconfigured empty value silently bypasses routing and forces reasoning off.)
2. `EDITORIAL_REASONING_MODE` in `{a,b,c}` → force that fixed level.
3. else → auto-route via the classifier.

**Why a separate classifier call:** the router must NOT itself reason (cost/latency),
so it is called with `purpose="chat"`, `reasoning_effort=None`, `max_tokens=16`.
This is exactly why `call_llm` needed per-call overrides — `chat` defaults reasoning
to `high`, which would make the router slow/expensive.

**call_llm override semantics (important, easy to get wrong):**
- `reasoning_effort`/`max_tokens` default to the sentinel `_USE_ENV` → resolve from
  env/defaults (preserves all existing callers).
- Passing an explicit value overrides; passing explicit `None` for `reasoning_effort`
  means "force reasoning OFF for this call" — distinct from `_USE_ENV`. Do not
  collapse these two.

**How to apply:** routing must never block generation — any router exception falls
back to no reasoning (letter A). The router's own tokens/cost are tracked under
`step_id="generate_editorial"`, `purpose="editorial_router"`. The 100K editorial
output cap is shared budget: with C/high, hidden reasoning tokens are billed against
it, so very long editorials + high reasoning could in theory exhaust it.
