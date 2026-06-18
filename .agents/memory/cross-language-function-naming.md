---
name: Cross-language function-name consistency (generate_full_question)
description: Why the 4 language solutions must share one function name, and what keeps them aligned.
---

Each per-language solution file is produced by a **separate** LLM conversion call,
so nothing makes their function/parameter names match *except* the single canonical
signature extracted from the problem description and fed into every conversion (and
into source normalization).

**The trap:** if that canonical signature ever resolves to empty/None, the override
silently disappears and every language is named independently → drift (Python
re-cases to snake_case most often). Two ways it went empty in the past: the
signature step not running at all (it was tied to a sub-step the UI never sent), and
signature extraction swallowing parse errors.

**Durable rules / how to apply:**
- The signature-extraction + normalization work is a hard dependency of code
  translation, not an optional toggle. If translation runs, it must run.
- Signature extraction must fail loud, never silently yield None — None disables ALL
  cross-language enforcement.
- The canonical name must be used **verbatim** across languages; prompts must forbid
  per-language re-casing, or conventions reintroduce the drift even with the override
  present.
- Naming derives from the description by design (the description is the source of
  truth), so a reused/older on-disk description still produces consistent names —
  that's expected, not a bug.
