---
name: Editorial prompt ↔ renderer contract
description: Hard formatting constraints the editorial LLM prompt must obey because the Editorial tab uses a tiny custom markdown parser, not a real markdown lib.
---

The editorial output (`Outputs/editorial.md`, produced by `EDITORIAL_PROMPT` in
`pipeline/Scripts/Prompts/editorialPrompt.py`) is rendered by a hand-written
parser in `src/components/problems/ProblemEditorial.tsx` — NOT a markdown library.
So the prompt must emit only what that parser understands.

**Rules the prompt must enforce (changing the prompt without these breaks rendering):**
- Pseudocode goes RAW inside `<CodeBlock language="pseudocode"> ... </CodeBlock>`.
  Do NOT put a ``` fence inside the tag — the pseudocode view prints fence
  backticks literally. The parser reads `language="..."` with DOUBLE quotes only;
  `language={customtext}` style won't match and silently falls back to pseudocode.
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
prompt caching; all per-problem inputs live in `build_user_message()`. It's tempting
to copy an external "ideal" editorial prompt verbatim, but external prompts assume a
full markdown renderer and will specify fenced-pseudocode, tables, and `<CodeBlock
language={...}>` syntax that this renderer can't handle.

**How to apply:** when editing the editorial prompt, keep the two custom-tag formats
exactly, and if you ever want tables/nested lists/fenced-pseudocode you must extend
the parser in ProblemEditorial.tsx first.
