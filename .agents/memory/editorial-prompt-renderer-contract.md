---
name: Editorial prompt ↔ renderer contract
description: Hard formatting constraints the editorial LLM prompt must obey because the Editorial tab uses a tiny custom markdown parser, not a real markdown lib.
---

The editorial output (`Outputs/editorial.md`, produced by `EDITORIAL_PROMPT` in
`pipeline/Scripts/Prompts/editorialPrompt.py`) is rendered by a hand-written
parser in `src/components/problems/ProblemEditorial.tsx` — NOT a markdown library.
So the prompt must emit only what that parser understands.

**Rules the prompt must enforce (changing the prompt without these breaks rendering):**
- Pseudocode MUST use the downstream platform's structure: an opening
  `<CodeBlock language={customtext} showNumberOfLines={15} fontStyle={Normal Code}>`,
  a blank line, a single ```pseudocode fenced block, a blank line, then `</CodeBlock>`.
  The user's external markdown preview ONLY renders this exact shape — a raw
  `<CodeBlock language="pseudocode">` (no inner fence) does NOT render for them.
  The ProblemEditorial parser was updated to unwrap the inner fence (FENCE_RE) and
  map `language={customtext}` → pseudocode; it still falls back to raw inner content
  for older editorials, and serializeBlocks re-emits the fenced structure on save.
- Runnable code goes inside `<MultiLanguageCodeBlock>` with one ``` fence per
  language tagged `cpp` / `python` / `java` / `javascript` (js/nodejs also map to
  javascript). Order C++, Python, Java, JavaScript.
- NO Markdown tables and NO horizontal-rule dividers (`---`/`***`/`___`) — the
  parser renders neither; tables show as literal pipe text. (The old prompt's
  "## Summary comparison table" was dropped for this reason.)
- Supported prose: `#`..`######` headings, `-`/`*` and `1.` lists (FLAT — nested
  sub-bullets are flattened, not indented), `>` blockquote, `**bold**`, `*italic*`,
  inline `` `code` ``, links. That's the whole feature set.

**Why:** `EDITORIAL_PROMPT` is one static (raw) string kept byte-stable for OpenAI
prompt caching; all per-problem inputs live in `build_user_message()`. The pseudocode
tag must match the downstream platform's `<CodeBlock language={customtext} ...>` +
inner ```pseudocode fence verbatim, because that platform's preview is the one that
matters to the user; this app's tab parser was made to match it. Tables and
horizontal-rule dividers are still unsupported by this app's parser.

**How to apply:** when editing the editorial prompt, keep the two custom-tag formats
exactly (pseudocode = `<CodeBlock language={customtext} showNumberOfLines={15}
fontStyle={Normal Code}>` wrapping a ```pseudocode fence; code = `<MultiLanguageCodeBlock>`
with per-language fences). If you ever want tables/nested lists you must extend the
parser in ProblemEditorial.tsx first.
