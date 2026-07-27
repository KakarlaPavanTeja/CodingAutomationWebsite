---
name: coding-question-preparation
description: Use when preparing a competitive-programming coding question end-to-end with this repo's Python pipeline — turning a raw problem statement plus a reference solution into a verified, platform-ready coding_questions.json. Trigger on "prepare a coding question", "run the CP pipeline", "build this problem", or when given a problem statement plus a reference solution for this project.
---

# CP Coding Question Creation

Drive this repo's 13-step pipeline with **you acting as the LLM** in place of the
OpenRouter call. You follow each step's declared prompt format and reuse every
non-LLM script. You never write a bespoke replacement for a pipeline step.

## STEP 0 — INTAKE (blocking; do this before anything else)

Late spec changes are the single largest cost in this workflow. One reversal
(non-function → function) once forced a description rewrite, `split_code` across
four languages, a full re-execution, a repackage, an editorial rewrite and a
second editorial run. **Get all six answers before writing any artifact.**

Ask in one `AskUserQuestion` round:

1. **Question Type** — `function` or `nonfunction`. Decides the description
   prompt, whether `split_code` runs, which executor runs, and whether
   `solutions` is populated. Never infer this from the source.
2. **Function signature** (function-based only) — name + parameter names. If the
   source has no function, one must be invented; say so and get it approved.
3. **Difficulty** — `easy` / `medium` / `hard`. Set `PIPELINE_OWNER_DIFFICULTY`;
   the owner value is final.
4. **Constraints** — keep the source's, or change them? Check the TLE
   implication *now* (see Trap 6).
5. **Scenario Level** — `none` / `light` / `moderate` / `heavy`. At `none` you
   may NOT invent a story or rename anything (see Trap 1).
6. **Languages** — default `python,cpp,java,nodejs`.

Record the answers in `Inputs/problem.md` headers:

```
# Problem: <title>
# Type: standard | node based
# Question Type: function | nonfunction
# Scenario Level: none | light | moderate | heavy
```

## Environment

```bash
export PIPELINE_BASE_DIR=<scratch>/run          # every script honours this
export PYTHONPATH=<repo>/pipeline/Scripts
export PIPELINE_OWNER_DIFFICULTY=<easy|medium|hard>
export PIPELINE_OWNER_TITLE="<title>"           # optional; overrides titles file
ln -sfn <repo>/pipeline/zReferenceFiles "$PIPELINE_BASE_DIR/zReferenceFiles"
cd "$PIPELINE_BASE_DIR"                          # several scripts use relative Outputs/
```

Use **`/usr/bin/python3`** — homebrew python3 lacks `requests`. Never run the
pipeline against `pipeline/Inputs` or `pipeline/Outputs`; those hold other work.

Inputs are exactly three files: `problem.md`, `solution.py`, `topics_list.txt`.

## OUTPUT HYGIENE (non-negotiable)

Execution steps emit one `@@TCRESULT@@` JSON line **per testcase per language**,
each containing the full input and both output strings. On a 166-case suite that
is ~1000 blobs of pure noise. Always filter:

```bash
... execution_manager_v3.py python cpp java 2>&1 | grep -vE '^@@TCRESULT@@' | tail -20
```

**Never read these into context** — summarise with a script instead:
`testcases.json`, `testcases_pool.json`, `execution_results.json`,
`editorial_execution_results.json`, `differential_fuzz_cases.json`.
They routinely run 140 KB – 900 KB each.

## The steps

Prompt formats live in `pipeline/Scripts/Prompts/`. Read the prompt for a step
before producing its artifact; produce output in exactly that format.

| # | Step | You write | Script to run |
|---|---|---|---|
| 1 | `generate_question` | `generated_description.md`, `generated_titles.txt`, `generated_difficulty.txt`, `generated_topics.json`, `generatedFullCode/{PYTHON.py,CPP.cpp,JAVA.java,NodeJS.js}` | — |
| 2 | `generate_brute_force` | `generatedFullCode/BRUTE_FORCE.py` | — |
| 3 | `generate_testcases` | `testcases_generator_script.py` | run it; copy `tc_harness.py` alongside |
| 4 | `generate_wrong_solutions` | `wrong_solutions/*.py` (3–5) | — |
| 5 | `select_testcases` | — | `testcase_annotate.py` |
| 6 | execute tests | — | `execution_manager_v3.py python cpp java` (+ `--nonfunction`) |
| 7 | `generate_enrichment` | `enrichment.json` | — |
| 8 | `package_platform` | — | `prepare_lua_and_testcases.py --mode practice --langs ...` |
| 9 | `generate_editorial` | `editorial.md` | — |
| 10 | `prepare_platform_json` | — | `prepare_platform_json.py --mode practice --langs ...` |
| 11 | `execute_editorial` | — | `editorial_execution_manager.py python cpp java` |

Function-based additionally needs **`split_code`** before step 6: write
`CodeContentFiles/{Python,Cpp,Java,NodeJS}/{default,driver,solution}.{ext}` per
the templates in `Prompts/splittingPrompt.py`. Non-function skips it entirely.

Descriptions: `get_structure_only_prompt` (function) vs
`get_nonfunction_structure_only_prompt` (non-function) in
`Prompts/descriptionPrompt.py`. Section order differs — non-function has **no
Your Task** section.

## Traps (each of these has already cost a rebuild)

1. **`scenario_level: none` means no new story.** Keep the source's framing,
   variable names, example values and constraint bounds. Rewrite prose only.
2. **The size audit ignores your tags.** It derives the bucket from the *first
   integer token of the first input line*: `n ≥ 0.8·MAX_N` → large, `n ≤ 1` →
   edge, `n ≤ 20` → small, `n ≥ 0.5·MAX_N` → large, else medium. Make that token
   the real size.
3. **Subtasks are capped at `max(12, ⌈total/subtask_count⌉)`.** Do NOT map
   subtask to size bucket — it unbalances counts and fails B3. Assign semantic
   tiers with balanced counts.
4. **`is_hidden = order > 2` is hardcoded.** Exactly two cases are visible, so
   the description must have exactly two examples that match testcase orders 1
   and 2. A single-example source will mismatch unless you add one.
5. **`solutions: []` is correct for non-function** — set deliberately at
   `prepare_platform_json.py:1010`. The programs live in
   `language_code_repository_details` as base64.
6. **Check TLE headroom at intake.** Brute-force complexity against max `n`. At
   `n ≤ 100` an O(n²) brute force runs in ~0.02s over a whole suite — no TLE
   tier is achievable, and no test case can create one.
7. **Java entry class is `Main`** (`class Main`, non-public, compiles under any
   filename). **Node.js runs on the v2 compiler**, not v3 — verify it separately.
8. Testcase `input` is always **raw stdin** the reference parses, for function
   and non-function alike. Only the *description* uses `name = value` form.
   Switching question type does NOT require regenerating testcases.

## Definition of done

Report these numbers, never adjectives. Run every solution on the compiler
endpoint — never claim a pass from reading code.

- `testcase_annotate.py`: **B1 ≥ 90%** mutation kill, **B2** all wrong solutions
  caught, **B3** PASS, **B4** PASS
- Every language **N/N** on the full suite
- Weights sum to the declared total; orders sequential `1..N`; all weights > 0
- Visible testcases match the description's examples byte-for-byte
- Editorial: every approach × language passes

A network error (`Connection reset by peer`) reads as `0/N` — retry before
reporting it as a failure.

## Attaching to the platform

`scripts/attach-manual-run.mts` creates the `problems` row, uploads
`Inputs/` + `Outputs/` to S3, and writes `llm_usage` rows with
`model=claude-opus-5, account=claude-code`. Edit `RUN`, `OWNER`, `PROBLEM` at the
top, dry-run first, then `--execute`.

This is a **shared production database**. Confirm with the user before writing,
every time. Count Claude-built questions with:

```sql
select count(distinct problem_id) from llm_usage where account = 'claude-code';
```

Those rows carry 0 tokens and $0 — no OpenRouter call happened. Real session cost
is not captured anywhere; state that rather than implying the question was free.
