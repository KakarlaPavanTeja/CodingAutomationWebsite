# Testcase pipeline redesign: over-generate → dedup → validate → select (up to 150)

**Date:** 2026-07-26
**Status:** Design approved; implementation starting.
**Supersedes:** `2026-07-24-testcase-selection-redesign-design.md` (same direction, refined
outcome: large deduplicated suite up to 150, explicit edge cases, verified brute-force TLE).

## Priorities

1. **Quality / coverage** (P1)
2. **Cost** (P2)
3. **Speed / fewer steps** (P3)

## Key realization

The LLM does **not** emit testcases — it emits a **generator script** ("generate test
case generator script" in the logs). So *volume is nearly free*: the cost is the single
LLM call that writes the script, not how many cases the script produces. The redesign
exploits this — one LLM call, then deterministic compute does dedup, validation, TLE
timing, kill scoring, and selection.

## Outcome contract (what "done" means per problem)

A generated suite must satisfy:

1. **Count is high** — fill up to a **hard cap of 150** cases (floor = platform minimum,
   currently 25). More is better; do not minimize.
2. **No exact-input duplicates** — two cases may share a *scenario type* but never the
   *identical normalized input*.
3. **All edge cases present** — as explicit literals (empty, n=min, all-same, negatives,
   overflow boundary, …), not left to randomness.
4. **Brute force provably TLEs** — the suite contains constraint-scaled large cases where
   a naive/brute solution exceeds the time limit (the suite *enforces* intended complexity).
5. Every `subtask × size-bucket` covered · every wrong solution killed · every stored
   output reproduced by the reference solution.

## Flow

```
1 LLM call → generator SCRIPT  (structured: EDGE_CASES + SCENARIO_GENERATORS + TLE_BUILDERS)
  → run script (~250 candidates, seeded/reproducible)          [free]
  → dedup exact inputs (hash normalized input)                 [free]
  → validity filter: ground vs reference solution, drop fails  [compute]
  → size bucketing (model size_metric + MAX_N → thresholds)    [free]
  → brute-force timing on large cases → verify TLE             [compute]
  → wrong solutions run on pool → per-case kill sets           [compute]
  → select_testcases: guarantee pass, then fill to ≤150        [free]
  → benchmark_testcases ONCE → report B1–B4                    [compute]
  → split_code → … → prepare_platform_json
```

**Removed:** `harden_testcases` ("Strengthen"), the size-fix regeneration loop
(`testcase_generation_size_fix`), and benchmark-as-a-regenerating-gate.

## Component details

### 1. Generation — one LLM call, structured script

The prompt requires the generator script to expose three **named sections** so coverage is
enforced by *structure*, not by trusting the model to hit a distribution:

- **`EDGE_CASES`** — a hand-written list of literal inputs (empty, min-n, all-same,
  negatives, overflow boundary, …). Auditable, deterministic.
- **`SCENARIO_GENERATORS`** — parameterized, **seeded** random generators per scenario
  type (answer-at-start/end, duplicates, …).
- **`TLE_BUILDERS`** — construct worst-case inputs **at** `MAX_N` deterministically (not
  random sizes) so brute force is actually stressed.

Every emitted case carries metadata: `size_metric` (numeric — n / string length /
rows×cols / nodes+edges), `scenario`, `subtask`, `is_edge`. The script also declares the
problem-level `MAX_N`. Target output volume ≈ **250** candidates (env `TESTCASE_POOL_SIZE`,
headroom ≈ cap × 1.6 so dedup + grounding still leave ~150 good uniques).

### 2. Exact-input dedup (early, free)

Normalize each case's input (whitespace/formatting) and hash it; drop byte-identical
inputs. Scenario *types* may repeat; only literal input duplicates are removed. Runs before
validation so the working pool is all-unique.

### 3. Validity filter (grounding, unchanged)

Run the reference (optimal) solution on every case; keep only cases whose stored output the
reference reproduces. Selection only ever sees valid cases.

### 4. Size bucketing — deterministic, model-fed

`bucket(size_metric, MAX_N)` → edge / small / medium / large by fixed proportion
thresholds. Reads the **declared** `size_metric`; never parses raw input. This replaces the
current first-integer-of-first-line parser and fixes string/grid/graph problems that today
bucket as 0% `large`.

### 5. Brute-force TLE verification (new — outcome criterion #4)

For the large-bucket cases, **run `BRUTE_FORCE.py` under a timeout** equal to the problem's
time limit. **Timing out is the pass** — the suite must contain ≥ a few verified-TLE cases.
- Outputs for large cases come from the **reference** solution only (brute is expected to
  time out there). Dual-oracle cross-checking applies only where brute finishes
  (small/medium).
- If brute *finishes fast* on every large case, or no `BRUTE_FORCE.py` exists and a
  slow-threshold is never exceeded → the constraints aren't stressed → **loud report flag**
  (fix is the generation prompt / `TLE_BUILDERS`, not a loop).

### 6. Wrong-solution kills (running code, no LLM)

Generate wrong solutions (existing `generate_wrong_solutions`) and run each against the
whole valid pool. Each case records a **kill set** = which distinct wrong solutions it
catches (output differs from reference).

### 7. Selection — guarantee, then fill to the cap

Deterministic, local, no LLM. Operates on the unique + valid pool.

**Pass 1 — Guarantee (must-haves), in priority order:**
1. **All edge cases** — every surviving `EDGE_CASES` case, unconditionally.
2. **TLE cases** — all verified-TLE cases.
3. **Slot coverage** — for every `subtask × size-bucket × scenario` slot not yet covered,
   add one case; ties broken by most kills → largest in-bucket `size_metric` → id.
4. **Kill completion** — greedy set-cover: while a wrong solution is uncaught, add the case
   catching the most still-uncaught wrong solutions. A wrong solution no case can catch →
   report flag (no loop).

**Pass 2 — Fill to ≤150 (grow, don't minimize):** while `|S| < 150` and unique candidates
remain, add the best remaining case ranked by:
1. **Marginal kills** — adds independent killers so each wrong solution has 2–3 catchers.
2. **Under-represented slot** — the `subtask × bucket × scenario` slot with the fewest
   members in `S`.
3. **Size spread** — `size_metric` farthest from those already selected in the slot.
4. Deterministic id order (reproducible).

Stop at 150 or when uniques run out. If below the floor (25), **re-run the generator script
with a new seed** (free, no LLM) up to 2× before flagging.

### 8. Weightage

Equal weight per case within a subtask: `case_weight = subtask_weight / n_cases_in_subtask`.

### 9. Benchmark once (report, not a gate)

`benchmark_testcases` runs a single pass reporting B1–B4 on the final suite (mutation
kill-rate B1, wrong-solution kill-rate B2, coverage shape B3, …). Never regenerates. Low
B1 with all wrong solutions dead = early warning the wrong solutions were too easy.

### 10. Step wiring & observability

`select_testcases` is its **own pipeline step** (own `step_id`, UI row, DB step row). Its
log is the funnel:
`generated 250 → unique 231 → grounded 219 → TLE ✓ (4) → selected 150 (kills 6/6, slots 30/30, edges 9/9)`.

## Migration (removing harden / size-fix)

- `src/lib/pipeline-config.ts` — remove `harden_testcases`; add `select_testcases`; update
  the tracked-steps list and step-sequencing.
- Run route step sequencing (`src/app/api/pipeline/run/route.ts`) and any step-status logic.
- DB step rows / status maps for existing problems (`pipeline_states.step_statuses`).
- Frontend step components: `StepProgress.tsx`, `PipelineSidePanel.tsx`,
  `PipelineWaveList.tsx`, `problems/[id]/page.tsx`.
- Python: retire `harden_suite.py` from the flow (keep file, unwired); `testcase_manager_v4`
  gains dedup + TLE-timing + kill-scoring + selection (or a new `select_testcases.py`).
- Docs (`docs/pipeline-flows/*`) and env references (`TESTCASE_SIZE_FIX_ROUNDS`, harden vars).

## Config / env

- `TESTCASE_POOL_SIZE` — candidate target (default ~250).
- `TESTCASE_CASE_CAP` — final hard cap (default 150).
- `TESTCASE_CASE_FLOOR` — platform minimum (default 25).
- Size-bucket thresholds (proportions of `MAX_N`).

## Open items (resolve during implementation)

1. Exact bucket thresholds (proportions of `MAX_N` per edge/small/medium/large).
2. TLE slow-threshold when no `BRUTE_FORCE.py` exists (wall-clock multiple of the limit).
3. Whether selection lives in `testcase_manager_v4.py` or a dedicated `select_testcases.py`
   (leaning dedicated, for the observable funnel + its own step).
4. Normalization rules for input-dedup hashing (whitespace, trailing newline, number
   formatting).

## Out of scope

- Changing the generation model / routing (separate: the kimi-k2-thinking trial).
- Editorial / execution / platform-json stages beyond consuming the new suite + weightage.
