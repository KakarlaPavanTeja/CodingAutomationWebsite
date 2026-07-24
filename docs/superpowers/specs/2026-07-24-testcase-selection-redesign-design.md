# Testcase pipeline redesign: over-generate → select

**Date:** 2026-07-24
**Status:** Design approved; implementation deferred to a fresh session.

## Problem

The current testcase flow is expensive and fragile:

- `generate_testcases` → `generate_wrong_solutions` → `benchmark_testcases`
  (B1–B4, **looped**) → `harden_testcases` ("strengthen": fuzz-harden + an LLM
  call to append killer cases).
- The size-diversity re-generation loop (`testcase_generation_size_fix`) fired
  repeatedly and drove ~$22 of the Jul 20–24 spike; it is now disabled
  (`TESTCASE_SIZE_FIX_ROUNDS` default 0).
- `harden_testcases` adds an extra LLM round every problem.
- The benchmark loop re-prompts on failure, multiplying cost.

We want a suite that is *selected for quality* rather than *iterated into
quality*, at a predictable one-shot generation cost.

## Goal

Generate a large pool of candidate testcases once, validate them, then locally
select the best 80–100 that fully cover every subtask and every size category —
no per-problem hardening loop, benchmark run **once**.

## New flow

```
generate_testcases   (pool: 300–400 cases)
      ↓
generate_wrong_solutions
      ↓
benchmark_testcases  (run ONCE — scores the pool, reports B1–B4)
      ↓
select_testcases     (NEW, local, no LLM — pick 80–100)
      ↓
... split_code → ... → prepare_platform_json
```

`harden_testcases` ("strengthen") is **removed** from the flow.

## Component details

### 1. Pool generation
`generate_testcases` scales its target to ~300–400 cases (env-configurable,
e.g. `TESTCASE_POOL_SIZE`), reusing the existing generator, prompt, and subtask
+ size-category tagging. One larger generation call replaces the harden LLM
call and the size-fix loop. No new model, no new prompt shape.

### 2. Validity filter
Every pool case must be reproducible by the reference (brute-force) solution —
the existing grounding step. Cases the reference cannot reproduce are dropped
**before** selection. Selection only ever sees valid cases.

### 3. Selection (local, deterministic, no LLM)
Pick 80–100 cases with **hard quotas**:

- **Every subtask** represented.
- **Every size category** (edge / small / medium / large) represented at its
  target proportion (`SIZE_CATEGORY_TARGETS`).
- **Balanced across scenario type** — the problem-family scenarios
  (all-negative, boundary, max-N, empty, duplicates, …) tagged during
  generation.

Quotas are **hard**: fill every subtask × size-category × type slot first,
then optimize within.

**Tiebreak within a bucket:** among cases competing for the same slot, prefer
the one that catches more distinct wrong solutions (most discriminating wins).
This is a *tiebreak*, not the primary objective — coverage across type +
category drives selection; kills only break ties.

### 4. Weightage
After selection, assign **equal weightage to every case within each subtask**:

```
case_weight = subtask_weight / n_cases_in_subtask
```

This replaces the current size-weighted scheme (where large cases carried
~50%). Every selected case in a subtask carries the same weight.

### 5. Benchmark once
`benchmark_testcases` runs a **single** pass to report B1–B4 on the final
selected suite — no loop, no re-prompt on failure. It becomes a report, not a
gate that triggers regeneration.

## Open items (resolve at implementation time)

1. **Exact pool size + count formula** — fixed 300–400, or scaled by
   difficulty / subtask count? Env var name and default.
2. **Discrimination signal in the tiebreak** — wrong-solutions only (B2), or
   also mutation kills (B1)? B1 is more expensive to compute per-case.
3. **The greedy selection algorithm** — precise order of slot-filling and
   tiebreaking; behavior when a slot cannot be filled (e.g. no `large` case
   exists because the parser can't bucket a string/grid problem — see the
   deferred `derive_size_bucket` parser-fallback issue).
4. **Migration for removed `harden_testcases`** — UI step list, run-route step
   sequencing, DB step rows, docs, and any env vars referencing harden.
5. **Whether `select_testcases` is a new pipeline step** (own step_id / UI row)
   or folded into `benchmark_testcases` as its final stage.

## Out of scope

- The parser-fallback fix for `derive_size_bucket` (string/grid problems get
  0% `large`) — tracked separately; may surface in open item #3.
- Changing the generation model or prompt content beyond the count target.
