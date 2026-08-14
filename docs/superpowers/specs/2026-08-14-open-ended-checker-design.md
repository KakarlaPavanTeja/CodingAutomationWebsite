# Open-Ended Problems: Grade With a Checker, Not a Stored Answer

**Status:** approved design, not yet planned or implemented
**Depends on:** the testcase-generation redesign (`2026-08-13-...-design.md`) landing first

## The problem

Some tasks legitimately have many correct answers — topological sort, "any valid
arrangement", any-shortest-path. Grading compares stdout as exact text, so a student
who returns a different-but-correct answer is marked wrong.

Today the pipeline avoids this by forbidding such problems: `descriptionPrompt.py`
carries a rule marked CRITICAL requiring every description to pin down a single answer
with an explicit tie-break ("return the lexicographically smallest such sequence").

That rule works, but it distorts problems. For topological sort, demanding the
lexicographically smallest ordering turns a graph problem into a graph-plus-sorting
problem and changes what is being tested.

### The detector makes it worse

`is_open_ended_problem` (`benchmark_suite.py`) is a prose regex meant to catch
descriptions that ignored the rule. It matches phrases like `multiple valid` and
`if there are multiple` — which is exactly the wording a description MUST use when it
spells out a tie-break. Verified 2026-08-14:

| description | detector |
|---|---|
| `Return any valid arrangement of the letters.` | True (correct) |
| `If there are multiple valid answers, return the lexicographically smallest one.` | True (**wrong**) |
| `If there are multiple pairs summing to k, print the pair with the smallest first index.` | True (**wrong**) |
| `Print the sum of all elements.` | False |

So the better a description follows the rule, the more likely its checks are switched
off. Being flagged disables the optimal-vs-brute cross-check entirely
(`generate_brute_force.py`), records the brute as agreeing without checking
(`validate_solutions.py`), and made B2 abstain. Nothing fails; the checks just stop
running. This detector must go once checkers exist — it is a symptom of not having them.

## Evidence gathered

Probed the live grading compiler (`nw-compiler`) on 2026-08-14.

**Grading is exact text, with no float tolerance.** `0.30` vs `0.3`,
`0.3000000000000001` vs `0.3`, `3` vs `3.0` and a 1e-9 difference all returned
INCORRECT. (This already removed B2's decimal exception — commit `08777e2`.)

**`multiple_possible_output` works.** With `multiple_output_contents: [A, B, C]`,
printing any of A/B/C returned CORRECT and printing D returned INCORRECT. The primary
`contents` field is ignored once the flag is set.

So storing every valid answer is a real option — but the count explodes with input
shape, not size (a topological sort over 8 unconstrained nodes has 40,320 valid
orderings), so it caps usable inputs at toy sizes and cannot cover stress cases.

## The design

Grade with a **checker** instead of a stored answer.

We control the driver file for function-based problems. It has explicit marked
sections; today the output area writes the answer:

```python
# --- Output Area Start ---
sys.stdout.write(str(result) + '\n')
# --- Output Area End ---
```

For an open-ended problem it writes a verdict instead:

```python
# --- Output Area Start ---
sys.stdout.write("VALID\n" if is_valid(numAPIs, runtimes, result) else "INVALID\n")
# --- Output Area End ---
```

Every test case then stores `VALID` as its expected output. Exact-text comparison is
correct, nothing is enumerated, and there is **no cap on n** — a 100,000-node graph is
checked in one pass. `multiple_possible_output` is not needed.

### Where the checker lives, and when it moves

Step order is `generate_testcases` → `generate_wrong_solutions` → validate (B2) →
`split_code`. B2 runs **before** the driver exists, so the checker cannot start life in
the driver.

It is written as part of the reference solution, so every step before the split can call
it directly. `split_code` then places it in the main file alongside the driver, the same
way it already separates driver from solution.

### Grading time is unaffected

The driver measures elapsed time only around the function call:

```python
start_time_ns = time.perf_counter_ns()
result = sol.findMaxMinRuntime(...)
end_time_ns = time.perf_counter_ns()
```

The checker runs in the output area, outside that window, so it never inflates a
student's measured runtime.

### B2 gets simpler, and validates the checker for free

A wrong solution is caught when the driver prints `INVALID`. No set membership, no
tolerance, no abstention. And the gate doubles as the checker's own test: the reference
must produce `VALID` on every case, and the known-wrong solutions must produce `INVALID`.
A checker too lenient to reject anything fails B2 exactly as a weak suite would.

## Decisions taken

**Scope: function-based problems only.** We control the driver for these. For
stdin/stdout problems the student's code *is* the whole program, so there is nothing to
wrap; those keep the existing tie-break rule.

**Visible cases show `VALID`.** The first two test cases are shown to students. The
problem statement's worked examples already carry real inputs and answers in prose, so
students still learn the expected output shape. Grading stays correct everywhere. The
alternative — grading the two visible cases against one stored answer — reintroduces the
original bug on precisely the cases students see first.

**Local checks run through the compiler.** `BENCHMARK_USE_COMPILER=1` already routes
benchmark execution through the compiler API (`benchmark_compiler.py`), so our verdict
and the platform's come from the same place and cannot drift. Before the split, steps
that need a verdict call the checker directly out of the reference solution.

**Solution generation writes the checker.** That step already holds the full problem
context, so the checker and the reference stay in sync without a new pipeline step or an
extra LLM call per problem.

## What this touches

- `Prompts/` — solution generation must emit a checker for open-ended problems, and
  decide when one is needed. `descriptionPrompt.py`'s DETERMINISTIC ANSWER rule must
  become conditional: still mandatory for stdin/stdout problems, relaxed for
  function-based ones that will ship a checker.
- `code_splitter.py` / `splittingPrompt.py` — place the checker in the main file.
- Test-case generation — store `VALID` rather than the reference's stdout for these
  problems, and keep grounding meaningful (the reference must check out as `VALID`).
- `benchmark_suite.py` — delete `is_open_ended_problem` and its four call sites; kill
  scoring reads the driver's verdict.
- `generate_brute_force.py`, `validate_solutions.py` — stop relaxing checks on a regex
  match; a checker makes the cross-check valid again.
- `prepare_platform_json.py`, execution managers — **no change**, already support both
  shapes.

## Open questions

- How does a problem get marked open-ended in the first place — does solution generation
  decide, or does something upstream classify it? This determines whether the
  description rule can be relaxed safely.
- Does the reference solution shipping a checker confuse any step that reads it as a
  plain solution (normalization, conversion to other languages)?
- Non-function-based open-ended problems keep the tie-break rule. Should the pipeline
  detect and reject them outright instead of trusting the rule, given the current
  detector cannot tell a resolved tie-break from an unresolved one?

## Out of scope

Storing enumerated answers via `multiple_possible_output`. It works, but it caps inputs
at toy sizes and the checker approach makes it unnecessary. Revisit only if a
non-function-based open-ended problem must ship.
