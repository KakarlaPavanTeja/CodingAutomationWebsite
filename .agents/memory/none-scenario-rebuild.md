---
name: scenario_level "none" means rebuild, not verbatim copy
description: What the "none" question scenario type must do in the description-generation prompt
---

In the question-generation pipeline, `scenario_level` ("none" | "light" |
"moderate" | "heavy") controls the description-generation system prompt. The
other levels invent a NEW scenario/story and RENAME variables/functions. `none`
is different and easy to get wrong.

**What `none` must do:** REBUILD/rewrite the problem-statement prose for clarity
and clean structure, while keeping the **four pillars** unchanged:
1. scenario/framing (don't add a story if there's none; don't swap an existing one),
2. variable & function names + signature,
3. examples (identical input/output values, indices, facts),
4. constraints (identical bounds/values).

**Why a pure-verbatim "formatting only" prompt is WRONG:** it preserves the
original's defects. Real failure seen — original statements use LaTeX math
(`$...$`, `\le`, `\lvert s \rvert`, `\bmod`), and the app renders the
description through react-syntax-highlighter as **raw markdown source** (no
katex / markdown-math libs). So LaTeX shows up as literal garbage on the page.
The fix had to actively rewrite + normalize, not preserve.

**Notation normalization is mandatory** in the `none` prompt: strip all math
delimiters and convert every LaTeX macro to plain text (≤ ≥ |x| mod × · ...),
keep exponents as `10^9 + 7`, and end with a self-check for zero backslash-LaTeX
and zero stray `$`. Include a fallback clause for unlisted macros.

**Renderer-safe normalization is mandatory and deterministic** for `none`: the
custom markdown renderer cannot display ATX headings (`#`..`######`), horizontal
rules (`---`/`***`/`___`), language-tagged code fences, or markdown tables. The
prompt forbids them, but LLM compliance is unreliable, so a post-LLM
`normalize_renderer_safe()` pass in `generate_full_question.py` (runs only for
`none`, after the scratchpad strip) deterministically: bolds ATX headings, drops
HRs, strips fence language tags (skipping fence interiors), and converts pipe
tables to bullet/sub-bullet lists preserving every value. It is idempotent and a
no-op on already-clean descriptions.

**Pipeline wiring:** the original statement is the USER message —
`call_llm(get_description_prompt(...), problem_content, purpose="chat")` in
`generate_full_question.py`. The system prompt comes from
`get_structure_only_prompt(...)` (early-returned for `none`) in
`Prompts/descriptionPrompt.py`. light/moderate/heavy share the other path.
