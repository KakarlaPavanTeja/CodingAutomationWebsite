# Handoff — testcase I/O contract work

Written 2026-07-29. Read this first in a new session, then `git log --oneline -7`.

## The one-sentence problem

**No artifact owns the I/O contract.** The description, the normalized solution
(`Outputs/generatedFullCode/PYTHON.py`), each per-language driver
(`Outputs/CodeContentFiles/<Lang>/driver.py`), and the generated testcases each
re-derive "what does stdin look like" independently — so they disagree silently, and
the disagreement only surfaces at `execute_tests` as a 0/150 result.

## The precise root cause (found last, most important)

`benchmark_suite.extract_example_io` (~line 1099) **deliberately skips** named-variable
example blocks:

```python
if is_named_var_example_block(inp):
    continue   # "display-only ... cannot be piped to the solution as stdin"
```

`N = 2763 / C = 0` is the form **every function-type description uses** — all 20
questions prepared on 2026-07-29. So nothing in the pipeline ever converts the
display form into raw stdin. Kimi guesses one way, the driver guesses another.

**The missing piece is a converter**, not more validation:
named-variable example block + signature params + the solution's own parse order
→ raw stdin. Once that exists, everything else in this document becomes cheap.

## Evidence from 2026-07-29 (20 questions)

| Question | Symptom | Class |
|---|---|---|
| T primes | `input: "1\n[8]\n"`, `output: '["NO"]'` → Python/C++/Java all **0/150** | testcases in literal form |
| Infinite Coins | `input: "N = 2763\nC = 0"`; also 10531 testcases | display form + no cap |
| Libra | Python **150/150**, Java **0/150** — `NumberFormatException: For input string: "P"` at `FastReader.nextInt` | **translation** bug, not testcases |
| Message Decoder | 0/106, then 40/106 ×3, Java 97/106, Python 24/106 | same translation class |

LLM call accounting for the day: **32 primary, 12 crash-repair, 3 size-fix,
2 grounding-fix** — 17 of 49 calls (35%) were repairs. `llm_usage` cannot show this;
every row lands under `purpose='testcases'` / `step_id='generate_testcases'`.

The 12 repairs were **not** format problems. They were ordinary Python bugs:
5 syntax (unterminated string, mismatched brace, en-dash), 4 self-inflicted asserts
(`Weight sum 20.22 != 20`, duplicate-input assert, missing-key raise), 3 plain bugs
(missing `import sys`, NameError, TypeError).

## What is already done (all pushed to `main`)

| Commit | What |
|---|---|
| `89f98ac` | `CASE_CAP` is a real ceiling — `guarantee_pass` was unbounded, so 10531/10531 "must-keep" cases shipped. Priority order when the cap bites: examples (forced) → TLE → kill cover → slot coverage → edges. Size tags derive from the declared `size_metric`, not the first input token. |
| `d489d50` | `llm_client`: a bare `APIError` (mid-SSE-stream error payload) now rotates models instead of failing the step. |
| `ddfd1a9` | Prompt: fill `size_edge` via `is_edge`, not `n <= 1`. |
| `cbdd61a` | Parse pre-flight in `_run_generator` (all four script-writing paths funnel through it); ASCII transliteration in `_sanitize_generated_script`; **repair calls now carry the primary 6.4k-token contract** instead of a 294-token stub. Prompt: NEVER CRASH / pure-ASCII / imports-at-top. |
| `dbc7f1c` | `repair_suite` — dedup, fill missing keys, derive `size_metric`, force positive weights, renumber `order`, run right after generation. `format_compliance` logs which rules the model broke. FINAL CHECK block as the last 977 chars of the system prompt. |
| `5709d7b` | `audit_io_shape` — flags literal-shaped input/output (`[8]`, `["NO"]`, `N = 2763`). Warning, not a hard failure; sanctions brackets for tree/linked-list problems and when the description shows that form. |
| `3874f81` | `verify_io_contract` — the checkpoint. Runs the reference on the description's Examples, compares byte-for-byte, writes `Outputs/io_contract.json`. Works for raw-stdin descriptions; reports "skipped" for named-variable ones (the gap above). |

Tests: **220 passing** via `npm run test:json`. New files:
`tests/test_generator_preflight.py`, `test_repair_suite.py`, `test_io_shape_audit.py`,
`test_io_contract.py`.

## Next, in order

### 1. The named-variable → raw stdin converter (the real fix)

Read first: `benchmark_suite.extract_example_io` + `is_named_var_example_block`,
`Prompts/descriptionPrompt.py` (`_function_example_format_addon` — it defines the
display form), and `signature_params` as passed to `get_testcases_prompt`.

Build: `convert_named_var_example(block, signature_params, solution_source) -> str`.
The solution's own parse order is the tiebreaker for field order — read how
`PYTHON.py:main` consumes `sys.stdin`.

Then flip `test_named_var_examples_are_not_yet_convertible` to assert `verified`.

### 2. Feed the verified pair into the testcase prompt

This is the payoff. Replace the 16 lines of prose at
`Prompts/testcasesprompt_v4.py:320` with the frozen pair:

```
Case 1 stdin is exactly:  1\n8\n
Case 1 stdout is exactly: NO
Produce every case in this shape.
```

Shorter *and* more reliable — the same "copy this verbatim" effect that makes
`tc_harness` the one instruction Kimi never violates.

### 3. Run `split_code` in parallel with the testcase chain

Verified: **no data dependency.** `split_code` (`Scripts/code_splitter.py`) needs the
normalized solution + signature from `generate_question`. The testcase chain is
`TESTCASE_CHAIN_STEPS = [generate_testcases, generate_wrong_solutions,
select_testcases]` in `src/lib/pipeline-waves.ts`. `execute_tests` is the first step
needing both. The wave system already models parallel groups.

The prize is **not** wall-clock. It makes the per-language drivers exist before
`select_testcases`, which unblocks item 4. Risk to watch: two concurrent LLM steps
under an OpenRouter rate limit is contention, not speedup.

### 4. Ground testcases against the real per-language drivers

Currently `_ground_against_reference` runs `PYTHON.py` standalone, but the platform
runs `driver.py` + `solution.py`, and in Java a translated driver. **Libra and Message
Decoder both died in exactly that gap.** Blocked on item 3 (drivers must exist first).

Note this is a **translation** defect — the fix likely belongs in `split_code` /
`translate_java`: verify the translated driver against the Python driver on the public
examples and reject a translation that disagrees. That path has not been read yet.

### 5. Prompt deletions — only after the compliance log has data

`format_compliance` now prints, per run, which contract rules the model actually broke.
Collect ~20 runs, then delete the prompt text for rules that never appear. Do **not**
do this blind: the system prompt is ~6.7k tokens / 26.7k chars and only parts of it have
been read. One safe deletion has already been made (the weight-SUM assert, provably
redundant because `prepare_platform_json._scale_weights_to_total` overwrites it).

Related: prompt text still contains em-dashes while instructing pure-ASCII output.
Cosmetic (`_asciify_punctuation` catches the output) but a mixed signal.

## Design decisions worth keeping

- **Repair, don't assert.** Every crash class was already fixed *later* in the pipeline
  (`prepare_platform_json` fills keys and rescales weights, `select_suite` dedups). The
  script died at generation time so our fixers never ran. Fixing ordering beat fixing
  the model.
- **Move rules out of the prompt, don't add more.** Anything a deterministic
  post-processor can fix should be *deleted* from the prompt, not kept as a backstop —
  that is what shortens it. Only keep what code cannot fix: actual input values, correct
  outputs, scenario diversity, real MAX_N stress.
- **Code can fix a label; it cannot invent a value.** We can retag a case `size_large`;
  we cannot create an input at n=200000 that does not exist. So the size-*ladder*
  instruction stays, the size-*percentage* bookkeeping goes.
- **Position beats emphasis.** The prompt's last block is followed best. The I/O rule
  sat at line 320 of 700 and was the one being ignored.
- **Warn, don't hard-fail, where the check is heuristic.** `audit_io_shape` and
  `verify_io_contract` both report loudly rather than abort — a misfire that blocks a
  good question is worse than the manual fixing it replaces.

## Useful commands

```bash
npm run test:json                                   # 220 Python tests
npx tsx scripts/db.mts --problem <id-prefix>        # problem + runs + state
npx tsx scripts/db.mts --sql "..."                  # read-only SQL

# per-purpose LLM call counts for a day (llm_usage cannot distinguish these)
npx tsx scripts/db.mts --sql "with c as (select l.run_id,
  (regexp_matches(ln,'purpose=(testcases[a-z_]*)'))[1] as purp
  from pipeline_logs l, lateral unnest(string_to_array(l.content,chr(10))) as ln
  where l.created_at >= '2026-07-29' and l.step_id='generate_testcases'
  and ln ~ 'LLM. starting call') select purp, count(*) from c group by purp"
```

Fetching a problem's storage artifacts (no CLI exists; inline is fine):

```bash
npx tsx -e '
import { config } from "dotenv"; config({ path: ".env.local", quiet: true });
(async () => {
  const m: any = await import("./src/lib/object-storage.ts"); const s = m.default ?? m;
  console.log(await s.getObjectString("<problem-id>/outputs/testcases.json"));
})();'
```

## Open in the working tree at handoff time

- `pipeline/Scripts/llm_client.py` is **modified and uncommitted**: `brute_force`
  `default_effort` lowered from `xhigh` to `medium`, with the rationale that effort is
  not differentiated above medium on v4-flash (medium spent more reasoning than high for
  the same answer) and `xhigh` severed the stream. This came from an `effort_probe.py`
  measurement run outside the repo and was left uncommitted deliberately — confirm the
  measurement still holds, then commit it.
- Nothing else is outstanding. `git status` should otherwise be clean.

## Status of the questions themselves

- **Infinite Coins** — fine. Regenerated at 10:22, now 150 cases, 22/22 slots, 8/8
  wrong solutions caught. Needs nothing.
- **T primes, Libra, Message Decoder** — still carry suites built before these fixes.
  Re-run after item 1 lands, not before.
