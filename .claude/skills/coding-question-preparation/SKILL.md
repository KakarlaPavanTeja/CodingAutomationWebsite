---
name: coding-question-preparation
description: Use when preparing a competitive-programming coding question end-to-end with this repo's Python pipeline — turning a raw problem statement into a verified, platform-ready coding_questions.json with testcases, multi-language solutions and an editorial. A reference solution is optional; the skill writes one when none is given. The topics taxonomy ships with the skill. Trigger on "prepare a coding question", "run the CP pipeline", "build this problem", or when given a problem statement for this project.
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

Also establish, without asking if it is already obvious: **is there a reference
solution?** If not, you will write it — see "When no reference solution is
provided" below, and confirm the problem semantics before generating testcases.
Never ask for `topics_list.txt`; it ships with this skill.

Record the answers in `Inputs/problem.md` headers:

```
# Problem: <title>
# Type: standard | node based
# Question Type: function | nonfunction
# Scenario Level: none | light | moderate | heavy
```

## Working in one pass

Rework, not the work, is what makes a question expensive. One session cost roughly
$108 for a single easy question; almost all of the avoidable half was five editorial
rewrites and three deterministic steps discovered late. Two habits remove most of it.

**Do not re-ask a settled intake.** When the user hands you an approved statement
that already carries the four headers, STEP 0 is answered — read them, state what you
read, and ask only what is genuinely open. That is usually just the language set
(trap 10) and the score band. A full six-question round on a decided statement wastes
a turn and irritates.

**Run in this order — each step consumes the previous one's output, so a skipped
step means regenerating, not patching:**

```
description  ->  io_contract.json  ->  generator script  ->  derive_and_normalize
   ->  testcase_annotate (B1-B4)  ->  execution_manager_v3  ->  editorial
   ->  check_editorial.py  ->  editorial_execution_manager
   ->  PIPELINE_OWNER_SCORE + prepare_lua + prepare_platform_json  ->  attach
```

The two cheap gates that prevent the expensive loops:

- `check_editorial.py <run>/Outputs/editorial.md` — BEFORE executing the editorial.
- Confirm `examples_synced: 2` from `derive_and_normalize`, and that orders 1 and 2
  carry the `example` tag — BEFORE packaging.

Write each artifact in one pass with a single heredoc. Iterating a file across four
tool calls costs four times the tokens and produces the same file.

## Environment

```bash
export PIPELINE_BASE_DIR=<scratch>/run          # every script honours this
export PYTHONPATH=<repo>/pipeline/Scripts
export PIPELINE_OWNER_DIFFICULTY=<easy|medium|hard>
export PIPELINE_OWNER_TITLE="<title>"           # optional; overrides titles file
export PIPELINE_OWNER_SCORE=<20|25|30>          # owner score is FINAL; rescales every weight
ln -sfn <repo>/pipeline/zReferenceFiles "$PIPELINE_BASE_DIR/zReferenceFiles"
cd "$PIPELINE_BASE_DIR"                          # several scripts use relative Outputs/
```

Use **`/usr/bin/python3`** — homebrew python3 lacks `requests`. Never run the
pipeline against `pipeline/Inputs` or `pipeline/Outputs`; those hold other work.

**Total score is owner-set, not derived.** The house band is **easy 20, medium 25,
hard 30**. Set `PIPELINE_OWNER_SCORE` BEFORE `prepare_platform_json.py`, or the
score defaults to the sum of generated weights (a number like 243) and you will
repackage, re-attach and re-verify to fix it. It rescales all per-case weights to
sum exactly to the total; `testcases.json` keeps its raw weights, which is by design.

**`llm_client` will not import** — it needs `httpx` and `openai`, neither of which
is installed (nor in `requirements.txt`). That blocks `testcase_manager_v4`, whose
deterministic half you DO need. No request is ever made, so stub the imports:

```python
import sys, types
h = types.ModuleType("httpx"); h.BaseTransport = type("BaseTransport", (), {})
sys.modules["httpx"] = h
oa = types.ModuleType("openai")
for n in ("APIConnectionError","APIError","APIStatusError","APITimeoutError",
          "InternalServerError","PermissionDeniedError","RateLimitError"):
    setattr(oa, n, type(n, (Exception,), {}))
oa.OpenAI = type("OpenAI", (), {}); sys.modules["openai"] = oa
```

### Inputs

The pipeline reads three files from `$PIPELINE_BASE_DIR/Inputs/`:

| File | Source |
|---|---|
| `problem.md` | the user's statement + the four headers above |
| `topics_list.txt` | **ships with this skill** — copy it in, never ask for it |
| `solution.py` | the user's reference solution, **or written by you** (see below) |

```bash
mkdir -p "$PIPELINE_BASE_DIR/Inputs"
cp .claude/skills/coding-question-preparation/topics_list.txt "$PIPELINE_BASE_DIR/Inputs/"
```

The topics taxonomy is fixed: `Beginner:` / `Intermediate:` / `Advanced:` lines.
`generated_topics.json` must draw ONLY from it, with exact spelling and casing,
into keys `beginner_topics`, `intermediate_topics`, `advanced_topics`.

### When no reference solution is provided

The pipeline needs `solution.py` — it is the ground truth for every expected
output. If the user has none, you write it. **Say so explicitly and get the
semantics confirmed before generating 150+ testcases from it.**

This removes the workflow's main safety net, so compensate:

- **State your reading of the problem back to the user in plain language** —
  every rule, every tie-break, every edge case — and get it confirmed. A
  misread here silently poisons every expected output downstream.
- **Mine the statement's own examples for ground truth.** Run your solution
  against every worked example on the compiler endpoint before anything else.
  If the statement has no examples, that is a blocking gap — ask for one.
- **The dual-oracle check is weaker than it looks.** Normally the brute force
  cross-checks a solution someone else wrote. If you write both, they share
  your misreading and can agree while both being wrong. Agreement now proves
  only internal consistency, NOT correctness — say that in the final report
  rather than quoting the pass rate as if it settled the question.
- Derive the brute force from the *statement*, not from your own optimal
  solution, so the two readings stay as independent as possible.
- Flag any ambiguity you had to resolve by choosing. Those choices are the
  likeliest place the question is wrong.

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

### Three steps the table does not list — and nothing warns you about

Each of these lives INSIDE a script whose LLM call you are replacing, so it never
runs when you hand-write the artifact. All three cost a rebuild in one session.

**a. `derive_and_normalize` — after running the generator, before `testcase_annotate`.**
Not a CLI. It computes everything the model is deliberately never asked for:
dedup, example sync, shipping order, size tags, subtask numbering, weights. Skip it
and B3 fails with `subtask count 0 outside [3, 12]`, cases carry no tags, and
`order` is meaningless.

```python
from testcase_manager_v4 import derive_and_normalize      # after the stub above
rep = derive_and_normalize("Outputs/testcases.json",
                           open("Outputs/generated_description.md").read(),
                           json.load(open("Outputs/io_contract.json")))
```

**b. `Outputs/io_contract.json` — you must write it yourself.**
Without it `examples_synced` is `0`, orders 1 and 2 are whatever the sort produced,
and since `is_hidden = order > 2` (trap 4) the two VISIBLE cases then do not match
the description's examples. Example sync cannot parse the `name = value` display
form the function-based description prompt mandates, so the contract is the only
route. Build it by RUNNING the reference on each example's raw stdin:

```json
{"verified": true, "pairs": [{"example": 1, "stdin": "...", "stdout": "...",
  "expected": "...", "converted_from": "named-variable block"}], "mismatches": [], "reason": ""}
```

**c. `editorial_code_guard` — after writing `editorial.md`.**
`editorial_manager.py` applies it; you are not running that. Apply both:

```python
from editorial_code_guard import comment_out_editorial_drivers, ensure_move_code
md, _ = ensure_move_code(md)              # adds enableMoveCode={true} to every block
md, _ = comment_out_editorial_drivers(md) # comments out any live driver
```

### Suite sizing that clears B3 first time

Aim for **80–85 cases in 5 subtask groups, none over 17**. The band is 80–250, and
the subtask cap is `max(12, ⌈total/groups⌉)` — so a 58-case suite collapses the cap
to 12 and any group over that fails B3. Plan the group of every scenario UP FRONT in
a `SUBTASK_BY_SCENARIO` dict and have `add()` read the group from it; rebalancing
after the fact means regenerating. Floors: edge ≥5%, large ≥5%, at most 3 cases
declared `magnitude: "extreme"`.

Step 1 solutions (`generatedFullCode/*`, and later `CodeContentFiles/*`) are
**translations, not re-implementations**. For every language:

- **The description's Input/Output format wins.** Parse and print exactly what
  `generated_description.md` specifies, matching its examples byte-for-byte —
  separators, spacing, list form (`[1,2,3]`, no spaces), float precision, line
  breaks. If the reference reads a token the examples don't show (e.g. a leading
  `n`), drop it and derive that value instead.
- **Read `Inputs/solution.py` and follow its implementation.** Same algorithm,
  same complexity, same core-logic variable names, same tie-breaks and
  output-formatting decisions. Never re-derive the logic from the prose — the
  reference is the ground truth every expected output came from, so a divergence
  shows up as a failing testcase, not as a better solution.

`Prompts/conversionPrompt.py` holds the full rule set (language-specific I/O,
naming, data types); read it before writing these files.

Function-based additionally needs **`split_code`** before step 6: write
`CodeContentFiles/{Python,Cpp,Java,NodeJS}/{default,driver,solution}.{ext}` per
the templates in `Prompts/splittingPrompt.py`. Non-function skips it entirely.

Descriptions: `get_structure_only_prompt` (function) vs
`get_nonfunction_structure_only_prompt` (non-function) in
`Prompts/descriptionPrompt.py`. Section order differs — non-function has **no
Your Task** section.

## The editorial contract

`Prompts/editorialPrompt.py` is not advice — the Editorial tab parses these tags,
and a reviewer reads the subsections. One session broke all four subsections and
rewrote the editorial five times. Read the prompt, then check every line below.

**Structure — exact, nothing before or after:**

```
# [Problem Name]                 <- H1 REQUIRED. Easy to forget; it is the first line.
## [Approach Name]               <- or "## Solution 1: [Name]" when several exist
### Intuition
### Approach
### Pseudocode                   <- REQUIRED heading, not just the CodeBlock tag
### Code Implementation
### Complexity Analysis
```

Nothing may follow Complexity Analysis — no notes, no asides, no dividers, no tables.

**Intuition and Approach are plain-English bullets.** No backticks anywhere, no
variable or function names, no code keywords, no syntax. Each bullet is one idea in
1–2 short sentences; never a paragraph. Approach is bullets only, never numbered:
3–4 for easy, 4–5 medium, 5–6 hard. `return` as an ordinary English verb is fine —
the prompt's own GOOD example uses it.

**Pseudocode is C-like, not Python-like.** `methodName(param1, param2) {` with braces
on every block and 4-space indent, no data types, no semicolons, and `/* ... */` for
every comment — **never `//`**. A comment above every function, loop, branch, return
and major assignment, roughly 1:1 with the code.

**Complexity Analysis has a fixed shape.** Top level `* **Time Complexity: \`O(...)\`**`
and `* **Space Complexity: \`O(...)\`**`, each with `  * ` sub-bullets (never plain
lines, never bold labels on sub-bullets), last sub-bullet being the summary. Every
complexity value in backticks.

**Owner preferences — these override the prompt's defaults:**

- **The Code Implementation carries NO comments.** Bare solution class. The "why"
  belongs in the pseudocode, which is comment-heavy by rule. The commented-out
  `main()` template stays: that is the driver rule, not a comment.
- **A basic problem gets ONE approach.** The prompt says to include the brute force
  as a first naive approach; when that brute force is an artificial oracle construct
  (shift-subtract division, a lookup table for a range check), including it invents
  complexity the problem does not have. Single-solution shape is valid — use it.
- **The editorial teaches the article's concept, not the incidental technique.**
  For an exceptions question the spine is: why no return value can express the
  failure, what `throw` does to control flow, which standard type and why, and that
  `.what()` carries the message the caller prints. Arithmetic like truncation
  towards zero is a footnote inside a code comment, never the intuition.

Audit before executing — `python3 check_editorial.py <run>/Outputs/editorial.md`
(ships with this skill) checks every rule above mechanically.

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
9. **A single-language question still needs `generatedFullCode/PYTHON.py`.** Every
   downstream step (testcase_manager_v4, testcase_annotate, benchmark_suite) reads
   it as THE reference, whatever languages ship. Write it even for a C++-only build.
10. **Language choice is an intake question when the concept is language-specific.**
   A question teaching C++ exceptions or templates does not translate: Python has no
   `std::invalid_argument`, and `if constexpr` has no equivalent at all. Ask before
   building four languages that teach four different things.
11. **A concept question will not fit the topics taxonomy.** It is purely algorithmic
   — nothing for exceptions, error handling, templates or language mechanics. Tag
   `Implementation` plus a second tag only where there is real algorithmic substance,
   and say plainly that the true topic has no tag rather than forcing a bad fit.

## Definition of done

Report these numbers, never adjectives. Run every solution on the compiler
endpoint — never claim a pass from reading code.

- `testcase_annotate.py`: **B1 ≥ 90%** mutation kill, **B2** all wrong solutions
  caught, **B3** PASS, **B4** PASS
- Every language **N/N** on the full suite
- Weights sum to the declared total; orders sequential `1..N`; all weights > 0
- Visible testcases match the description's examples byte-for-byte
- Editorial: every approach × language passes, and `check_editorial.py` reports PASS
- `derive_and_normalize` reported `examples_synced: 2`, and orders 1-2 carry `example`
- `total_score` equals the owner band (easy 20 / medium 25 / hard 30), not a
  weight-sum artefact

A network error (`Connection reset by peer`) reads as `0/N` — retry before
reporting it as a failure.

## Attaching to the platform

`scripts/attach-manual-run.mts` creates the `problems` row, uploads
`Inputs/` + `Outputs/` to S3, and writes `llm_usage` rows with
`model=claude-opus-5, account=claude-code`. Nothing is hand-edited — everything is
derived from the run tree. Dry-run first (default), then `--execute`:

```bash
npx tsx scripts/attach-manual-run.mts --run <run dir>              # dry run
npx tsx scripts/attach-manual-run.mts --run <run dir> --execute    # attach
npx tsx scripts/attach-manual-run.mts --run <run dir> --refresh <problem id> --execute
```

**Use `--refresh` for every re-push.** Editing an artifact after attaching (a score
change, an editorial rewrite) needs the refresh path: it keeps the problem id, syncs
score/difficulty, re-uploads, and does not duplicate the `llm_usage` rows. A second
plain `--execute` mints a NEW problem instead.

Verify with `npx tsx scripts/db.mts -p <id prefix>` — `_verify-attach.mts` is
hardcoded for other problems and will not answer for yours.

This is a **shared production database**. Confirm with the user before writing,
every time. Count Claude-built questions with:

```sql
select count(distinct problem_id) from llm_usage where account = 'claude-code';
```

Those rows carry 0 tokens and $0 — no OpenRouter call happened. Real session cost
is not captured anywhere; state that rather than implying the question was free.
