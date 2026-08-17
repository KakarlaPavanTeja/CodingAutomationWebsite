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
| --- | --- |
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

So storing every valid answer is a real option. The count explodes with input *shape*
rather than size (a topological sort over 8 unconstrained nodes has 40,320 valid
orderings, while a 100,000-node chain has exactly one), which means it is usable wherever
the generator controls the shape — see the non-function-based path below.

## The design

Grade with a **checker** instead of a stored answer.

We control the driver file for function-based problems. It has explicit marked
sections; today the output area writes the answer:

```python
# --- Output Area Start ---
sys.stdout.write(str(result) + '\n')
# --- Output Area End ---
```

For an open-ended problem it validates the answer and then prints an **answer**, never a
verdict:

```python
# --- Checker Area Start ---
# Problem-specific. Written by solution generation, placed here by split_code.
def is_valid_arrangement(numAPIs, runtimes, candidate):
    ...                                    # returns True/False for THIS problem

def reference_answer(numAPIs, runtimes):
    ...                                    # one deterministic valid answer
# --- Checker Area End ---

# --- Output Area Start ---
if is_valid_arrangement(numAPIs, runtimes, result):
    sys.stdout.write(str(reference_answer(numAPIs, runtimes)) + '\n')
else:
    sys.stdout.write(str(result) + '\n')   # the student's OWN output, so they can debug
# --- Output Area End ---
```

A valid-but-different answer prints the reference's answer, matches the stored output and
passes. An invalid answer prints what the student actually produced, mismatches and
fails — and the student sees their real output in the failure, which is the whole point.

**The driver never prints `VALID`/`INVALID`.** A verdict string hides what the student
produced, which is the one thing they need when debugging. Every test case stores the
reference's real answer as its `output`, exactly as a single-answer problem does — so
nothing downstream needs to special-case these problems, and the worked examples stay
truthful.

There is **no cap on n**: a 100,000-node graph is checked in one pass.
`multiple_possible_output` is not used on this path.

### Known trade-off: the reference ships inside the driver

`reference_answer` must live in the driver, because only the driver knows the input at
grading time and the stored expected output is on the platform side. Student code is
imported into the same process, so a determined student could read `main.py` and recover
the reference implementation. Accepted deliberately. If it matters for a given problem
set, the mitigation is on the platform side (hide the driver source from the execution
sandbox), not in this design.

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

A wrong solution is caught when the driver echoes its own bad answer instead of the
reference's, so the stored output mismatches. No set membership, no tolerance, no
abstention.

And the gate doubles as the checker's own test: run through the driver, the reference must
match on every case and the known-wrong solutions must mismatch. A checker too lenient to
reject anything lets the wrong solutions through and fails B2 exactly as a weak suite
would.

## Decisions taken

**Scope: runtime checking is function-based only.** We control the driver for these. For
stdin/stdout problems the student's code *is* the whole program, so there is nothing to
wrap — those ship enumerated answers instead, and are never blocked. See "Non-function-based
problems" below.

**Visible cases show a real answer.** The first two test cases are shown to students, and
because the driver prints an answer rather than a verdict, they show exactly what a
single-answer problem shows. No special casing, and the example sync keeps working
untouched.

**Local checks run through the compiler.** `BENCHMARK_USE_COMPILER=1` already routes
benchmark execution through the compiler API (`benchmark_compiler.py`), so our verdict
and the platform's come from the same place and cannot drift. Before the split, steps
that need a verdict call the checker directly out of the reference solution.

**Solution generation writes the checker.** That step already holds the full problem
context, so the checker and the reference stay in sync without a new pipeline step or an
extra LLM call per problem.

## What this touches

- `descriptionPrompt.py` — the DETERMINISTIC ANSWER rule stops being mandatory for both
  problem types, and the step starts emitting an explicit `open_ended` flag. Both
  variants of the rule need changing (function-based ~line 421, stdin/stdout ~line 841).
- `Prompts/` — solution generation reads that flag and emits a checker when it is set.
- `code_splitter.py` / `splittingPrompt.py` — place the checker in the main file.
- Test-case generation — **no change** on the function-based path: cases store the
  reference's real answer exactly as today. Grounding stays meaningful because the
  reference, run through its own driver, must reproduce the stored answer.
- `benchmark_suite.py` — delete `is_open_ended_problem` and its four call sites; kill
  scoring reads the driver's verdict.
- `generate_brute_force.py`, `validate_solutions.py` — stop relaxing checks on a regex
  match; a checker makes the cross-check valid again.
- `prepare_platform_json.py`, execution managers — **no change**, already support both
  shapes.

## Resolved questions

Investigated 2026-08-14 and decided; recorded here with the evidence behind each.

### Where "open-ended" is decided — the description step (answered)

`description` is the first step in the pipeline and already owns the DETERMINISTIC
ANSWER rule, so it is the only place that decides.

**The rule stops being mandatory.** It exists only because grading could not accept more
than one answer. Both paths can now — a checker for function-based problems, an
enumerated list for the rest — so forcing every statement to invent a tie-break is no
longer required, and it should not be: demanding the lexicographically smallest
topological ordering changes what the problem tests.

What replaces it is three obligations on the description step:

1. **Emit an explicit `open_ended` flag.** Prose is not a reliable signal — the current
   regex cannot tell a resolved tie-break from an unresolved one (see the table above).
   A flag decided at authoring time is, and it is what tells the downstream steps whether
   a checker (function-based) or an enumerated list (non-function) is required. Nothing
   downstream should ever re-derive this from text.
2. **Keep a tie-break when it is natural to the problem, drop it when it is not.**
   "Smallest index" costs a topological-sort problem nothing and keeps it single-answer;
   "lexicographically smallest ordering" distorts it. Where a tie-break is dropped, the
   flag must be set.
3. **Worked examples still show one concrete answer.** Students need to see the shape of
   a valid output. But the statement must not claim that answer is the only one when the
   flag is set, or the examples contradict the grading.

### The worked examples need care in both paths

`sync_example_testcases` forces test cases 1-2 to match the description's worked
examples. That interacts with both paths and must be handled explicitly:

- **Function-based:** no hazard. The driver prints an answer, so the stored output is a
  real answer and the sync behaves exactly as it does for a single-answer problem. This
  is a direct benefit of printing answers rather than verdicts — the verdict design would
  have made the two visible cases fail for everyone, including a correct solution.
- **Non-function-based:** the example's stated answer must appear **in** the case's
  `outputs` list. If enumeration produced a list that omits the answer printed in the
  problem statement, the statement and the grader disagree, and the student who copies
  the worked example fails.

Both are cheap assertions and both should be tested, because each fails silently.

**Signature extraction is NOT at risk.** `signatureExtractionPrompt.py` reads the
function signature out of the *description*, not the solution source, so a second
function in the reference cannot confuse it.

### A checker in the reference must survive four language paths (answered — and this is the real cost)

Two steps consume the reference solution as source:

- `naming` — `get_normalization_prompt(code, ...)` rewrites the solution to house style.
  The checker must come through with a **stable name**, because the driver calls it by
  name.
- `translate_cpp` / `translate_java` / `translate_nodejs` —
  `get_conversion_prompt(target_language, source_code, ...)` translates the reference
  into each enabled language.

So a checker is not one function — it is **one per enabled language**, produced by
translation. If the Java translation of the checker is subtly wrong, Java submissions are
graded by a different standard than Python ones, and nothing downstream would notice.

This is the largest risk in the design and needs a mitigation before implementation.
The natural one: extend B2 to run the reference and the known-wrong solutions through
*every* enabled language's driver, not just Python — the reference must match the stored
answer everywhere and the wrong solutions must mismatch. A translation that broke the
checker then fails the gate. `BENCHMARK_USE_COMPILER=1` already reaches the compiler,
which is what makes a per-language check affordable.

### Non-function-based problems: enumerate, never block (decided)

These have no driver, so a checker cannot grade them at runtime. They are **not**
rejected and never block the pipeline. Instead the problem is flagged as
multiple-answer and prepared with every valid answer stored on the case:
`multiple_possible_output: true` plus an `outputs: [...]` list. Probed working
2026-08-14 — any entry in the list passes, anything outside it fails.

So the tie-break rule is no longer the only option for these problems, and a description
that legitimately admits several answers can ship as written.

## One checker, two uses

Both paths need the same artifact, used at different times:

| aspect | function-based | non-function-based |
| --- | --- | --- |
| where the checker runs | in the driver, at grading time | in our pipeline, at generation time |
| what ships | the reference's answer, as normal | the enumerated `outputs: [...]` list |
| cap on input size | none | bounded by the answer count |

For non-function problems the checker is what makes enumeration trustworthy: walk the
candidate output space for a case, keep everything the checker accepts, and the resulting
list is provably complete because we enumerated the space rather than trusting a model to
recall every answer. The checker never ships — it is a generation-time tool.

### The limit this imposes, and how to live with it

The answer count explodes with input *shape*, not size: a topological sort over 8
unconstrained nodes has 40,320 valid orderings, while a 100,000-node chain has exactly
one. So enumeration is bounded by how the input is built, not by n.

**There is deliberately no fixed cap on stored answers.** A sensible number for one
problem is wrong for the next, so a constant would either reject legitimate cases or
wave through absurd ones. The limit is per-problem and emergent.

What replaces it is a hard property, not a number:

- **A stored list must be provably exhaustive.** We ship the answers only when the
  candidate space was walked to completion. A partial list marks correct answers wrong,
  which is the exact bug this design exists to remove — so a truncated list is never an
  acceptable outcome. If enumeration cannot finish, the case does not ship as
  multi-answer.
- **Stress cases are shaped for a unique answer.** Large inputs carry the timing
  coverage, so they are built so only one output is valid (chain-shaped rather than
  sparse). Small cases carry the multi-answer coverage. This is what keeps enumeration
  bounded without a policy cap: the generator controls the answer count through the input
  it chooses.

Enumeration cost is the real ceiling and it is superexponential — 10 unconstrained nodes
is 3.6M candidate orderings to check, 12 is 479M. So the generation prompt must instruct
the generator to keep multi-answer cases small enough to enumerate, and to fall back to a
unique-answer input shape when they are not. Storage is not the binding constraint:
oversized outputs already upload to S3 (`_build_output_object`).
