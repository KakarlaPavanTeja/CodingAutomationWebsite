---
name: OpenRouter direct vs Replit gateway
description: Why the LLM client defaults to direct openrouter.ai, and the gotchas if switching modes
---

The pipeline LLM client defaults to calling **openrouter.ai directly** with a
real OpenRouter key, NOT the Replit proxy gateway.

**Why direct:** the gateway (behind Replit's egress/Cloud-Run layer) was the
*source* of two recurring failures — it intermittently severed long reasoning
streams on idle, and its OWASP WAF 403'd code-heavy request bodies. Going direct
removes both at the source. The gateway's only upside was Replit-managed
billing.

**Gotchas when switching modes (the non-obvious part):**
- Gzip is a WAF-bypass that must only run against the gateway. Direct upstreams
  may not decompress request bodies, so gzip is gated on the base_url being a
  `*.replit.app` host — never gzip a direct call.
- Direct billing is the user's own OpenRouter account; gateway billing is
  Replit's. Switching base_url also means swapping the key (real key ↔ gateway
  key) in lockstep — they are not interchangeable.

**Why this matters:** the severed-stream/WAF/max_tokens safety nets all remain
and are harmless on direct calls, so the decision is purely transport+billing —
don't reintroduce gzip or the gateway URL on the direct path expecting a fix.
