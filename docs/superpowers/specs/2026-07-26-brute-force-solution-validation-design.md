# Solution Validation in `generate_brute_force` — Design

**Date:** 2026-07-26
**Status:** Approved (design), pending implementation plan
**Scope:** Python pipeline only (`generate_brute_force` step). No frontend/DB changes.

## Goal

Before test-case generation, validate that the **optimal** and **brute-force**
solutions are correct and honor the problem's input format, by (1) reliably
extracting small executable examples from the description regardless of its
format and (2) adding a small-language-model (SLM) quality judgment of both
solutions. Purely **advisory**: it enriches the report and prints warnings, and
never blocks test-case generation.

## Background — what already exists

`generate_brute_force.py` runs BEFORE `generate_testcases` (it is a
GQ-embedded step; `generate_testcases` depends on it). Today its `main()`
already, after writing `Outputs/generatedFullCode/BRUTE_FORCE.py`:

- Runs the **optimal against the description's worked examples**
  (`optimal_example_failures`) — ground-truth check. On failure it writes a
  "reference is BUGGY" marker and can be made fatal via `BRUTE_MISMATCH_FATAL=1`.
- Cross-checks **optimal vs brute** on examples + small random inputs
  (`crosscheck_optimal_brute`) — advisory (disagreement treated as
  probable multiple-valid-answers).
- Writes a verdict to `Outputs/optimal_brute_check.json`
  (`{status, reason, mismatches}`).

The reusable helpers live in `benchmark_suite.py`: `extract_example_io`,
`extract_example_inputs`, `is_named_var_example_block`,
`optimal_example_failures`, `crosscheck_optimal_brute`, `is_open_ended_problem`,
`run_solution`, `run_solutions_batch` (local, or remote compiler when
`BENCHMARK_USE_COMPILER` ∈ {1,true,yes}).

### The two gaps this design fills

1. **Extraction is brittle regex.** `extract_example_io` matches only
   ` **Input:** ``` … ``` ` / `**Output:**` fenced blocks. Function-based /
   named-variable descriptions and off-format descriptions yield **zero**
   executable examples, so the existing validation silently runs on nothing.
2. **No quality judgment of the code itself** — only execution. Nothing assesses
   whether the optimal matches the problem intent, whether the input format is
   honored, or whether the brute is a genuinely independent simpler approach.

## Design decisions (settled)

- **On failure:** advisory only. Never blocks; existing `BRUTE_MISMATCH_FATAL`
  behavior for the ground-truth optimal-vs-real-example check is unchanged.
- **SLM shape:** ONE `call_llm` call every `generate_brute_force` run, returning
  both extracted examples AND quality verdicts.
- **Model:** `google/gemini-3.5-flash` (constant `_GEMINI_FLASH` already in
  `llm_client.py`), via a new `validate_solutions` purpose, env-overridable.
- **SLM examples are validation-only** — never injected into the generated
  test-case suite.
- **New files** rather than bloating `generate_brute_force.py`.

## Components

### 1. Prompt — `pipeline/Scripts/Prompts/validatesolutionsprompt.py`

`get_validate_solutions_prompt(description, optimal_code, brute_code) -> (system, user)`

The prompt instructs the SLM to:

- Read the problem description AND the **optimal code**, and infer the EXACT
  stdin format the optimal parses (from its input-reading code) — so emitted
  inputs are in the format the solution actually consumes. This is what makes
  "input format properly followed" checkable: a format mismatch surfaces as the
  optimal erroring on the input at execution time.
- Emit 5–8 **small, hand-verifiable** cases: degenerate/edge (min size,
  singleton, all-equal, boundary) + a few typical small cases.
- Anchor on the description's own worked examples **verbatim** where present,
  plus a few new tiny ones.
- For each case produce `{input, expected_output}` where `input` is exact raw
  stdin (newline-terminated) and `expected_output` is the exact stdout the
  correct solution should print, per the SLM's own reasoning of the problem.
- Judge the optimal and brute: is the approach correct for the problem, is the
  input format honored, is the brute a genuinely independent simpler method.
- Return STRICT JSON only (no markdown fences, no prose).

### 2. Validator module — `pipeline/Scripts/validate_solutions.py`

`validate_solutions_llm(description, optimal_code, brute_code, *, record_usage=True) -> dict`

Returns the parsed SLM JSON:

```json
{
  "examples": [{"input": "<raw stdin, newline-terminated>", "expected_output": "<stdout>"}],
  "optimal": {"ok": true, "input_format_ok": true, "issues": []},
  "brute":   {"ok": true, "independent": true, "issues": []}
}
```

- Calls `call_llm(system, user, purpose="validate_solutions")` and parses the
  JSON (tolerant: strips accidental code fences before `json.loads`).
- On call failure or unparseable JSON: returns `None` (caller skips the SLM
  layer, logs a warning, existing checks still run).
- Records usage under `step_id="generate_brute_force"`,
  `purpose="validate_solutions"` (preserves usage tracking).

### 3. Model routing — `pipeline/Scripts/llm_client.py`

Add a `validate_solutions` purpose to `_PURPOSE_DEFAULTS` / `_PURPOSE_CONFIG`
defaulting to `_GEMINI_FLASH`, low reasoning effort, with a fallback ladder
(e.g. `{_GPT_54}`). Honors the standard env overrides
(`OPENROUTER_MODEL_VALIDATE_SOLUTIONS`, etc., via the existing suffix map).

### 4. Wiring — `pipeline/Scripts/generate_brute_force.py`

At the end of `main()`, after the existing cross-check, call the validator and
run its examples against the optimal (and brute). Reuse `run_solution` /
`run_solutions_batch` (honoring `BENCHMARK_USE_COMPILER`). Merge the result into
`optimal_brute_check.json` and print an advisory report. Wrapped in
try/except — any failure logs a warning and is non-fatal.

## Validation logic

For each SLM-extracted example, run the **optimal**:

1. **Input-format check** — `status == "error"` ⇒ the optimal could not parse
   this input ⇒ flag `input_format` (loud, distinct). `status == "timeout"` on a
   deliberately small case is also flagged.
2. **Ground-truth check** — normalized optimal output vs SLM `expected_output`:
   agreement corroborates; disagreement flagged (optimal bug OR SLM guess —
   advisory).
3. **Optimal vs brute** — run brute on the same inputs; disagreement advisory
   unless `is_open_ended_problem(description)`.

The existing regex-example ground-truth check (`optimal_example_failures`) runs
unchanged and is higher-confidence when the description has real fenced
examples; the SLM examples primarily cover the off-format / no-example case and
add small-case breadth.

## Data flow / output

Extend `Outputs/optimal_brute_check.json` with an `slm` block; existing top-level
keys are unchanged:

```json
{
  "status": "ok",
  "reason": "...",
  "mismatches": [],
  "slm": {
    "examples_count": 6,
    "optimal": {"ok": true, "input_format_ok": true, "issues": []},
    "brute":   {"ok": true, "independent": true, "issues": []},
    "example_results": [
      {"input": "...", "optimal_status": "ok", "matches_expected": true, "brute_agrees": true}
    ]
  }
}
```

Print a `=== SOLUTION VALIDATION (advisory) ===` block in the step log with ✓/⚠
per check (input-format, ground-truth, optimal-vs-brute, code-quality issues).

## Error handling

- SLM call fails / bad JSON → warn, skip SLM layer, existing checks still run.
- No brute available → skip brute checks; optimal checks still run.
- Advisory throughout: SLM/quality issues never exit non-zero. Only the
  pre-existing `BRUTE_MISMATCH_FATAL` ground-truth path can exit non-zero, and
  only when explicitly enabled (unchanged behavior).

## Testing

- Unit-test `validate_solutions_llm` JSON parse (clean, fenced, malformed→None)
  with a **fake `call_llm`** injected (mirrors existing test patterns).
- Unit-test the merge into `optimal_brute_check.json` and the report shape with
  a fake batch runner (deterministic `(stdout, status)` tuples) — no live LLM,
  no live compiler.
- Prompt builder tested for presence of the format-inference + strict-JSON
  instructions and inclusion of the optimal code.

## Non-goals

- SLM examples are NOT injected into the generated test-case suite.
- Not a gate — never blocks `generate_testcases`.
- No frontend, DB, or step-ordering changes.
