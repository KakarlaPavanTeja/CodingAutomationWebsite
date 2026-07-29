# Pipeline verification layer — design

Status: draft for review
Date: 2026-07-29

## Why

Four coding questions have now been built by driving the 13-step pipeline manually,
with a human (or an agent acting as one) inspecting every artifact between steps.
That inspection is what caught the defects below. None of them were caught by the
pipeline itself.

| # | Defect | Question | Detectable by a script? |
|---|---|---|---|
| 1 | Generator sorted the two public examples by size, so platform order 1 was the description's Example 2 | q3 | Yes |
| 2 | Selection re-sorted them again *after* the generator fix, reintroducing the same swap | q3 | Yes |
| 3 | `total_score` declared 25 while per-case weights summed to 21.2 | q3 | Yes |
| 4 | Editorial and build report described a 63-case suite while the shipped suite had 152 | q1 | Yes |
| 5 | Problem renamed at `scenario_level: none` | q2 | Yes |
| 6 | Subtask/size-bucket imbalance failed B3 four times | q3 | Yes |
| 7 | Transient `API_ERROR` / `Connection reset` reported as a code failure | q1, q2 | Yes |
| 8 | C++/Java/Node translations silently diverging from the reference | all | Yes |
| 9 | Description not faithful to the source's four pillars | — | **No** |
| 10 | An ambiguity resolved by choosing the wrong reading | — | **No** |
| 11 | A reconstructed spec (truncated source) being plausible but wrong | q5 | **No — human** |

Nine of eleven are mechanical. They need a verifier, not a model. Two need
judgement. One needs a person.

Defects 1–4 are the important class: every one of them produced artifacts that
looked complete, passed the pipeline's own gates, and would have shipped. Defect 4
did ship to the platform and had to be corrected by a second push.

### What it costs today

Measured while building q3 (150 cases, four languages):

- `testcase_annotate.py`: **8m14s** per run. B1 mutation testing (69 mutants ×
  150 cases) is nearly all of it; B3 costs milliseconds.
- That script ran **five times** before passing. The first four all failed on B3
  alone — the cheapest gate, reported last, after the expensive one had already
  run. Roughly 33 of those 41 minutes bought nothing.
- Total session cost past **$1,000**, dominated by re-running B1 and the editorial
  execution while converging on a distribution the pipeline could have reported in
  seconds.

## Goals

1. Catch defect classes 1–8 automatically, at the step that introduces them.
2. Cut the cost of a rebuild cycle by reporting cheap failures before expensive ones.
3. Give the judgement checks (9–10) a cheap, structured input instead of raw MB-scale artifacts.

Non-goals: replacing the B1–B4 benchmark gates (they work), automating intake, or
automating spec reconstruction.

## Design

Three layers, in dependency order. Each is useful alone.

```
Layer 1  pipeline_check.py     deterministic, seconds, no model
Layer 2  gate reordering       cheap gates first; --plan-only dry run
Layer 3  review agent          reads Layer 1's report, judges what it cannot
```

### Layer 1 — `pipeline_check.py`

A single verifier, runnable after any step and in CI:

```bash
python3 pipeline_check.py --base-dir <run> [--step <step_id>] [--json]
```

Exit non-zero on any FAIL. Emits a compact report (a few KB) that is also the
input to Layer 3. It reads artifacts, never writes them.

Structure mirrors the pipeline's own step ids so a check can say which step is at
fault, not merely that something is wrong.

#### Check catalogue

**Cross-cutting (run after every step)**

- `freshness` — every downstream artifact records the SHA-256 of the
  `testcases.json` it was built from, in `Outputs/.manifest.json`. A downstream
  artifact whose recorded hash differs from the current suite is STALE. This alone
  covers defect 4, the one that reached the platform.
- `artifact-presence` — the step's declared outputs exist and are non-empty.

**`generate_question`**

- `title-unchanged` — at `scenario_level: none`, `generated_titles.txt` must equal
  the `# Problem:` header in `Inputs/problem.md`. (defect 5)
- `topics-in-taxonomy` — every topic appears verbatim in `topics_list.txt`, in the
  correct tier.
- `description-format` — no ATX headings, no pipe tables, no LaTeX residue, bare
  code fences, sections in the order the prompt mandates.
- `constraints-preserved` — constraint bounds in the description match those in
  `Inputs/problem.md`.

**`generate_testcases` / `select_testcases`**

- `weights` — sum equals the declared total; every weight > 0. (defect 3)
- `orders` — sequential `1..N`, no gaps.
- `distinct-inputs` — no duplicate normalized inputs.
- `example-correspondence` — the description's Example *k* input/output equals the
  testcase at order *k*, byte for byte after normalization, **in the same order**.
  (defects 1 and 2 — this must run again after `prepare_platform_json`, because
  that is where the second swap appeared)
- `visible-count` — exactly two cases with `is_hidden == false`, at orders 1 and 2.
- `slot-budget` — distinct `(subtask, bucket, scenario)` slots ≤ `CASE_CAP`.
  Predicts the failure mode where slot coverage exhausts the cap and starves the
  last subtask. (defect 6, prevention)
- `subtask-balance` — projected post-selection counts ≤ `max(12, ceil(total/subtasks))`.

**`split_code` / `execute_tests_*`**

- `language-consistency` — the same language set across `coding_question_details`,
  `language_code_repository_details`, `test_case_evaluation_metrics` and
  `solutions[].code_details`.
- `translation-equivalence` — run every language build against the reference on N
  generated streams; any divergence is a FAIL. (defect 8)
- `failure-triage` — classify each non-passing case as `TIMEOUT`, `WRONG_ANSWER`,
  or `TRANSIENT` (`API_ERROR` / `Connection reset` with no stderr and no execution
  time). Transients are retried, not reported as failures. (defect 7)

**`prepare_platform_json`**

- Re-run `weights`, `orders`, `example-correspondence`, `visible-count`,
  `language-consistency` against the packaged JSON. The packaged file is a
  different artifact from the suite and has its own failure modes — defects 2 and 3
  were both introduced *at packaging*, after the suite was already correct.
- `function-shape` — `is_function_based` set on all languages; `solutions`
  populated for function-based, empty for non-function.

**`execute_editorial`**

- `approach-coverage` — the optimal approach passes N/N in every language.
- `naive-tiers-correct` — every non-passing case in a naive approach is a timeout,
  never a wrong answer. A wrong answer in a naive tier means the editorial ships
  broken code.

#### Report shape

```json
{
  "run": "...", "step": "prepare_platform_json", "verdict": "FAIL",
  "checks": [
    {"id": "weights", "verdict": "FAIL",
     "detail": "sum(weightage)=21.20 but total_score=25",
     "artifact": "Outputs/forJSONPreparation/coding_questions.json"},
    {"id": "example-correspondence", "verdict": "FAIL",
     "detail": "order 1 input '10 5...' but description Example 1 is 'n = 7'"}
  ],
  "stale": ["Outputs/editorial.md", "Outputs/REPORT.md"]
}
```

### Layer 2 — gate reordering and a dry run

Two changes to `testcase_annotate.py`:

1. **Run B3 before B1.** B3 needs only the selected case list. B1 needs 8 minutes.
   Ordering them cheapest-first would have saved roughly 25 of the 33 minutes spent
   on q3's four rebuild cycles.
2. **`--plan-only`** — run selection and B3, print the realized distribution and
   subtask counts, exit. Turns the generator↔distribution loop from 8 minutes to
   seconds. This matters because the generator *cannot* predict what selection
   keeps. q3's pool was regenerated ten times, largely to discover two facts that a
   dry run would have printed immediately: unique `scenario` strings inflate the
   slot count past `CASE_CAP` and starve the last subtask, and selection keeps
   every edge/medium/large case while trimming only `small`.

Optional third: **cache B1** keyed on `(sha256(optimal), sha256(selected suite))`.
The reference solution never changed across q3's six pool rebuilds, yet every
mutant was re-derived and re-executed each time.

### Layer 3 — the review agent

A subagent that runs **after** Layer 1 passes, and reads Layer 1's report plus the
small text artifacts — never `testcases.json`, `testcases_pool.json`,
`execution_results.json` or `differential_fuzz_cases.json`. Those run 0.9–6 MB
each; feeding them to a model is what made manual verification cost four figures.

Its scope is only what a script cannot decide:

- **Four-pillar faithfulness** — is the rewritten description the same problem as
  the source: same framing, same variable names, same example values, same
  constraint bounds?
- **Editorial soundness** — does each approach's stated complexity match its code,
  and does the prose explain the actual algorithm?
- **Ambiguity review** — for each ambiguity the builder recorded, is the chosen
  reading defensible, and is it exercised by a test case?
- **Report honesty** — does `REPORT.md` claim numbers the artifacts support?

Output: the same verdict shape as Layer 1, so both feed one gate.

### What stays human

- Intake (question type, signature, difficulty, constraints, scenario level).
- Any question whose source is incomplete. q5's statement is truncated mid-sentence
  with `maxAgeInMs` never defined; a reconstructed spec would be internally
  consistent and confidently wrong, and no oracle or gate can detect that. It
  requires a person who knows what was intended.

## Phasing

1. **Layer 1** — highest value, no risk to existing runs, and it can retro-verify
   q1, q2 and q3 on day one.
2. **Layer 2** — biggest wall-clock win; touches shared pipeline code, so it lands
   behind the existing test suites.
3. **Layer 3** — depends on Layer 1's report to be affordable.

## Open questions for review

1. Should Layer 1 be advisory (report only) or a hard gate that blocks the next
   step? A hard gate would have prevented the q1 stale-editorial push; it would
   also have blocked q3 four times on B3 before the Layer 2 dry-run existed.
2. Partial credit: q3's naive editorial tiers score 1–9% because the B3 size
   targets push most cases to large inputs. Is that the intended grading curve, or
   should the size targets be difficulty-dependent?
3. `get_problem_name()` does not strip punctuation, so a title ending in `?`
   produces `WhereToPlaceServers?.lua` and an S3 key containing `?`. Legal, but
   worth deciding whether to slugify.
4. Storage: q3 uploaded 50 MB, against 11 MB for q1. Most of it is
   `testcases_pool.json` and `differential_fuzz_cases.json`, both regeneration
   artifacts. Should the attach step skip them?
