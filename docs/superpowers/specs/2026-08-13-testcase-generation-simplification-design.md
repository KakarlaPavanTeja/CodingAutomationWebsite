# Testcase generation simplification: derive what is computable, gate on evidence

**Date:** 2026-08-13
**Status:** Design approved; spec under review.
**Branch:** `redesign/testcase-generation`
**Supersedes (partially):** `2026-07-26-testcase-overgenerate-select-redesign-design.md`
— keeps its central insight (the LLM emits a *generator script*, so volume is nearly
free), reverses its over-generate → select conclusion.

---

## Why reverse the selector

The 2026-07-26 design over-generated a 150–250 candidate pool and let a deterministic
selector keep the strongest 80–150. That bought real coverage, but it papered over a
weakness worth naming:

**`guarantee_pass` could only keep the best cases the pool happened to contain.** When no
case in the pool killed a given wrong solution, selection recorded it in `uncatchable`
and **shipped the suite anyway**. So selection guaranteed *"we kept the best available"* —
never *"the suite is good."*

A blocking B2 gate checks the property we actually care about — **no wrong solution
survives the suite** — and fails the step when it does not hold. That is a stronger
guarantee than selection ever provided, not a weaker one.

The second motivation is prompt weight. The generator was asked to *predict computations
we then run anyway* (which size bucket a case lands in, what weight it deserves, what
order it sorts to). Every prediction needed a repair pass behind it. Roughly 40% of the
prompt existed to make the model agree with arithmetic we could just do.

---

## Core principle

**The model is asked only for what requires judgment. Everything computable is computed.**

| The model decides | We compute |
|---|---|
| the inputs themselves | size bucket (real input vs `MAX_N`) |
| what each case validates (`subtask` name) | subtask *numbering* |
| which cases group together | `weightage` |
| `scenario`, `is_edge` | `order` |
| `size_model`, `space_mode` | dedup |

---

## 1. Subtasks become semantic

### Current meaning (being replaced)

`sync_subtask_tags` assigns a **difficulty tier ordered by input size** —
*"tier 1 = smallest cases, tier k = largest"* (`testcase_helpers.py:673`). Two cases
validating completely unrelated behaviours land in the same subtask purely because their
inputs are similar sizes. The grouping carries no meaning.

### New meaning

A subtask is **what a case validates**. Cases checking the same behaviour group together.

The generator emits a **name**, not a number:

```json
{ "input": "...", "output": "...",
  "subtask": "max_constraint_performance",
  "scenario": "answer_at_end",
  "is_edge": false }
```

### Numbering (deterministic, ours)

1. Collect the distinct `subtask` names.
2. Rank each group by **demand** — the most demanding case it contains
   (`edge < small < medium < large`, ties broken by size metric).
3. Assign `subtask_1..N` in that order.
4. Emit the tag with the semantic name preserved as the label:

```json
"tags": [{"name_enum": "subtask_5", "display_name": "Max Constraint Performance"}]
```

Three consequences, all free:

- `tier_from_tags`, B3, `testcase_annotate`, and subtask-aware reordering keep working
  unchanged — they only ever needed a numeric enum.
- Numbering **by demand** makes weights monotonic without a weight table.
- The platform shows users a meaningful label instead of "Subtask 5".
  `prepare_platform_json.normalize_tags` already passes dict tags through and keeps any
  `display_name` they carry — no change needed there.

### Constants

`MAX_SUBTASKS`: **8 → 12**. Semantic groups can legitimately exceed 8, and B3
*hard-fails* above the max. `MIN_SUBTASKS` stays 3.

---

## 2. Weight derives from group demand

One weight per subtask group, applied uniformly to every case in it:

| Demand of the group's most demanding case | Multiplier |
|---|---|
| `edge` / `small` | 1× |
| `medium` | 2× |
| `large` | 4× |
| group contains any tag in `STRESS_SCENARIO_TAGS` | ×1.5 on top |

`STRESS_SCENARIO_TAGS` already exists in `Prompts/testcasesprompt_v4.py` (`stress`,
`max_constraint`, `worst_case_position`, `early_exit_trap`, `answer_at_end`,
`adversarial`, `tle_trap`) and is reused as-is. Maximum weight is therefore
`4 × 1.5 = 6.0`, minimum `1.0`.

`prepare_platform_json._scale_weights_to_total` already rescales all weights to sum to
the total, preserving relative proportions. So:

- `PIPELINE_OWNER_SCORE` (the user-set weightage, `problems.score` in the DB) keeps
  working with **no change**.
- The generator never sees a score number. The `(SCORING)` and `(WEIGHT DISTRIBUTION)`
  prompt sections were computing a total that got discarded downstream — both deleted.
- `DISTRIBUTION_BY_MODE` (the monotonic weight tables) is deleted. The
  `--distribution assessment|contest` flag goes with it.

---

## 3. I/O contract: model proposes, execution decides

### Current weakness

`verify_io_contract` is execution-verified and must stay that way — it is what caught the
suite that shipped `[8]` / `["NO"]` and scored 0/150 in three languages. Its weakness is
`named_var_stdin_candidates`: a **hand-written heuristic** that guesses layouts blind,
having never seen the solution. When no guess matches, the contract is `UNCONVERTIBLE`.

### New flow

```
small model sees: description Examples + the reference solution's stdin parser
        │
   proposes ONE layout
        │
   run it against the reference solution
        │
   matches the stated answer? ──yes──► contract verified, done
        │ no
   feed back: the layout it proposed, what it printed, what was expected
        │
   one retry
        │
   still no match ──► contract UNVERIFIED, loud warning (as today)
```

**One layout, not several.** The model reads the actual parser (`sys.stdin.read().split()`,
the `input()` calls), so the ambiguity the old heuristic hedged against is gone. Asking
for three candidates tells it to be unsure when it has the information to be sure. The
retry is *informed* — it sees its own wrong stdout against the expected one, which beats a
second blind guess.

Cost on the common path: 1 LLM call + 1 subprocess run (down from 1 call + N runs).

Verification is unchanged: a layout is accepted only when the real reference solution
reproduces the real stated answer.

---

## 4. Count: generate what ships

**80–250 cases, sized by the problem.** No pool, no `testcases_pool.json`, no fill pass,
no trimming.

- Difficulty picks the sub-band the prompt states: **easy 80–120 · medium 120–180 ·
  hard 180–250**. The model chooses inside it based on how large the problem's input
  space actually is.
- An explicit owner count (`--count` / the Test cases count field) is passed into the
  prompt as an exact target, since no selector can enforce it afterwards.

**80 is a generation target, not a gate.** The only enforced floor stays B3's
`MIN_TESTCASES = 25`, unchanged. A suite landing between 25 and 80 is reported in the log
as short but does not fail — the generator, not a validator, owns the count now, and
failing the step for 74 cases would cost a full regeneration for no quality reason.

### Small input spaces

Problems whose legal input space is genuinely tiny (generate-parentheses with `n ≤ 8`,
and equivalents across other topics) declare `space_mode: "exhaustive"`. We stamp
`suite_complete: true` on the root, and B3 accepts a below-minimum suite as complete
rather than failing it (`benchmark_suite.py:776`, already implemented). Such a problem
ships its 8 cases and the log states that the whole input space is covered.

### Deleted

`testcase_selection.select_suite`, `guarantee_pass`, `_fill_pass`, `fill_target`,
`CASE_CAP`, `CASE_FLOOR`, `TARGET_BY_DIFFICULTY`, `format_funnel`, the pool snapshot, and
`POOL_TARGET_MIN` / `POOL_TARGET_MAX`.

### Retained from that module

`bucket_size`, `bucket_case`, `dedup_by_input` — still needed by the derive step.

---

## 5. The derive step (formerly the repair step)

The old step 9 repaired *what the model claimed*. The new one derives *what we never asked
for*. It runs after the generator script, before grounding.

| Old | New |
|---|---|
| `sync_size_tags` (override the model's tag) | **derive** the size tag; model emits none |
| `sync_subtask_tags` (assign difficulty tiers) | **deleted** — model owns grouping |
| `repair_suite` keys/weights/order | **deleted** — `prepare_platform_json` already does this |
| size audit + `TESTCASE_SIZE_FIX_ROUNDS` loop | **deleted** |
| — | **dedup by normalized input** — moved here; the selector was doing it and is gone |
| `sync_example_testcases` | **kept** — examples stay synced to the description |
| `audit_io_shape` | **kept** — catches the literal-input class grounding cannot see |

Order of operations:

1. dedup by normalized input
2. derive size bucket per case → `size_*` tag
3. group by `subtask` name → rank by demand → assign `subtask_<n>` + `display_name`
4. compute one weight per group → apply to every member
5. renumber `order`
6. sync public examples from the verified `io_contract`
7. `audit_io_shape` warning

All deterministic. No LLM.

---

## 6. Gating

### B2 blocks

A known-wrong solution passing every test is objective proof the suite is broken. No
threshold, no interpretation. `testcase_annotate` stops calling `print_report` with
`report_only=True` for B2 and exits non-zero.

### B2 skipped also blocks

```python
if not paths:
    return {"skipped": True, "note": "no wrong_solutions/*.py found", "hard_fail": False}
```

Under the old design a skipped B2 was harmless — the selector was still filtering. B2 is
now the **only** blocking gate, so a silent skip means *zero* quality control on a suite
that reports success. `generate_wrong_solutions` is a required step; missing output is an
error, not a shrug.

### B1 stays advisory

Mutation kill rate (`DEFAULT_MIN_KILL = 0.90`) is a statistical signal — some mutants are
semantically equivalent and genuinely uncatchable, and that detection is imperfect.
Blocking on a tuned threshold that fires on benign variance trains people to reach for the
skip flag, and once skipping is habitual B2 is lost too. A gate people route around is
worse than no gate, because it looks like protection.

B1 keeps printing `STRONG` / `REVIEW` with its survivor list.

### B2 downgraded to advisory where it cannot judge

Two classes where textual output comparison misreports:

- **Open-ended problems** — several valid outputs. A wrong solution emitting a
  different-but-valid answer is scored as *killed* when nothing caught it. Detection
  already exists (`is_open_ended_problem`, currently wired only into B4).
- **Float / precision outputs** — `normalize` strips whitespace only, so `3.14159` vs
  `3.141590` mismatches and a *correct* solution reads as killed. Detected by scanning
  the stored outputs: if any token in any case's `output` parses as a float **and**
  contains a decimal point, the suite is float-valued. (Integers parse as floats too,
  hence the decimal-point requirement.)

In both cases B2 prints an explicit "cannot judge this problem" line and does not block.
Better an honest abstention than a PASS that means nothing.

---

## 7. Prompt: 24 sections → ~15

### Deleted

| Section | Why |
|---|---|
| `(SCORING — partial-credit judge, weighted)` | weights derived; total discarded downstream |
| `(WEIGHT DISTRIBUTION)` | ditto |
| `(SIZE DISTRIBUTION)` targets + tolerances | buckets derived, not declared |
| `(HOW THE SIZE AUDIT ACTUALLY BUCKETS YOUR CASES)` | asked the model to predict our arithmetic |
| `(SELF-CHECK BEFORE WRITE)` | mirrored the size audit |
| `(PER-PROBLEM-TYPE REQUIRED SCENARIOS)` | model decides categories now |
| `(SOURCE MUST BE PURE ASCII)` | `_sanitize_generated_script._PUNCTUATION_FIXES` already fixes this deterministically |

### Kept — each defends against a real, observed failure

`(MANDATORY PUBLIC EXAMPLES)` · `(DUAL-ORACLE VALIDATION)` / `(SINGLE-ORACLE MODE)` ·
`(ADVERSARIAL ENGINE)` · `(MULTI-AXIS STRESS)` — caught a quadratic brute force passing
152/153 · `(STRICT CONSTRAINT ADHERENCE)` · `(SOLUTION EMBED + EXEC)` ·
`(OUTPUT HYGIENE)` · `(NEVER CRASH — REPAIR INSTEAD)` · `(IMPORT CORRECTNESS)` ·
`(OUTPUT JSON SHAPE)` · `(PROBLEM SIZE MODEL)` · `(Script structure)`

The defensive sections stay because the model's reply is written to a `.py` file and
executed. That is not ceremony.

### Rewritten

- `(OVER-GENERATE)` → **"generate 80–250 — this is the final suite, nothing trims it"**
- `(DECLARED PER-CASE METADATA)` → shrunk to `input`, `output`, `subtask`, `scenario`,
  `is_edge`
- **New:** a short section defining subtask as a semantic validation group, with the
  instruction to name groups in `snake_case` and keep 3–12 of them

### Also dropped from the step

`detect_problem_type` is no longer called in `testcase_manager_v4`. Its only other
consumer, B3, re-detects it itself (`problem_type or detect_problem_type(description)`),
so nothing downstream changes.

---

## 8. Log output

Nearly every printed line narrates the old design and becomes wrong. Logs are the primary
debugging surface for this pipeline, so they are a deliverable, not an afterthought.

### Lines removed

```
Over-generate mode: aiming for a ~150-250 candidate POOL — the select_testcases step
  later dedups and trims to 150.
Problem type (for count scaling): array
Subtask weight mode: assessment (split by problem-chosen subtask count 3-8).
Size distribution: edge 20%, small 52%, ... (n=203)
Realized size distribution: ...
Contract auto-repaired (model did not comply): 4 duplicate input(s); 2 missing `order`
Assigned subtask tags on 203 case(s) (generator emitted none/invalid).
Reordered cases by input+output size (ascending); stress cases last.
=== SELECT TEST CASES (dedup → annotate → select ≤150) ===
[1/4] Loaded 203 candidate case(s) from freshly generated pool
[4/4] Selected 110 of 197 unique (6 exact-input duplicate(s) removed)
      generated 203 → unique 197 → selected 110/110 (edges 21, tle 4, ...)
WARNING: generator produced 900 cases for a ~150-250 target pool ...
```

### Generation step — new shape

```
=== GENERATE TEST CASES ===
      difficulty=medium (owner)  ·  target 80-250 cases  ·  I/O: function (raw stdin)
I/O CONTRACT verified against the reference solution (2 example(s)):
      example 1: stdin='3\n1 2 3\n' stdout='6'
      example 2: stdin='1\n5\n' stdout='5'
Calling LLM to generate test case generator script...
Running Outputs/testcases_generator_script.py...
Generated 164 case(s).
Derived: 6 duplicate(s) removed · 158 case(s) kept
      size buckets   edge 34 · small 79 · medium 12 · large 33
      subtasks (7, ordered by demand):
        subtask_1  Empty And Singleton         12 cases   weight 1.0
        subtask_2  All Equal Elements          18 cases   weight 1.0
        ...
        subtask_7  Max Constraint Performance  16 cases   weight 6.0
      2 public example case(s) synced from the description
Grounding: reference solution reproduces all 158 case(s).
```

When the space is exhaustive:

```
      space=exhaustive — the whole legal input space is 8 case(s); shipped complete
```

### Validation step — new shape

```
=== VALIDATE TEST CASES (no trimming — the generated suite ships) ===
[1/3] Loaded 158 case(s)  ·  size_model=count (max_n=100000)  ·  space=sampled
      oracles: reference=present · brute-force=present · wrong-solutions=5
[2/3] Scoring kills: running 5 wrong solution(s) over 158 case(s)…
      · wrong sols caught   5/5
      · cases that killed nothing   41 of 158        <-- new, informational
[3/3] Verifying brute-force TLE (limit 4s; a timeout = verified TLE)…
      · verified brute TLE  7

=== BENCHMARK ===
[B1] Mutation kill rate: 93.2% (82/88)               — advisory
[B2] Wrong-approach gate: PASS (5 files)             — BLOCKING
[B3] Coverage-shape: PASS — 158 cases, 7 subtask(s)
[B4] Differential fuzz: PASS
```

Blocking failure:

```
[B2] FAIL — wrong_greedy.py passed ALL 158 case(s) (not caught by any)
ERROR: a known-wrong solution passes every test case. The suite does not
       discriminate it. Refusing to ship.
```

Abstention:

```
[B2] CANNOT JUDGE — this problem accepts multiple valid outputs, so textual
     comparison would misreport. Gate skipped (not a pass).
```

Missing wrong solutions:

```
ERROR: no wrong_solutions/*.py found. B2 is the only blocking quality gate;
       without it the suite is unvalidated. Run Generate Wrong Solutions first.
```

### Rule for all new log lines

State the *outcome*, not the *mechanism*, and name the number to look at. A line nobody
can act on is noise.

---

## 9. Files touched

| File | Change |
|---|---|
| `Prompts/testcasesprompt_v4.py` | delete 7 sections, rewrite 2, add subtask section, drop weight tables + count bands |
| `Scripts/testcase_manager_v4.py` | drop `detect_problem_type` + size-fix loop; new I/O contract call; rewrite derive step; new logs |
| `Scripts/testcase_helpers.py` | `sync_size_tags` → derive; delete `sync_subtask_tags`; add group numbering + weight derivation |
| `Scripts/testcase_selection.py` | delete `select_suite` / `guarantee_pass` / `fill_target` / bounds; keep bucketing + dedup |
| `Scripts/testcase_annotate.py` | drop selection + pool snapshot; keep kill scoring + TLE; B2 blocking; new logs |
| `Scripts/benchmark_suite.py` | `MAX_SUBTASKS` 8→12; B2 blocking; B2 abstention for open-ended/float |
| `src/lib/pipeline-config.ts` | `select_testcases` label/description now describe validation, not selection |

---

## 10. Testing

- `npm run test:json` — existing Python suite must stay green.
- New unit tests on the derive step:
  - distinct subtask names → stable demand-ordered numbering
  - every case within a group carries an identical weight
  - dedup removes exact-input duplicates and renumbers `order` contiguously
  - `space_mode: exhaustive` → `suite_complete: true` on the root
- New unit test on B2 gating: missing `wrong_solutions/` is an error, not a skip.

---

## 11. Accepted trade-off

With no selector, a suite of 200 cases that all exercise the same easy path — catching
nothing — still ships, provided no wrong solution survives it. Nothing prunes dead weight.

The mitigation is informational: the annotator already computes per-case kill sets, so the
log states *"41 of 158 cases killed nothing."* That is the selector's signal without the
selector's authority.

If that number is routinely read and acted on by hand, the argument returns for a minimal
evidence filter — drop cases that kill nothing **and** cover no new slot **and** are not an
example or edge case. Deliberately out of scope here.
