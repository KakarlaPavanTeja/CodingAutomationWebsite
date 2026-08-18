# Open-Ended Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop forcing every problem to have exactly one right answer. Where a problem
legitimately admits many, grade it with a problem-specific **checker** compiled into the
driver (function-based) or with an enumerated `outputs: [...]` list (non-function), and
delete the prose regex that currently switches real checks off.

**Architecture:** The description step decides `open_ended` once, at authoring time, and
persists it to `Outputs/problem_flags.json`. It also stops inventing example outputs: it
generates the statement, executes the reference against it, and reconciles — with separate,
bounded repair paths for "the description is wrong" and "the code is wrong". When the flag
is set, the naming step emits `is_valid_answer` / `reference_answer` as **top-level**
functions in the reference source; `code_splitter.py` lifts them into `driver_code`, and the
driver's Output Area prints `reference_answer(...)` for a valid student result and the
student's own result otherwise — never a verdict. Non-function problems have no driver, so
the generator script enumerates the valid answers instead. `is_open_ended_problem` is
deleted and the four checks it disabled are restored.

**Tech Stack:** Python 3 (stdlib `unittest`), no new dependencies. Tests live in
`pipeline/Scripts/tests/`, run with `npm run test:json`.

**Spec:** `docs/superpowers/specs/2026-08-14-open-ended-checker-design.md`

## Global Constraints

- Branch: `redesign/testcase-generation`. Never commit to `main`.
- All work is inside `pipeline/Scripts/` except Task 1 Step 7, which adds one line to
  `src/lib/output-file-groups.ts`.
- Test runner: `npm run test:json` (from repo root) =
  `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest discover -s tests -p 'test_*.py'`.
  It must be green at the end of every task. **Current baseline: 272 tests.**
- `npx tsc --noEmit` stays clean if any TypeScript is touched.
- Tests use stdlib `unittest`, class-based, with this exact import preamble (matching the
  existing tests):
  ```python
  import os, sys, unittest
  SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
  sys.path.insert(0, SCRIPT_DIR)
  ```
- **No test may reach a live LLM.** Every LLM-touching function in this plan takes an
  injectable `llm=None` parameter that defaults to `call_llm`, and every test passes a
  `FakeLLM`. Copy the pattern from `pipeline/Scripts/tests/test_io_contract_llm.py:35-47`
  (a callable returning `(content, usage_dict)` and recording its prompts). Modules that
  import `httpx`/`openai`/`dotenv`/`psycopg2`/`requests` transitively must be stubbed the
  same way that file does at lines 24-29.
- Never log secrets, tokens or API keys. Preserve every `update_usage(...)` call on LLM
  paths — in `generate_full_question.py` that means keeping the `_track_llm_usage(usage, …)`
  line next to every `call_llm(...)`, and in `testcase_manager_v4.py` the inline
  `update_usage(...)` block at lines 384-390.
- **Tags stay plain strings.** Semantic subtask names live in the root-level `subtask_names`
  map, never inside a tag. Nothing in this plan writes a tag.
- Stable checker names, used verbatim by every language's driver and by every step before
  the split: **`reference_answer`** and **`is_valid_answer`**. Never problem-specific names
  like `is_valid_arrangement` — the driver calls them by name and cannot guess.

## Facts verified against the tree on 2026-08-17 (the spec is stale on several)

Read this before starting. Three of the spec's file references do not survive contact with
the code.

1. **`descriptionPrompt.py:421` is dead code.** `get_description_spec_prompt` (line 385) has
   **zero callers**; so do `get_description_prose_prompt` (284),
   `get_description_examples_prompt` (322), `assemble_description_parts` (439) and the three
   private helpers `_get_rephrasing_mode` (172), `_get_naming_requirements` (218),
   `_get_io_truth_context` (237). `generate_full_question.py:8` imports exactly two names:
   `get_description_prompt` and `get_nonfunction_description_prompt`. Editing line 421 would
   change nothing — this is the exact class of defect the previous plan shipped.
   **The live function-based description prompt carries no deterministic-answer rule at all**
   (`grep -n "DETERMINISTIC ANSWER" Prompts/descriptionPrompt.py` → only 421 and 840). That
   is why today's loaded sample ships an unpinned two-sum.
2. **The live prompts are four, not two:** `get_description_prompt` (445) and
   `get_nonfunction_description_prompt` (788), each of which early-returns to
   `get_structure_only_prompt` (28) / `get_nonfunction_structure_only_prompt` (700) when
   `scenario_level == "none"` (lines 460 and 791). All four need the change.
3. **The driver markers are not what the spec quotes.** The spec shows
   `# --- Output Area Start ---`; that dashed form exists only in
   `pipeline/zReferenceFiles/.../Python/NonNodeTypeDriverCode.py:28`, which **no Python
   script reads**. The real markers, inside the `get_splitting_prompt` f-string, are:
   `# Output Area Start ` (splittingPrompt.py:272 — note the **trailing space**) and
   `# Output Area End` (274). C++ uses `// Output Area Start` (347), Java `// Output Area
   Start` (470), Node.js `// Output Printing Area Start` (552).
4. **There is no `split_code` function.** `split_code` is a pipeline step id
   (`src/lib/pipeline-config.ts:84`). `code_splitter.py` defines `clean_json_string` (15),
   `save_split_code` (26) and `main` (107), and makes one LLM call per language at
   `code_splitter.py:189-190`. It produces `Outputs/CodeContentFiles/<Lang>/{default,solution,
   driver,debugger}<ext>` — **no `main.py`**; the main file is assembled later by
   `execution_manager_v3.py` (`LANG_CONFIG`, 115-140). So "put the checker in the main file"
   concretely means **put it in `driver_code`**.
5. **The checker cannot be a method of `solution`.** The Python driver template opens with
   `from solution import solution` (splittingPrompt.py:247) — at grading time that is the
   **student's** class. Anything the driver needs must be a module-level function in the
   driver file itself.
6. **The carrier for function vs non-function is `question_kind`**
   (`"function"` / `"nonfunction"`, parsed at `generate_full_question.py:153-155`). The
   parameter literally named `question_type` inside `descriptionPrompt.py` receives
   **`structure_type`** (`standard` / `linked list` / `binary tree`). Do not confuse them.
7. **The reconcile machinery already exists but does not use the compiler API.** The spec
   says examples are re-run "through the compiler API"; `resolve_example_stdin`
   (`testcase_manager_v4.py:319`) and `verify_io_contract` (404) run the reference through
   `_run_reference_on_input` (265), a local `subprocess.run([python3, path])`. This plan
   reuses them as-is. Routing example reconciliation through the compiler is out of scope.
8. `verify_io_contract(description, optimal_path, outputs_dir="Outputs", llm=None)` returns
   `{"verified": bool, "pairs": [...], "mismatches": [...], "reason": str}` and writes
   `Outputs/io_contract.json`. It is called once in production, at
   `testcase_manager_v4.py:874`, with `optimal_path = "Outputs/generatedFullCode/PYTHON.py"`
   (772) — i.e. the **normalized** solution.

---

### Task 1: The description step decides `open_ended` and persists it

**Files:**
- Create: `pipeline/Scripts/problem_flags.py`
- Modify: `pipeline/Scripts/Prompts/descriptionPrompt.py` — all four live builders; delete
  the seven dead symbols listed in fact 1
- Modify: `pipeline/Scripts/generate_full_question.py` — `run_description_step` (403)
- Modify: `src/lib/output-file-groups.ts` — `QUESTION_ROOT_FILES` (74)
- Test: `pipeline/Scripts/tests/test_problem_flags.py` (create)

**Interfaces:**
- Produces `pipeline/Scripts/problem_flags.py`:
  - `OPEN_ENDED_MARKER_RE` — the compiled pattern matching the trailer the model emits.
  - `split_open_ended_marker(text) -> (clean_description, open_ended: bool, reason: str)`
  - `save_problem_flags(open_ended, reason, outputs_dir) -> dict`
  - `load_open_ended(outputs_dir="Outputs") -> bool`
- Consumed by: Task 3 (naming step), Task 4 (splitter), Task 6 (testcase generation),
  Task 7 (B2 / brute cross-check / validate).
- Artifact: `Outputs/problem_flags.json` = `{"open_ended": bool, "reason": str}`.

Why a file and not a regex: the detector this design deletes is a regex, and the spec's own
table shows it cannot tell a resolved tie-break from an unresolved one. Nothing downstream
may re-derive this from prose. There is no existing JSON the description step writes —
`description_signature.json` is written by the **naming** step, which is skipped entirely
for non-function problems (`generate_full_question.py:433-436`), so it cannot carry the flag.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_problem_flags.py`:

```python
"""`open_ended` is decided once, at authoring time, and written down.

The regex it replaces (`is_open_ended_problem`) matched the wording a description MUST use
when it spells out a tie-break, so the better a description followed the rule the more
likely its checks were switched off. A flag written by the step that made the decision is
the only reliable signal.
"""

import json
import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from problem_flags import (  # noqa: E402
    load_open_ended,
    save_problem_flags,
    split_open_ended_marker,
)


class TestSplitOpenEndedMarker(unittest.TestCase):
    def test_reads_the_flag_and_strips_the_trailer(self):
        text = (
            "**Output Format**\n\nPrint any valid ordering.\n\n"
            "<!-- OPEN_ENDED: true reason=any topological order is acceptable -->\n"
        )
        clean, open_ended, reason = split_open_ended_marker(text)
        self.assertTrue(open_ended)
        self.assertEqual(reason, "any topological order is acceptable")
        self.assertNotIn("OPEN_ENDED", clean, "the marker must never reach the platform")
        self.assertTrue(clean.endswith("Print any valid ordering."))

    def test_false_marker_is_read_as_false(self):
        clean, open_ended, reason = split_open_ended_marker(
            "Print the sum.\n\n<!-- OPEN_ENDED: false reason=one answer -->\n")
        self.assertFalse(open_ended)
        self.assertEqual(clean, "Print the sum.")

    def test_a_missing_marker_defaults_to_false(self):
        clean, open_ended, reason = split_open_ended_marker("Print the sum.\n")
        self.assertFalse(open_ended, "absent marker must never be read as open-ended")
        self.assertEqual(clean, "Print the sum.")
        self.assertEqual(reason, "")

    def test_the_marker_is_matched_case_insensitively_and_with_loose_spacing(self):
        _, open_ended, _ = split_open_ended_marker("x\n<!--open_ended:TRUE reason=y-->")
        self.assertTrue(open_ended)

    def test_only_the_last_marker_wins_and_all_are_stripped(self):
        """The model sometimes echoes an example marker mid-answer. The decision is the
        one it ends on, and no copy may survive into the shipped description."""
        clean, open_ended, _ = split_open_ended_marker(
            "a\n<!-- OPEN_ENDED: false reason=x -->\nb\n<!-- OPEN_ENDED: true reason=y -->")
        self.assertTrue(open_ended)
        self.assertNotIn("OPEN_ENDED", clean)


class TestProblemFlagsRoundTrip(unittest.TestCase):
    def test_save_then_load(self):
        with tempfile.TemporaryDirectory() as d:
            save_problem_flags(True, "any valid arrangement", d)
            self.assertTrue(load_open_ended(d))
            with open(os.path.join(d, "problem_flags.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["reason"], "any valid arrangement")

    def test_a_missing_file_is_not_open_ended(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(load_open_ended(d))

    def test_a_corrupt_file_is_not_open_ended(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "problem_flags.json"), "w", encoding="utf-8") as f:
                f.write("{not json")
            self.assertFalse(load_open_ended(d))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_problem_flags -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'problem_flags'`

- [ ] **Step 3: Write the implementation**

Create `pipeline/Scripts/problem_flags.py`:

```python
"""Author-time problem flags, written once by the description step.

`open_ended` says the problem legitimately admits more than one correct answer. It
replaces `is_open_ended_problem`, a prose regex that matched the phrasing a description
MUST use when it DOES pin an answer down ("if there are multiple ... return the smallest
first index") and so switched real checks off on the descriptions that followed the rules
best. Nothing downstream may re-derive this from text: read the flag.
"""

import json
import os
import re

FLAGS_FILENAME = "problem_flags.json"

# The model appends this as an HTML comment so it is invisible in rendered markdown even
# if a strip ever regresses. `reason` is free text and runs to the end of the comment.
OPEN_ENDED_MARKER_RE = re.compile(
    r"<!--\s*OPEN_ENDED\s*:\s*(true|false)\s*(?:reason\s*=\s*(.*?))?\s*-->",
    re.IGNORECASE | re.DOTALL,
)


def split_open_ended_marker(text):
    """Return (description without any marker, open_ended, reason).

    Last marker wins — the model occasionally echoes the example marker mid-answer, and
    the decision is the one it ends on. Absent marker means NOT open-ended: a missing
    decision must never silently enable the lenient path.
    """
    body = text or ""
    matches = list(OPEN_ENDED_MARKER_RE.finditer(body))
    if not matches:
        return body.strip(), False, ""
    last = matches[-1]
    open_ended = last.group(1).strip().lower() == "true"
    reason = (last.group(2) or "").strip()
    return OPEN_ENDED_MARKER_RE.sub("", body).strip(), open_ended, reason


def save_problem_flags(open_ended, reason, outputs_dir):
    flags = {"open_ended": bool(open_ended), "reason": str(reason or "")}
    os.makedirs(outputs_dir, exist_ok=True)
    with open(os.path.join(outputs_dir, FLAGS_FILENAME), "w", encoding="utf-8") as f:
        json.dump(flags, f, indent=4, ensure_ascii=False)
    return flags


def load_open_ended(outputs_dir="Outputs"):
    """False on a missing or unreadable file — never guess open-ended."""
    try:
        with open(os.path.join(outputs_dir, FLAGS_FILENAME), encoding="utf-8") as f:
            return bool(json.load(f).get("open_ended", False))
    except (OSError, ValueError, AttributeError):
        return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_problem_flags -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Rewrite the rule in all four LIVE description builders**

In `pipeline/Scripts/Prompts/descriptionPrompt.py`, add this module-level constant near
`_CONSTRAINTS_NO_META`:

```python
_ANSWER_DETERMINACY_RULE = """
**ANSWER DETERMINACY (you MUST end your reply with the marker below):**
- If the task could admit MORE THAN ONE valid output (e.g. "the indices of a pair summing
  to k" when several pairs qualify, "any valid arrangement", multiple shortest paths),
  decide ONE of two things and say which:
  - **Add a tie-break** when a tie-break is natural to the problem and costs it nothing —
    e.g. "return the pair with the smallest first index, breaking ties by the smallest
    second index". Put the rule in **Output Format**. Prefer this whenever it applies.
  - **Leave it open** when a tie-break would change what the problem tests — demanding the
    lexicographically smallest topological ordering turns a graph problem into a
    graph-plus-sorting problem. Then the statement must say the answer is not unique
    (e.g. "any valid ordering is accepted") and MUST NOT claim the shown answer is the
    only one.
- Worked examples ALWAYS show exactly one concrete answer either way — the reader needs to
  see the shape of a valid output.
- Finish your reply with EXACTLY ONE of these two lines and nothing after it:
      <!-- OPEN_ENDED: false reason=<why one answer is pinned down> -->
      <!-- OPEN_ENDED: true reason=<why a tie-break would distort the problem> -->
  Emit `true` only when you left it open. If a tie-break is stated, emit `false`.
"""
```

Interpolate `{_ANSWER_DETERMINACY_RULE}` into all four live builders, immediately after the
existing Output Format rules:

| builder | line today | where |
| --- | --- | --- |
| `get_structure_only_prompt` (28) | — | in the **Output Format** rules block |
| `get_description_prompt` (445) | — | in the **Output Format** rules block |
| `get_nonfunction_structure_only_prompt` (700) | — | in the **Output Format** rules block |
| `get_nonfunction_description_prompt` (788) | 840-846 | **replace** the existing DETERMINISTIC ANSWER bullet |

Note `get_description_prompt` and `get_structure_only_prompt` have **no** determinacy rule
today, which is why the pipeline currently ships unpinned function problems. This adds one.

Then delete the dead symbols so nobody patches them again — `get_description_prose_prompt`
(284), `get_description_examples_prompt` (322), `get_description_spec_prompt` (385, the
spec's "~line 421"), `assemble_description_parts` (439), `_get_rephrasing_mode` (172),
`_get_naming_requirements` (218), `_get_io_truth_context` (237).

Confirm nothing imported them before deleting:

```bash
cd pipeline/Scripts && grep -rn "get_description_prose_prompt\|get_description_examples_prompt\|get_description_spec_prompt\|assemble_description_parts\|_get_rephrasing_mode\|_get_naming_requirements\|_get_io_truth_context" . --include="*.py" | grep -v "Prompts/descriptionPrompt.py:"
```
Expected: no output.

- [ ] **Step 6: Wire the flag into `run_description_step`**

In `pipeline/Scripts/generate_full_question.py`, import at the top:

```python
from problem_flags import save_problem_flags, split_open_ended_marker
```

and in `run_description_step` (403) replace the `_strip_scratchpad` / `_save_description`
sequence at lines 415-420 with:

```python
    desc_response = _strip_scratchpad(desc_response)
    if scenario_level == "none":
        desc_response = normalize_renderer_safe(desc_response)

    _track_llm_usage(desc_usage, f"{problem_name}_description")
    desc_response, open_ended, open_ended_reason = split_open_ended_marker(desc_response)
    save_problem_flags(open_ended, open_ended_reason, OUTPUT_DIR)
    _save_description(desc_response)
    print(f"✓ open_ended={open_ended}"
          + (f" — {open_ended_reason}" if open_ended_reason else ""))
```

`_track_llm_usage` stays exactly where it is, before the strip — usage is recorded on the
raw response regardless of what the marker says.

- [ ] **Step 7: Show the flag file in the Outputs UI**

In `src/lib/output-file-groups.ts`, add one entry to `QUESTION_ROOT_FILES` (74):

```ts
  "problem_flags.json",
```

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 280 tests (272 + 8).

- [ ] **Step 9: Commit**

```bash
git add -A pipeline/Scripts src/lib/output-file-groups.ts
git commit -m "feat(description): decide open_ended at authoring time and write it down"
```

---

### Task 2: Generate → execute → reconcile the description's worked examples

**Files:**
- Modify: `pipeline/Scripts/generate_full_question.py` — `run_description_step` (403)
- Test: `pipeline/Scripts/tests/test_description_reconcile.py` (create)

**Interfaces:**
- Consumes: `verify_io_contract(description, optimal_path, outputs_dir, llm=None)` from
  `testcase_manager_v4.py:404` — it already converts a display-form Example block to raw
  stdin (`resolve_example_stdin`, 319) and accepts a layout only when the reference
  reproduces the stated answer. Do not rebuild any of that.
- Produces: `reconcile_description(problem_name, desc_prompt, problem_content, optimal_path,
  outputs_dir, scenario_level, llm=None, verifier=None, max_attempts=3) -> (description, dict)`
  in `generate_full_question.py`. The dict is
  `{"verified": bool, "attempts": int, "repairs": ["description"|"code", ...], "reason": str}`.
- `verifier` defaults to `verify_io_contract` and is injected in tests. `llm` defaults to
  `call_llm`.

Why this task exists: `sync_example_testcases` (`testcase_helpers.py:272`) forces test cases
1-2 to equal the description's Examples. If the model invented an Example output the
reference does not produce, case 1 fails for **every** student including a perfect one. Today
the blame points the wrong way — `optimal_example_failures` (`benchmark_suite.py:1313`)
reports a mismatch as "the reference is buggy" when the reference is the user's real working
code and the Example is the invented artifact.

**The two repair paths must stay separate.** A `verify_io_contract` mismatch entry whose
`got` is `<error>` or `<timeout>` means the code failed to run — repair the code. A mismatch
entry whose `got` is a real string means the code ran and disagreed — execution is the truth,
so repair the statement. They look alike and have opposite fixes; conflating them is how a
broken reference gets papered over by editing the statement.

**Bound:** `MAX_DESCRIPTION_ATTEMPTS = 3` (one generation plus at most two repairs). On
exhaustion, print a hard failure naming which side was last repaired. Unbounded "ask the
model to fix it" oscillates between the two repairs forever.

**Scope guard:** `_run_reference_on_input` (`testcase_manager_v4.py:265`) shells out to
`python3 <path>`. Reconciliation therefore only runs when `detected_lang` is Python; for a
C++/Java reference it is skipped with a printed reason, and `verify_io_contract` at
`testcase_manager_v4.py:874` remains the (later) checkpoint.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_description_reconcile.py`:

```python
"""Execution decides the worked examples; the model only writes prose.

`sync_example_testcases` forces test cases 1-2 to equal the description's Examples. If the
model invents an output the reference does not produce, case 1 fails for EVERY student
including a perfect solution — silently, three steps downstream. So the description step
runs the reference against its own Examples and reconciles.

Repairing the description and repairing the code are OPPOSITE fixes for symptoms that look
alike, so they get separate paths and the loop is bounded.
"""

import os
import sys
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

import generate_full_question as gfq  # noqa: E402


class FakeLLM:
    """Returns queued replies; records the prompts it was given. Never touches a network."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    def __call__(self, system, user, **kwargs):
        self.prompts.append((system, user))
        return self.replies.pop(0), {"prompt_tokens": 1, "completion_tokens": 1,
                                     "model": "fake", "cost": 0.0}


def ok(_desc, _path, _dir="Outputs", llm=None):
    return {"verified": True, "pairs": [{"example": 1, "stdin": "1\n", "stdout": "1",
                                         "expected": "1"}],
            "mismatches": [], "reason": ""}


def disagrees(_desc, _path, _dir="Outputs", llm=None):
    """The reference RAN and printed something else -> the description is wrong."""
    return {"verified": False, "pairs": [],
            "mismatches": [{"example": 1, "stdin": "1\n", "expected": "9", "got": "1"}],
            "reason": ""}


def crashes(_desc, _path, _dir="Outputs", llm=None):
    """The reference did not run -> the CODE is wrong, not the description."""
    return {"verified": False, "pairs": [],
            "mismatches": [{"example": 1, "stdin": "1\n", "expected": "9",
                            "got": "<error>", "detail": "ZeroDivisionError"}],
            "reason": ""}


class TestReconcileDescription(unittest.TestCase):
    def test_agreement_costs_one_generation_and_no_repair(self):
        llm = FakeLLM("DESC v1")
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", "/tmp/sol.py", "/tmp", "moderate", llm=llm, verifier=ok)
        self.assertEqual(desc, "DESC v1")
        self.assertTrue(info["verified"])
        self.assertEqual(info["attempts"], 1)
        self.assertEqual(info["repairs"], [], "the common case must not repair anything")
        self.assertEqual(len(llm.prompts), 1)

    def test_a_disagreement_repairs_the_description_not_the_code(self):
        seq = iter([disagrees, ok])
        llm = FakeLLM("DESC v1", "DESC v2")
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", "/tmp/sol.py", "/tmp", "moderate", llm=llm,
            verifier=lambda *a, **k: next(seq)(*a, **k))
        self.assertEqual(desc, "DESC v2")
        self.assertEqual(info["repairs"], ["description"])
        repair_prompt = llm.prompts[1][1]
        self.assertIn("1", repair_prompt, "the repair must show what the reference printed")
        self.assertIn("9", repair_prompt, "and what the statement claimed")

    def test_a_crash_repairs_the_code_and_never_edits_the_statement(self):
        seq = iter([crashes, ok])
        llm = FakeLLM("DESC v1", "def solve():\n    return 1\n")
        written = {}
        gfq._save_working_code_for_test = written  # sanity anchor, see Step 3
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", "/tmp/sol.py", "/tmp", "moderate", llm=llm,
            verifier=lambda *a, **k: next(seq)(*a, **k), code_writer=written.__setitem__)
        self.assertEqual(info["repairs"], ["code"])
        self.assertEqual(desc, "DESC v1", "a crashing reference must NOT rewrite the statement")
        self.assertIn("code", written, "the repaired reference must be written back")

    def test_the_loop_is_bounded_and_names_the_side_it_was_repairing(self):
        llm = FakeLLM("v1", "v2", "v3")
        desc, info = gfq.reconcile_description(
            "P", "SYS", "raw", "/tmp/sol.py", "/tmp", "moderate", llm=llm,
            verifier=disagrees, max_attempts=3)
        self.assertFalse(info["verified"])
        self.assertEqual(info["attempts"], 3, "never more than max_attempts generations")
        self.assertEqual(len(llm.prompts), 3)
        self.assertIn("description", info["reason"])

    def test_usage_is_recorded_for_every_call_including_repairs(self):
        seen = []
        orig = gfq._track_llm_usage
        gfq._track_llm_usage = lambda usage, label, purpose="chat": seen.append(label)
        try:
            seq = iter([disagrees, ok])
            gfq.reconcile_description(
                "P", "SYS", "raw", "/tmp/sol.py", "/tmp", "moderate",
                llm=FakeLLM("v1", "v2"),
                verifier=lambda *a, **k: next(seq)(*a, **k))
        finally:
            gfq._track_llm_usage = orig
        self.assertEqual(len(seen), 2, "every LLM call must be tracked, repairs included")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_description_reconcile -v`
Expected: FAIL with `AttributeError: module 'generate_full_question' has no attribute 'reconcile_description'`

- [ ] **Step 3: Write the implementation**

Add to `pipeline/Scripts/generate_full_question.py`, above `run_description_step`:

```python
MAX_DESCRIPTION_ATTEMPTS = 3

_DESC_REPAIR_SYSTEM = (
    "You are correcting a coding-problem statement. The reference solution is the source "
    "of truth: it RAN and printed the outputs shown below. Rewrite the statement so its "
    "worked Examples show what the reference actually prints, and so the Output Format "
    "describes that. Change nothing else — same scenario, same variable names, same "
    "constraints. Return the FULL corrected statement in the same markdown format, and "
    "keep the trailing OPEN_ENDED marker line."
)

_CODE_REPAIR_SYSTEM = (
    "You are repairing a reference solution that CRASHED or timed out on the problem "
    "statement's own worked Example inputs. Do NOT change the problem statement. Return "
    "ONLY the corrected full solution source, no markdown fences and no commentary."
)


def _mismatch_side(contract):
    """'code' when the reference did not run, 'description' when it ran and disagreed.

    These look alike from a distance and have opposite fixes. `verify_io_contract` writes
    `got` as `<error>` / `<timeout>` for a failed run and as the real stdout otherwise;
    an unconvertible display block carries its reason in `detail`."""
    for m in contract.get("mismatches") or []:
        blob = f"{m.get('got', '')} {m.get('detail', '')}"
        if "<error>" in blob or "<timeout>" in blob:
            return "code"
    return "description"


def _format_mismatches(contract):
    lines = []
    for m in contract.get("mismatches") or []:
        lines.append(
            f"- example {m.get('example')}:\n"
            f"    stdin           : {m.get('stdin')!r}\n"
            f"    statement claims: {m.get('expected')!r}\n"
            f"    reference printed: {m.get('got')!r}"
            + (f"  ({m.get('detail')!r})" if m.get("detail") else "")
        )
    return "\n".join(lines)


def reconcile_description(problem_name, desc_prompt, problem_content, optimal_path,
                          outputs_dir, scenario_level, llm=None, verifier=None,
                          code_writer=None, max_attempts=MAX_DESCRIPTION_ATTEMPTS):
    """Generate the statement, execute the reference against its own Examples, reconcile.

    The reference solution is an INPUT to this pipeline — it exists before the statement is
    written — so execution decides the example outputs and the model only writes prose.
    That removes a whole class of wrong-worked-example bugs instead of detecting them three
    steps later, and it is what makes `reference_answer` agree with Example 1 by
    construction for open-ended problems.

    Returns (description, {"verified", "attempts", "repairs", "reason"}).
    """
    if llm is None:
        llm = call_llm
    if verifier is None:
        from testcase_manager_v4 import verify_io_contract as verifier
    if code_writer is None:
        def code_writer(_key, code):
            with open(optimal_path, "w", encoding="utf-8") as f:
                f.write(code)

    description = ""
    repairs = []
    system, user = desc_prompt, problem_content
    for attempt in range(1, max_attempts + 1):
        content, usage = llm(system, user, purpose="chat")
        _track_llm_usage(usage, f"{problem_name}_description")
        cleaned = _strip_scratchpad(content)
        if scenario_level == "none":
            cleaned = normalize_renderer_safe(cleaned)
        if repairs and repairs[-1] == "code":
            # The model returned SOURCE, not a statement: keep the statement we had.
            code_writer("code", cleaned)
        else:
            description = cleaned

        contract = verifier(description, optimal_path, outputs_dir, llm=llm)
        if contract.get("verified"):
            return description, {"verified": True, "attempts": attempt,
                                 "repairs": repairs, "reason": ""}
        if not (contract.get("mismatches") or []):
            # Nothing parseable to reconcile against — not a defect we can repair.
            return description, {"verified": False, "attempts": attempt,
                                 "repairs": repairs,
                                 "reason": contract.get("reason") or "no parseable Examples"}
        if attempt == max_attempts:
            break
        side = _mismatch_side(contract)
        repairs.append(side)
        detail = _format_mismatches(contract)
        if side == "code":
            system = _CODE_REPAIR_SYSTEM
            with open(optimal_path, "r", encoding="utf-8") as f:
                user = (f"STATEMENT:\n{description}\n\nCURRENT SOLUTION:\n{f.read()}\n\n"
                        f"It failed on the statement's own Examples:\n{detail}")
        else:
            system = _DESC_REPAIR_SYSTEM
            user = (f"CURRENT STATEMENT:\n{description}\n\n"
                    f"The reference solution disagrees with it:\n{detail}")

    side = repairs[-1] if repairs else "description"
    return description, {"verified": False, "attempts": max_attempts, "repairs": repairs,
                         "reason": f"gave up after {max_attempts} attempts while "
                                   f"repairing the {side}"}
```

Then rewrite the body of `run_description_step` (403) so the single `call_llm` at line 414
becomes a `reconcile_description` call. Keep `_track_llm_usage` — it now lives inside the
loop, so **delete the standalone call at line 419** rather than double-counting:

```python
    optimal_path = _working_code_path(detected_lang)
    if detected_lang.lower() == "python":
        desc_response, recon = reconcile_description(
            problem_name, desc_prompt, problem_content, optimal_path,
            OUTPUT_DIR, scenario_level,
        )
        if recon["verified"]:
            print(f"✓ Examples reconciled against the reference "
                  f"({recon['attempts']} attempt(s), repairs={recon['repairs'] or 'none'})")
        else:
            print(f"⚠ Examples NOT reconciled — {recon['reason']}. "
                  f"verify_io_contract will re-check at generate_testcases.")
    else:
        # `_run_reference_on_input` shells out to python3, so a C++/Java reference cannot
        # be executed here. The generate_testcases checkpoint still covers it.
        desc_response, desc_usage = call_llm(desc_prompt, problem_content, purpose="chat")
        _track_llm_usage(desc_usage, f"{problem_name}_description")
        desc_response = _strip_scratchpad(desc_response)
        if scenario_level == "none":
            desc_response = normalize_renderer_safe(desc_response)
        print(f"ℹ Reference is {detected_lang}; skipping example reconciliation.")
```

followed by the `split_open_ended_marker` / `save_problem_flags` / `_save_description` block
from Task 1 Step 6.

Note the ordering decision recorded here: `run_description_step` also calls
`_save_working_code(user_code, detected_lang)` at line 423, which would discard a code
repair. Move that reset to run **before** `reconcile_description`, not after.

**Ordering wrinkle (spec, "Ordering wrinkle to resolve during planning") — decided.**
Reconciliation runs against the RAW reference at description time, because `naming` has not
run yet. `verify_io_contract` at `testcase_manager_v4.py:874` then re-runs the same check
against the **normalized** `Outputs/generatedFullCode/PYTHON.py`, which makes it exactly the
normalization-drift check the spec offers as its second option. No step moves.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_description_reconcile -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 285 tests.

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(description): reconcile worked examples against the reference"
```

---

### Task 3: The naming step emits the checker

**Files:**
- Modify: `pipeline/Scripts/Prompts/normalizationPrompt.py` — `get_normalization_prompt` (4)
- Modify: `pipeline/Scripts/generate_full_question.py` — `run_naming_step` (428)
- Test: `pipeline/Scripts/tests/test_open_ended_checker_source.py` (create)

**Interfaces:**
- New signature:
  `get_normalization_prompt(code, language, description_signature=None, desc_response=None, question_type="standard", open_ended=False)`
  — returns a single string, as today (`normalizationPrompt.py:159`).
- Produces `checker_defects(source: str) -> list[str]` in `pipeline/Scripts/problem_flags.py`
  — a static check on the emitted source. Empty list means the checker is well-formed.

**The contract, fixed here and used verbatim by every language and every consumer:**

```python
def reference_answer(stdin_text):
    """Return the exact stdout (no trailing newline) the reference prints for stdin_text."""

def is_valid_answer(stdin_text, candidate_stdout):
    """True iff candidate_stdout is a correct answer to the input in stdin_text."""
```

**Why text-in/text-out and not the spec's `is_valid_arrangement(numAPIs, runtimes, result)`.**
The spec sketches a parsed-argument checker. That form cannot be evaluated where the spec
most wants it evaluated: B2 runs at `select_testcases`, **before** `split_code`, so no driver
and no parsed arguments exist — B2 only ever has raw stdin and raw stdout
(`testcase_annotate.py:181-193`). The same is true of grounding
(`testcase_manager_v4._ground_against_reference:518`) and of non-function enumeration, which
has no function at all. One text-level contract serves the driver, B2, grounding and
enumeration; a parsed-argument one serves only the driver. The driver gets raw stdin back in
Task 5 with two lines.

**Two hard rules the naming prompt must state, both silently fatal if broken:**
1. Both functions are **module-level**, never methods of `solution`. The driver opens with
   `from solution import solution` (splittingPrompt.py:247) — at grading time that class is
   the **student's**. A checker inside it would grade the student against themselves.
2. `reference_answer` is **self-contained**: it must not call `solution`, not instantiate it,
   not delegate to it. It carries its own copy of the algorithm. This is the trade-off the
   spec accepts under "the reference ships inside the driver".

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_open_ended_checker_source.py`:

```python
"""The checker must be module-level and self-contained, or grading breaks silently.

The driver does `from solution import solution` — at grading time that is the STUDENT's
class. A checker written as a method of `solution`, or a `reference_answer` that delegates
to it, would grade every student against their own (possibly wrong) answer and mark
everyone correct. Nothing downstream would notice, so it is checked statically here.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from problem_flags import checker_defects  # noqa: E402
from Prompts.normalizationPrompt import get_normalization_prompt  # noqa: E402

GOOD = '''
class solution:
    def twoSum(self, nums, k):
        return [0, 1]


def reference_answer(stdin_text):
    parts = stdin_text.split()
    return "0 1"


def is_valid_answer(stdin_text, candidate_stdout):
    return candidate_stdout.strip() in ("0 1", "1 0")
'''


class TestCheckerDefects(unittest.TestCase):
    def test_a_well_formed_checker_has_no_defects(self):
        self.assertEqual(checker_defects(GOOD), [])

    def test_a_missing_function_is_a_defect(self):
        src = GOOD.replace("def is_valid_answer", "def isValidAnswer")
        self.assertIn("is_valid_answer", " ".join(checker_defects(src)))

    def test_a_checker_nested_in_the_solution_class_is_a_defect(self):
        src = '''
class solution:
    def reference_answer(self, stdin_text):
        return "0 1"

    def is_valid_answer(self, stdin_text, candidate_stdout):
        return True
'''
        defects = checker_defects(src)
        self.assertTrue(defects, "a method is not reachable from the driver")
        self.assertIn("module-level", " ".join(defects))

    def test_a_reference_answer_that_delegates_to_solution_is_a_defect(self):
        src = GOOD.replace('    return "0 1"\n\n\ndef is_valid',
                           '    return solution().twoSum([], 0)\n\n\ndef is_valid')
        self.assertIn("self-contained", " ".join(checker_defects(src)))

    def test_wrong_arity_is_a_defect(self):
        src = GOOD.replace("def reference_answer(stdin_text):",
                           "def reference_answer(a, b, c):")
        self.assertIn("reference_answer", " ".join(checker_defects(src)))

    def test_unparseable_source_is_reported_not_crashed(self):
        self.assertTrue(checker_defects("def (:"))


class TestNormalizationPrompt(unittest.TestCase):
    def test_the_checker_block_appears_only_when_open_ended(self):
        off = get_normalization_prompt("x", "python", None, "desc", "standard")
        on = get_normalization_prompt("x", "python", None, "desc", "standard",
                                      open_ended=True)
        self.assertNotIn("reference_answer", off)
        self.assertIn("reference_answer", on)
        self.assertIn("is_valid_answer", on)

    def test_the_prompt_states_both_silently_fatal_rules(self):
        on = get_normalization_prompt("x", "python", None, "desc", "standard",
                                      open_ended=True)
        self.assertIn("module-level", on)
        self.assertIn("self-contained", on)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_open_ended_checker_source -v`
Expected: FAIL with `ImportError: cannot import name 'checker_defects' from 'problem_flags'`

- [ ] **Step 3: Write the static check**

Append to `pipeline/Scripts/problem_flags.py`:

```python
import ast

CHECKER_NAMES = ("reference_answer", "is_valid_answer")
CHECKER_ARITY = {"reference_answer": 1, "is_valid_answer": 2}


def checker_defects(source):
    """Static defects in an open-ended checker. Empty list means it is well-formed.

    Every defect here fails SILENTLY at grading time, which is why it is a static gate and
    not a runtime hope: a checker nested in `solution` is shadowed by the student's class,
    and a `reference_answer` that delegates to `solution` grades every student against
    their own answer.
    """
    try:
        tree = ast.parse(source or "")
    except SyntaxError as e:
        return [f"the source does not parse ({e})"]

    top = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    nested = {n.name for cls in tree.body if isinstance(cls, ast.ClassDef)
              for n in cls.body if isinstance(n, ast.FunctionDef)}

    defects = []
    for name in CHECKER_NAMES:
        if name in top:
            args = top[name].args
            want = CHECKER_ARITY[name]
            got = len(args.args) + len(args.posonlyargs)
            if got != want:
                defects.append(f"{name} takes {got} argument(s), expected {want}")
        elif name in nested:
            defects.append(f"{name} must be module-level, not a method of a class — the "
                           f"driver imports the STUDENT's `solution`")
        else:
            defects.append(f"{name} is missing")

    ref = top.get("reference_answer")
    if ref is not None:
        for node in ast.walk(ref):
            if isinstance(node, ast.Name) and node.id == "solution":
                defects.append("reference_answer must be self-contained — it references "
                               "`solution`, which is the STUDENT's class at grading time")
                break
    return defects
```

- [ ] **Step 4: Add the checker block to the normalization prompt**

In `pipeline/Scripts/Prompts/normalizationPrompt.py`, add `open_ended=False` as the last
parameter of `get_normalization_prompt` (4) and interpolate this block into the returned
prompt string (before the final `return prompt` at 159):

```python
_OPEN_ENDED_CHECKER_BLOCK = '''
**OPEN-ENDED PROBLEM — ALSO EMIT A CHECKER (mandatory):**
This problem accepts more than one correct answer, so grading cannot compare text. After
the `solution` class, append EXACTLY these two functions, with these EXACT names:

```python
def reference_answer(stdin_text):
    """Return the exact stdout (no trailing newline) the reference prints for stdin_text."""

def is_valid_answer(stdin_text, candidate_stdout):
    """True iff candidate_stdout is a correct answer for the input in stdin_text."""
```

- Both MUST be **module-level** functions, NOT methods of `solution` and NOT nested.
- `reference_answer` MUST be **self-contained**: it may not call, instantiate or reference
  `solution` in any way. Duplicate whatever logic it needs.
- `is_valid_answer` MUST verify the answer against the problem's real condition (e.g. that
  the returned indices exist, are distinct and sum to the target). It MUST NOT simply
  compare against `reference_answer` — that would reject every valid alternative and defeat
  the point.
- `is_valid_answer(stdin, reference_answer(stdin))` MUST be True for every valid input.
- Keep the existing `solution` class and its stdin/stdout `main()` exactly as instructed
  above; the two functions are ADDITIONAL.
'''
```

In `run_naming_step` (`generate_full_question.py:428`), read the flag and pass it, then gate
on the static check:

```python
    from problem_flags import checker_defects, load_open_ended

    open_ended = load_open_ended(OUTPUT_DIR)
    refactor_prompt = get_normalization_prompt(
        user_code, detected_lang, description_signature, desc_response, structure_type,
        open_ended=open_ended,
    )
    ...
    renamed_code = clean_generated_code(renamed_code, detected_lang)
    if open_ended and detected_lang.lower() == "python":
        defects = checker_defects(renamed_code)
        if defects:
            print("ERROR: the emitted open-ended checker is malformed:")
            for d in defects:
                print(f"  - {d}")
            sys.exit(1)
```

`_track_llm_usage(refactor_usage, f"{problem_name}_refactor")` at line 458 stays exactly
where it is.

**Non-function problems:** `run_naming_step` returns early at
`generate_full_question.py:433-436`, so no checker is emitted for them — correct. They have
no driver, so their checker is generation-time only and is written by the generator script
(Task 6).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_open_ended_checker_source -v`
Expected: PASS (8 tests)

- [ ] **Step 6: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 293 tests.

- [ ] **Step 7: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(naming): emit a module-level checker for open-ended problems"
```

---

### Task 4: Load the checker, and ground the reference against its own driver behaviour

**Files:**
- Create: `pipeline/Scripts/open_ended_checker.py`
- Modify: `pipeline/Scripts/testcase_manager_v4.py` — `_ground_against_reference` (518) and
  its call sites in `main()` (974-1006)
- Test: `pipeline/Scripts/tests/test_open_ended_grounding.py` (create)

**Interfaces:**
- `load_checker(source_path) -> Checker | None` — imports the reference source and returns a
  small namespace exposing `reference_answer(stdin_text)` and
  `is_valid_answer(stdin_text, candidate_stdout)`. `None` when the file is missing or the
  functions are absent.
- `effective_output(checker, stdin_text, got, stored) -> str` — what the driver would print.
- Consumed by Task 6 (enumeration), Task 7 (B2, brute cross-check, validate) and Task 10.

**Why one module.** B2, grounding, the brute cross-check and `validate_solutions` all need
the same "would the driver have accepted this?" answer, and all of them run **before**
`split_code`, so none of them has a driver. `effective_output` is that one rule, written
once. Fixing it in each caller instead would be four places to get wrong.

**Grounding gains two assertions, both of which fail silently today.** Grounding runs the
reference, so its stdout already matches the stored `output` by construction; what it does
**not** check is whether the *checker* agrees, and a checker nobody exercised is a checker
that grades everyone wrong:

1. `reference_answer(inp) == stored_output` for every case — this is literally what the
   driver will print, so a `reference_answer` that disagrees with the shipped output fails
   every student on that case. **Cases 1-2 included**: those come from
   `sync_example_testcases` (`testcase_helpers.py:272`), i.e. from the description's worked
   examples, so this assertion is the concrete form of the spec's hazard
   "`reference_answer` must reproduce the description's worked example, byte for byte".
2. `is_valid_answer(inp, stored_output)` is True for every case — a checker too strict to
   accept its own reference's answer rejects a correct submission.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_open_ended_grounding.py`:

```python
"""A checker nobody exercised is a checker that grades everyone wrong.

Two assertions, both of which fail SILENTLY without them:
  1. `reference_answer(input)` must equal the stored output — that is exactly what the
     driver prints, and cases 1-2 come from the description's worked examples, so a
     disagreement fails test case 1 for every student including a perfect solution.
  2. `is_valid_answer(input, stored_output)` must be True — a checker too strict to accept
     its own reference's answer rejects correct submissions.
"""

import os
import sys
import tempfile
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

from open_ended_checker import effective_output, load_checker  # noqa: E402

CHECKER_SRC = '''
def reference_answer(stdin_text):
    return "0 1"


def is_valid_answer(stdin_text, candidate_stdout):
    return candidate_stdout.strip() in ("0 1", "1 0")
'''


def _write(src):
    fd, path = tempfile.mkstemp(suffix=".py")
    with os.fdopen(fd, "w") as f:
        f.write(src)
    return path


class TestLoadChecker(unittest.TestCase):
    def setUp(self):
        self.path = _write(CHECKER_SRC)

    def tearDown(self):
        os.unlink(self.path)

    def test_loads_both_functions(self):
        c = load_checker(self.path)
        self.assertIsNotNone(c)
        self.assertEqual(c.reference_answer("x"), "0 1")
        self.assertTrue(c.is_valid_answer("x", "1 0"))

    def test_a_source_without_a_checker_loads_as_none(self):
        p = _write("def main():\n    pass\n")
        try:
            self.assertIsNone(load_checker(p))
        finally:
            os.unlink(p)

    def test_a_missing_file_loads_as_none(self):
        self.assertIsNone(load_checker("/nonexistent/nope.py"))

    def test_a_crashing_module_loads_as_none_rather_than_raising(self):
        p = _write("raise RuntimeError('boom')\n")
        try:
            self.assertIsNone(load_checker(p))
        finally:
            os.unlink(p)


class TestEffectiveOutput(unittest.TestCase):
    def setUp(self):
        self.checker = load_checker(_write(CHECKER_SRC))

    def test_a_valid_but_different_answer_reads_as_the_stored_output(self):
        self.assertEqual(effective_output(self.checker, "x", "1 0", "0 1"), "0 1")

    def test_an_invalid_answer_reads_as_the_candidates_own_output(self):
        """The student must see what THEY produced in the failure, not a verdict."""
        self.assertEqual(effective_output(self.checker, "x", "5 5", "0 1"), "5 5")

    def test_no_checker_is_a_passthrough(self):
        self.assertEqual(effective_output(None, "x", "5 5", "0 1"), "5 5")

    def test_a_checker_that_raises_is_treated_as_rejecting(self):
        """A crashing checker must never silently accept everything."""
        class Boom:
            @staticmethod
            def is_valid_answer(a, b):
                raise ValueError("bad input")
        self.assertEqual(effective_output(Boom, "x", "5 5", "0 1"), "5 5")


class TestCheckerGrounding(unittest.TestCase):
    def setUp(self):
        import testcase_manager_v4 as tm
        self.tm = tm
        self.checker = load_checker(_write(CHECKER_SRC))

    def test_a_reference_answer_that_disagrees_with_the_stored_output_is_a_failure(self):
        cases = [{"order": 1, "input": "x\n", "output": "9 9"}]
        fails = self.tm._ground_checker(cases, self.checker)
        self.assertEqual(len(fails), 1)
        self.assertIn("reference_answer", fails[0]["detail"])

    def test_a_checker_that_rejects_its_own_reference_answer_is_a_failure(self):
        class TooStrict:
            @staticmethod
            def reference_answer(s):
                return "0 1"

            @staticmethod
            def is_valid_answer(s, c):
                return False
        fails = self.tm._ground_checker(
            [{"order": 1, "input": "x\n", "output": "0 1"}], TooStrict)
        self.assertEqual(len(fails), 1)
        self.assertIn("is_valid_answer", fails[0]["detail"])

    def test_a_consistent_checker_grounds_clean(self):
        cases = [{"order": 1, "input": "x\n", "output": "0 1"},
                 {"order": 2, "input": "y\n", "output": "0 1"}]
        self.assertEqual(self.tm._ground_checker(cases, self.checker), [])

    def test_no_checker_grounds_clean(self):
        self.assertEqual(
            self.tm._ground_checker([{"order": 1, "input": "x", "output": "1"}], None), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_open_ended_grounding -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'open_ended_checker'`

- [ ] **Step 3: Write the loader**

Create `pipeline/Scripts/open_ended_checker.py`:

```python
"""Load an open-ended problem's checker out of the reference source, and apply it.

Everything that needs a verdict — B2, grounding, the optimal-vs-brute cross-check,
`validate_solutions`, non-function enumeration — runs BEFORE `split_code`, so none of them
has a driver to ask. They all ask this module instead, and they all get the same answer the
driver will give at grading time.
"""

import importlib.util
import os
import uuid

from problem_flags import CHECKER_NAMES


def load_checker(source_path):
    """Import `source_path` and return it if it exposes the checker; else None.

    Never raises: a reference that will not import is simply "no checker", and the caller
    falls back to exact-text comparison — which is strictly the safer failure direction.
    """
    if not source_path or not os.path.exists(source_path):
        return None
    try:
        name = f"_oe_checker_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(name, source_path)
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    except Exception:
        return None
    if all(callable(getattr(module, n, None)) for n in CHECKER_NAMES):
        return module
    return None


def accepts(checker, stdin_text, candidate_stdout):
    """True only when the checker explicitly accepts. A checker that raises REJECTS —
    silently accepting on error would mark every wrong answer correct."""
    if checker is None:
        return False
    try:
        return bool(checker.is_valid_answer(stdin_text, candidate_stdout))
    except Exception:
        return False


def effective_output(checker, stdin_text, got, stored):
    """What the driver's Output Area would print for `got`.

    Valid  -> the reference's answer, which IS the stored output, so it matches and passes.
    Invalid-> the candidate's OWN output, so it mismatches and fails, and whoever reads the
              failure sees what was actually produced. The driver never prints a verdict:
              a verdict hides the one thing needed to debug.
    """
    return stored if accepts(checker, stdin_text, got) else got
```

- [ ] **Step 4: Ground the checker**

Add to `pipeline/Scripts/testcase_manager_v4.py`, next to `_ground_against_reference` (518):

```python
def _ground_checker(cases, checker) -> list[dict]:
    """The reference, run through its own driver, must reproduce every stored output.

    `_ground_against_reference` runs the reference as a PROGRAM; this runs it as the DRIVER
    will. Both assertions below fail silently in production:
      - `reference_answer(input) != output` makes the driver print something the platform
        never stores, so the case fails for EVERY student including a perfect one. Cases
        1-2 are the description's worked examples (`sync_example_testcases`), so this is
        where a statement/driver disagreement surfaces.
      - `is_valid_answer(input, output)` False means the checker rejects its own reference's
        answer, so it rejects correct submissions too.
    """
    if checker is None:
        return []
    from open_ended_checker import accepts
    failures: list[dict] = []
    for tc in cases:
        inp = tc.get("input", "") or ""
        stored = _normalize_output(tc.get("output", ""))
        try:
            produced = _normalize_output(checker.reference_answer(inp))
        except Exception as e:
            failures.append({"order": tc.get("order"), "input": inp, "expected": stored,
                             "got": "<error>",
                             "detail": f"reference_answer raised {type(e).__name__}: {e}"})
            continue
        if produced != stored:
            failures.append({"order": tc.get("order"), "input": inp, "expected": stored,
                             "got": produced[:300],
                             "detail": "reference_answer disagrees with the stored output"})
        elif not accepts(checker, inp, stored):
            failures.append({"order": tc.get("order"), "input": inp, "expected": stored,
                             "got": stored[:300],
                             "detail": "is_valid_answer rejects its own reference answer"})
    return failures
```

Then in `main()`, inside the grounding block at 974-1006, after `_ground_against_reference`
returns clean, add:

```python
    from open_ended_checker import load_checker
    from problem_flags import load_open_ended

    if load_open_ended("Outputs"):
        checker = load_checker(optimal_path)
        if checker is None:
            print("ERROR: this problem is flagged open_ended but the reference exposes no "
                  "reference_answer/is_valid_answer. Re-run the naming step.")
            sys.exit(1)
        checker_failures = _ground_checker(_load_testcases_from(out_path), checker)
        if checker_failures:
            print("ERROR: CHECKER GROUNDING FAILED — the reference does not reproduce its "
                  "own stored outputs through the driver:")
            print(_format_grounding_failures(checker_failures))
            sys.exit(1)
        print(f"✓ Checker grounded on {len(_load_testcases_from(out_path))} case(s).")
```

This is not repaired by `_repair_from_grounding` — a checker/reference disagreement is a
defect in the naming step's output, not in the generator script, so it fails loudly.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_open_ended_grounding -v`
Expected: PASS (12 tests)

- [ ] **Step 6: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 305 tests.

- [ ] **Step 7: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(grounding): verify the checker reproduces every stored output"
```

---

### Task 5: The Python driver carries the checker and prints answers, never verdicts

**Files:**
- Modify: `pipeline/Scripts/Prompts/splittingPrompt.py` — `get_splitting_prompt` (4); the
  Python driver template (246-288) and Python debugger template (~590-610)
- Modify: `pipeline/Scripts/code_splitter.py` — `main` (107), the call at 189-190
- Test: `pipeline/Scripts/tests/test_split_open_ended.py` (create)

**Interfaces:**
- New signature:
  `get_splitting_prompt(language, code, desc_response=None, question_type="standard", open_ended=False)`
  — returns `(system_prompt, user_prompt)`, unchanged shape.
- Produces `split_defects(language, split_data, open_ended) -> list[str]` in
  `pipeline/Scripts/code_splitter.py` — a static gate on the LLM's JSON before it is written
  to disk.

**What the driver must look like.** Two lines are added before the Input Area so the Output
Area has the raw stdin the checker needs; the existing `input()`-based parsing keeps working
because `sys.stdin` is replaced with an equivalent stream:

```python
from solution import solution
import time
import sys
import io
import resource

file_path = sys.argv[2]
total_elapsed_time_ns = 0
sol = solution()

# Dont change or modify any lines before this point

RAW_STDIN = sys.stdin.read()
sys.stdin = io.StringIO(RAW_STDIN)

# Checker Area Start
# Copied verbatim from the reference solution. Module-level, never inside `solution`.
def reference_answer(stdin_text):
    ...

def is_valid_answer(stdin_text, candidate_stdout):
    ...
# Checker Area End

# Input Area Start
# [unchanged — still reads with input() / sys.stdin]
# Input Area End

# Function Call Area Start
start_time_ns = time.perf_counter_ns()
result = sol.FUNCTION_NAME(ARGUMENTS)
end_time_ns = time.perf_counter_ns()
# Function Call Area End

# Output Area Start
_candidate = str(result)
if is_valid_answer(RAW_STDIN, _candidate):
    sys.stdout.write(reference_answer(RAW_STDIN) + '\n')
else:
    sys.stdout.write(_candidate + '\n')
# Output Area End
```

Three properties this must preserve, and each is a test below:
- **Never `VALID`/`INVALID`.** A verdict hides what the student produced, which is the one
  thing they need when a case fails.
- **The checker runs in the Output Area, outside the timing window.** `start_time_ns` /
  `end_time_ns` (splittingPrompt.py:267-269) bracket only the function call, so no student's
  measured runtime is inflated. Do not move the checker between those lines.
- **`reference_answer` never lands in `solution_code` or `default_code`.** Those two are
  shown to the student (splittingPrompt.py:209-210). Shipping the reference there hands away
  the answer at a click; shipping it in `driver_code` is the trade-off the spec accepts.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_split_open_ended.py`:

```python
"""The checker goes in the driver, and the driver prints an ANSWER — never a verdict.

`solution_code` and `default_code` are shown to the student (splittingPrompt.py:209-210), so
a checker leaking into either hands away the reference at a click. And a driver that prints
`VALID`/`INVALID` hides what the student actually produced, which is the one thing they need
when a case fails.
"""

import os
import sys
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

import code_splitter  # noqa: E402
from Prompts.splittingPrompt import get_splitting_prompt  # noqa: E402

GOOD = {
    "default_code": "class solution:\n    def f(self, a):\n        pass\n",
    "solution_code": "class solution:\n    def f(self, a):\n        return a\n",
    "driver_code": (
        "from solution import solution\nimport io, sys, time\n"
        "RAW_STDIN = sys.stdin.read()\nsys.stdin = io.StringIO(RAW_STDIN)\n"
        "def reference_answer(stdin_text):\n    return '0 1'\n"
        "def is_valid_answer(stdin_text, candidate_stdout):\n    return True\n"
        "start_time_ns = time.perf_counter_ns()\nresult = sol.f(a)\n"
        "end_time_ns = time.perf_counter_ns()\n"
        "_candidate = str(result)\n"
        "if is_valid_answer(RAW_STDIN, _candidate):\n"
        "    sys.stdout.write(reference_answer(RAW_STDIN) + '\\n')\n"
        "else:\n    sys.stdout.write(_candidate + '\\n')\n"
    ),
    "debugger_code": "N/A",
}


class TestSplitDefects(unittest.TestCase):
    def test_a_well_formed_open_ended_split_has_no_defects(self):
        self.assertEqual(code_splitter.split_defects("Python", GOOD, True), [])

    def test_a_driver_without_the_checker_is_a_defect(self):
        bad = dict(GOOD, driver_code=GOOD["driver_code"].replace("def reference_answer", "def ra"))
        self.assertIn("reference_answer", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_the_checker_leaking_into_solution_code_is_a_defect(self):
        bad = dict(GOOD, solution_code=GOOD["solution_code"] + "\ndef reference_answer(s):\n    return '0 1'\n")
        self.assertIn("solution_code", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_the_checker_leaking_into_default_code_is_a_defect(self):
        bad = dict(GOOD, default_code=GOOD["default_code"] + "\ndef reference_answer(s):\n    return '0 1'\n")
        self.assertIn("default_code", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_a_driver_that_prints_a_verdict_is_a_defect(self):
        bad = dict(GOOD, driver_code=GOOD["driver_code"] + "\nsys.stdout.write('VALID')\n")
        self.assertIn("verdict", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_a_checker_inside_the_timing_window_is_a_defect(self):
        bad = dict(GOOD, driver_code=GOOD["driver_code"].replace(
            "result = sol.f(a)", "result = sol.f(a)\nis_valid_answer(RAW_STDIN, '')"))
        self.assertIn("timing", " ".join(
            code_splitter.split_defects("Python", bad, True)))

    def test_a_single_answer_problem_is_not_checked_at_all(self):
        plain = dict(GOOD, driver_code="result = sol.f(a)\nprint(result)\n")
        self.assertEqual(code_splitter.split_defects("Python", plain, False), [])


class TestSplittingPrompt(unittest.TestCase):
    def test_the_checker_area_appears_only_when_open_ended(self):
        off, _ = get_splitting_prompt("Python", "code", desc_response="d")
        on, _ = get_splitting_prompt("Python", "code", desc_response="d", open_ended=True)
        self.assertNotIn("Checker Area Start", off)
        self.assertIn("Checker Area Start", on)

    def test_the_prompt_forbids_printing_a_verdict(self):
        on, _ = get_splitting_prompt("Python", "code", desc_response="d", open_ended=True)
        self.assertIn("VALID", on)
        self.assertIn("RAW_STDIN", on)

    def test_the_existing_markers_are_untouched(self):
        """`# Output Area Start ` carries a trailing space in the template; a plan that
        'tidied' it would silently change the template the model is asked to follow."""
        on, _ = get_splitting_prompt("Python", "code", desc_response="d", open_ended=True)
        self.assertIn("# Output Area Start ", on)
        self.assertIn("# Function Call Area Start", on)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_split_open_ended -v`
Expected: FAIL with `AttributeError: module 'code_splitter' has no attribute 'split_defects'`

- [ ] **Step 3: Add the open-ended block to the splitting prompt**

In `pipeline/Scripts/Prompts/splittingPrompt.py`, add `open_ended=False` as the last
parameter of `get_splitting_prompt` (4), build the block, and interpolate it into
`system_prompt` right after the `**CRITICAL - DESCRIPTION I/O FORMAT PRECEDENCE:**` block
(214-217):

```python
    open_ended_rules = ""
    if open_ended:
        open_ended_rules = """
**OPEN-ENDED PROBLEM — THE DRIVER GRADES WITH A CHECKER:**
The source you were given contains two module-level functions, `reference_answer(stdin_text)`
and `is_valid_answer(stdin_text, candidate_stdout)`. They are NOT part of the user's task.

1. Put BOTH functions **verbatim** in `driver_code`, between the markers
   `# Checker Area Start` and `# Checker Area End`, immediately before the Input Area.
   Keep their names EXACTLY — the driver calls them by name.
2. They MUST NOT appear in `solution_code` or in `default_code`. Those are shown to the
   user and would hand them the reference implementation.
3. Immediately after the `# Dont change or modify any lines before this point` line, add:
       RAW_STDIN = sys.stdin.read()
       sys.stdin = io.StringIO(RAW_STDIN)
   and add `import io` to the driver's imports. The Input Area then parses from RAW_STDIN
   through the normal `input()` calls, unchanged.
4. The Output Area becomes EXACTLY this shape:
       _candidate = str(result)
       if is_valid_answer(RAW_STDIN, _candidate):
           sys.stdout.write(reference_answer(RAW_STDIN) + '\\n')
       else:
           sys.stdout.write(_candidate + '\\n')
5. **NEVER print `VALID`, `INVALID`, `CORRECT`, `WRONG` or any other verdict word.** On an
   invalid answer the driver prints the USER'S OWN output so they can see what they
   produced. A verdict hides exactly that.
6. The checker calls stay in the Output Area, AFTER `end_time_ns`. Nothing may go between
   `start_time_ns` and `end_time_ns` — that window is the user's measured runtime.
7. `debugger_code` keeps its ordinary printing. It is a local convenience, not a grader.
"""
```

- [ ] **Step 4: Add the static gate and wire the flag in `code_splitter.py`**

Add to `pipeline/Scripts/code_splitter.py`:

```python
_VERDICT_WORDS = ("VALID", "INVALID", "CORRECT", "INCORRECT", "WRONG")


def split_defects(language_name, split_data, open_ended):
    """Static gate on the split BEFORE it is written to disk. Empty list means it is sound.

    Every defect here is silent in production: a leaked checker just means a student can
    read the answer, and a verdict-printing driver just means every failure report is
    useless. Neither breaks a test."""
    if not open_ended:
        return []
    driver = split_data.get("driver_code") or ""
    defects = []
    for name in ("reference_answer", "is_valid_answer"):
        if f"def {name}" not in driver and f"{name}(" not in driver:
            defects.append(f"driver_code is missing {name}")
    for key in ("solution_code", "default_code"):
        body = split_data.get(key) or ""
        if "reference_answer" in body or "is_valid_answer" in body:
            defects.append(f"the checker leaked into {key}, which is shown to the user")
    for word in _VERDICT_WORDS:
        if f"'{word}'" in driver or f'"{word}"' in driver:
            defects.append(f"driver_code prints the verdict {word!r}; it must print an answer")
    start, end = driver.find("start_time_ns"), driver.find("end_time_ns")
    if start != -1 and end > start:
        window = driver[start:end]
        if "is_valid_answer" in window or "reference_answer" in window:
            defects.append("the checker runs inside the timing window and would inflate "
                           "the user's measured runtime")
    return defects
```

In `main()` (107), read the flag once and use it at both points:

```python
    from problem_flags import load_open_ended
    open_ended = load_open_ended(os.path.join(base_dir, "Outputs"))
```

then at 189-190:

```python
        system_prompt, user_prompt = get_splitting_prompt(
            lang_name, code, desc_response=desc_content, question_type=question_type,
            open_ended=open_ended,
        )
        response, usage = call_llm(system_prompt, user_prompt, purpose="code")
```

and before `save_split_code(...)`:

```python
        defects = split_defects(lang_name, split_data, open_ended)
        if defects:
            print(f"ERROR: the {lang_name} split is unusable for an open-ended problem:")
            for d in defects:
                print(f"  - {d}")
            sys.exit(1)
```

Keep the existing `update_usage`/usage tracking on the `call_llm` result exactly as it is.

**Phase 1 scope:** run this step with `--langs python` only. Tasks 8-10 extend it.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_split_open_ended -v`
Expected: PASS (10 tests)

- [ ] **Step 6: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 315 tests.

- [ ] **Step 7: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(split): put the checker in the Python driver and print answers"
```

---

### Task 6: Non-function open-ended problems enumerate their valid answers

**Files:**
- Modify: `pipeline/Scripts/Prompts/testcasesprompt_v4.py` — `get_testcases_prompt` (164)
- Modify: `pipeline/Scripts/testcase_manager_v4.py` — the call at 878-887; grounding (974)
- Modify: `pipeline/Scripts/prepare_platform_json.py` — `load_source_testcases` (292-301)
- Test: `pipeline/Scripts/tests/test_multi_answer_cases.py` (create)

**Interfaces:**
- New signature: `get_testcases_prompt(description, optimal_solution, brute_force_code=None,
  num_testcases=None, difficulty=None, is_function=False, signature_params=None,
  io_contract=None, open_ended=False)` — returns `(system_prompt, user_prompt)`.
- Produces `multi_answer_defects(cases, description) -> list[str]` in
  `pipeline/Scripts/testcase_helpers.py`.

**Function-based problems get NO change here** — their cases store the reference's real
answer exactly as today, and the driver does the accepting (spec: "Test-case generation —
**no change** on the function-based path").

**What the case shape becomes for non-function open-ended problems.** The model already
emits exactly six keys per case (`testcasesprompt_v4.py:496`:
`input, output, subtask, scenario, is_edge, size_metric`). A multi-answer case emits
`outputs` and `multiple_possible_output` instead of `output`. Both keys are already consumed
end to end: `prepare_platform_json.py:545-547` (exam) and `837-860` (practice),
`execution_manager_v3._build_output_object:278-300`, `execution_manager_v2:624-651`. Probed
working against the live compiler on 2026-08-14.

**The spec's "`prepare_platform_json.py` — no change" is wrong, and it fails silently.**
`load_source_testcases` (292-301) force-defaults any missing key to `""`:

```python
            for key in ["input", "output", "weightage", "order"]:
                if key not in tc:
                    ...
                        tc[key] = ""  # fallback for input/output
```

A multi-answer case legitimately has no `output`, so it is given `output: ""` **before**
`practice_parse_test_cases` sees it — which means the `output is None` guard at line 842 can
never fire, and nothing anywhere validates that `outputs` is non-empty until the raise at
841. One targeted fix, below.

**Hazard 2 — the description's example answer must be IN the list.** If enumeration produces
a list that omits the answer printed in the problem statement, the statement and the grader
disagree and the student who copies the worked example fails. Cases 1-2 come from
`sync_example_testcases` (`testcase_helpers.py:272`), so this is checkable and is tested
below.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_multi_answer_cases.py`:

```python
"""Non-function problems have no driver, so they ship every valid answer instead.

Two rules, both silently fatal:
  - A stored list must be provably exhaustive. A partial list marks correct answers wrong,
    which is the exact bug this design exists to remove.
  - The answer printed in the problem statement MUST appear in the list. Otherwise the
    student who copies the worked example fails.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import multi_answer_defects  # noqa: E402
from Prompts.testcasesprompt_v4 import get_testcases_prompt  # noqa: E402

DESC = """**Example 1:**

**Input:**

```
3
1 2 3
```

**Output:**

```
1 3 2
```
"""


def multi(order, outputs):
    return {"order": order, "input": "3\n1 2 3\n", "multiple_possible_output": True,
            "outputs": list(outputs), "subtask": "example", "scenario": "example_one",
            "is_edge": False, "size_metric": 3}


class TestMultiAnswerDefects(unittest.TestCase):
    def test_a_case_with_the_example_answer_in_the_list_is_clean(self):
        self.assertEqual(multi_answer_defects([multi(1, ["1 3 2", "2 1 3"])], DESC), [])

    def test_the_example_answer_missing_from_the_list_is_a_defect(self):
        defects = multi_answer_defects([multi(1, ["2 1 3", "3 2 1"])], DESC)
        self.assertTrue(defects)
        self.assertIn("Example 1", " ".join(defects))

    def test_an_empty_outputs_list_is_a_defect(self):
        self.assertIn("empty", " ".join(multi_answer_defects([multi(1, [])], DESC)))

    def test_duplicate_answers_are_a_defect(self):
        """A duplicated entry means the enumeration double-counted, so 'exhaustive' is
        not something it actually established."""
        self.assertIn("duplicate", " ".join(
            multi_answer_defects([multi(1, ["1 3 2", "1 3 2"])], DESC)))

    def test_a_case_carrying_both_output_and_outputs_is_a_defect(self):
        tc = multi(1, ["1 3 2"])
        tc["output"] = "1 3 2"
        self.assertIn("both", " ".join(multi_answer_defects([tc], DESC)))

    def test_ordinary_single_answer_cases_are_untouched(self):
        plain = [{"order": 1, "input": "3\n1 2 3\n", "output": "1 3 2"}]
        self.assertEqual(multi_answer_defects(plain, DESC), [])

    def test_only_cases_1_and_2_are_checked_against_the_statement(self):
        """Case 7 is not a worked example, so its list has nothing to agree with."""
        self.assertEqual(multi_answer_defects([multi(7, ["9 9 9"])], DESC), [])


class TestTestcasesPrompt(unittest.TestCase):
    def test_the_enumeration_block_appears_only_when_open_ended_and_non_function(self):
        off, _ = get_testcases_prompt("d", "s", is_function=False)
        on, _ = get_testcases_prompt("d", "s", is_function=False, open_ended=True)
        self.assertNotIn("multiple_possible_output", off)
        self.assertIn("multiple_possible_output", on)

    def test_function_based_problems_never_get_the_enumeration_block(self):
        """Function problems are graded by the driver's checker; enumerating for them
        would ship a second, competing grading mechanism."""
        on, _ = get_testcases_prompt("d", "s", is_function=True, open_ended=True)
        self.assertNotIn("multiple_possible_output", on)

    def test_stress_cases_are_required_to_have_a_unique_answer(self):
        on, _ = get_testcases_prompt("d", "s", is_function=False, open_ended=True)
        self.assertIn("unique", on.lower())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_multi_answer_cases -v`
Expected: FAIL with `ImportError: cannot import name 'multi_answer_defects'`

- [ ] **Step 3: Write the validator**

Append to `pipeline/Scripts/testcase_helpers.py`:

```python
def multi_answer_defects(test_cases, description):
    """Defects in a multi-answer suite. Empty list means it is shippable.

    The statement check is the one that matters: `sync_example_testcases` forces cases 1-2
    to the description's worked Examples, so if the answer printed in the statement is not
    in the enumerated list, the student who copies the worked example is marked wrong.
    """
    from benchmark_suite import extract_example_io, normalize

    examples = extract_example_io(description or "") or []
    stated = {i + 1: normalize(out) for i, (_inp, out) in enumerate(examples[:2])}
    defects = []
    for tc in test_cases or []:
        if not isinstance(tc, dict) or not tc.get("multiple_possible_output"):
            continue
        order = tc.get("order")
        outs = tc.get("outputs")
        if not isinstance(outs, list) or not outs:
            defects.append(f"case order={order}: multiple_possible_output with an empty "
                           f"or missing `outputs` list")
            continue
        if tc.get("output") is not None:
            defects.append(f"case order={order}: carries both `output` and `outputs`; a "
                           f"multi-answer case must carry only `outputs`")
        normed = [normalize(str(o)) for o in outs]
        if len(set(normed)) != len(normed):
            defects.append(f"case order={order}: `outputs` holds duplicate answers, so the "
                           f"enumeration did not walk a well-defined space")
        want = stated.get(order)
        if want is not None and want not in normed:
            defects.append(f"case order={order}: the answer Example {order} prints "
                           f"({want!r}) is not in `outputs`; the statement and the grader "
                           f"disagree")
    return defects
```

- [ ] **Step 4: Add the enumeration block to the testcase prompt**

In `pipeline/Scripts/Prompts/testcasesprompt_v4.py`, add `open_ended=False` as the last
parameter of `get_testcases_prompt` (164) and, when `open_ended and not is_function`,
interpolate:

```python
_ENUMERATE_BLOCK = """
**THIS PROBLEM ACCEPTS MORE THAN ONE CORRECT ANSWER.**
There is no driver to wrap a stdin/stdout program in, so each multi-answer case must ship
EVERY valid answer instead of one.

For such a case emit, in place of `output`:
    "multiple_possible_output": true,
    "outputs": ["<answer 1>", "<answer 2>", ...]
Emit `output` OR `outputs`, never both.

- Write a `is_valid_answer(stdin_text, candidate_stdout)` helper inside the generator script
  and use it to filter. It is a generation-time tool and is never shipped.
- **The list must be provably EXHAUSTIVE.** Walk the candidate space to completion and keep
  everything the helper accepts. A truncated list marks correct answers wrong, which is the
  exact bug this exists to remove — so if you cannot enumerate a case completely, do NOT
  ship it as multi-answer: reshape its input so the answer is unique.
- **The answer shown in the problem statement's Example 1 / Example 2 MUST be in that
  case's `outputs`.** Test cases 1 and 2 are synced to the worked examples, so a list that
  omits the stated answer fails the student who copied it.
- **Stress and large cases MUST have a UNIQUE answer.** They carry the timing coverage, so
  shape them so only one output is valid (a chain rather than a sparse graph). Small cases
  carry the multi-answer coverage. This is what keeps enumeration bounded without a cap:
  enumeration cost is superexponential in the free choices (8 unconstrained nodes = 40,320
  orderings, 10 = 3.6M, 12 = 479M), and you control that through the input you choose.
- There is deliberately NO fixed cap on the number of stored answers. The bound is the
  input shape you pick, not a constant.
"""
```

Then thread the flag at `testcase_manager_v4.py:878-887`:

```python
    open_ended = load_open_ended("Outputs")
    system_prompt, user_prompt = get_testcases_prompt(
        description,
        optimal_solution,
        brute_force_code=brute_solution,
        num_testcases=num_testcases,
        difficulty=difficulty,
        is_function=is_function,
        signature_params=signature_params,
        io_contract=io_contract,
        open_ended=open_ended,
    )
```

and gate on the validator in the grounding block, next to Task 4's `_ground_checker` call:

```python
    if open_ended and not is_function:
        from testcase_helpers import multi_answer_defects
        defects = multi_answer_defects(_load_testcases_from(out_path), description)
        if defects:
            print("ERROR: the multi-answer suite is not shippable:")
            for d in defects:
                print(f"  - {d}")
            sys.exit(1)
```

Multi-answer cases must also be exempted from `_ground_against_reference` (518), which
compares against a single `output`: skip any case where `tc.get("multiple_possible_output")`
is true, and instead assert the reference's stdout is a member of `outputs`.

- [ ] **Step 5: Fix `prepare_platform_json.load_source_testcases`**

In `pipeline/Scripts/prepare_platform_json.py`, at 292-301, make the required-key list
depend on the case shape rather than injecting `output: ""` unconditionally:

```python
            required = (["input", "outputs", "weightage", "order"]
                        if tc.get("multiple_possible_output")
                        else ["input", "output", "weightage", "order"])
            for key in required:
                if key not in tc:
```

Without this, a legitimately-`output`-less multi-answer case is silently given `output: ""`,
the practice-path guard at 842 can never fire, and `outputs` is never validated at all.

Leave the exam path (526-550) and the practice path (837-860) alone: probing confirmed the
platform ignores the primary `contents` field once `multiple_possible_output` is set, so the
two paths' different treatment of `output` is harmless.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_multi_answer_cases -v`
Expected: PASS (10 tests)

- [ ] **Step 7: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 325 tests.

- [ ] **Step 8: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(testcases): enumerate valid answers for non-function open-ended problems"
```

---

### Task 7: Delete `is_open_ended_problem` and restore the four checks

**Files:**
- Modify: `pipeline/Scripts/benchmark_suite.py` — delete `_OPEN_ENDED_RE` (1378-1386) and
  `is_open_ended_problem` (1390-1394); `b2_verdict` (707); `run_benchmark` (1557);
  `crosscheck_optimal_brute` (1397)
- Modify: `pipeline/Scripts/testcase_annotate.py` — `annotate_kills` (171), the `b2_verdict`
  call (405-410)
- Modify: `pipeline/Scripts/generate_brute_force.py` — import (192-198),
  `_crosscheck_optimal_vs_brute` (235)
- Modify: `pipeline/Scripts/validate_solutions.py` — import (23), `validate_examples` (83, 102)
- Modify: `pipeline/Scripts/tests/test_optimal_brute_crosscheck.py`,
  `tests/test_b2_gate.py`, `tests/test_validate_solutions.py`
- Test: `pipeline/Scripts/tests/test_b2_open_ended.py` (create)

**Interfaces:**
- `annotate_kills(cases, wrong_solutions, batch_runner, log=None, checker=None) -> set`
- `b2_verdict(wrong_files, failures, test_cases, description="")` — the `description`
  parameter stays (callers pass it) but is no longer read for an open-endedness decision.
- `crosscheck_optimal_brute(optimal_code, brute_code, examples, count=100,
  timeout=BENCHMARK_RUN_TIMEOUT, max_report=5, checker=None) -> list[dict]`

**The four sites do NOT all mean the same thing. Two of them are inverted.**

| site | file:line | today | after |
| --- | --- | --- | --- |
| A | `benchmark_suite.py:720` in `b2_verdict` | regex True ⇒ **abstain**, `hard_fail: False` before it even looks at the evidence | **delete lines 720-728.** With a checker the kill evidence is meaningful, so B2 always judges. |
| B | `benchmark_suite.py:1557` in `run_benchmark` | regex True ⇒ B4 stays a **hard fail** (the detector *tightens* here) | pass a `checker` into `crosscheck_optimal_brute` so a valid-but-different brute answer is no longer a disagreement; then drop the clause. |
| C | `generate_brute_force.py:235` in `_crosscheck_optimal_vs_brute` | regex True ⇒ the whole optimal-vs-brute sweep is **skipped** and a `"skipped"` marker written | run the sweep, passing the checker. |
| D | `validate_solutions.py:102` in `validate_examples` | regex True ⇒ `brute_agrees` short-circuits to **True** | `agrees = accepts(checker, inp, bout) or (…)`. |

Site B's polarity is why "just delete it" is wrong: treating the detector as permanently
False there would make B4 **always** downgrade to advisory. The fix is to make the
comparison itself checker-aware so the downgrade clause becomes unnecessary.

**The live B2 is not where you would guess.** `run_wrong_approach_gate`
(`benchmark_suite.py:738-790`) is **bypassed on every real run** —
`run_benchmark:1494-1502` skips it whenever `precomputed_b2` is passed, and
`testcase_annotate.py:430-436` always passes it. The kill scoring that actually blocks the
pipeline is `testcase_annotate.annotate_kills` (171-200), whose verdict is consumed at
`testcase_annotate.py:405-410` and blocks at 443. **Change `annotate_kills`.** A fix applied
only to `run_wrong_approach_gate` would change nothing in production — verify with
`grep -n "precomputed_b2" benchmark_suite.py testcase_annotate.py` before starting.

**Tests that must be deleted, and the arithmetic.** The detector is covered by 5 tests:
- `tests/test_optimal_brute_crosscheck.py` — class `OpenEndedDetectorTests` (114-124):
  `test_flags_return_any` and `test_does_not_flag_deterministic` (2 tests). Delete the class.
- `tests/test_b2_gate.py` — `test_open_ended_problem_abstains_instead_of_passing` (55-61)
  and `test_every_return_path_carries_every_key` (70-78, which reaches the abstain path via
  `description="print any valid answer"`). Delete the first; rewrite the second to cover the
  three surviving return paths.
- `tests/test_validate_solutions.py` — `test_open_ended_never_fails_brute` (102-112). Replace
  with a checker-based equivalent (below).

Net: −4 deleted, +1 rewritten in place. Task 7 then adds 9.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_b2_open_ended.py`:

```python
"""B2 judges open-ended problems instead of abstaining, because a checker exists now.

The regex it replaces matched `if there are multiple ... return the smallest first index` —
the exact wording a description MUST use when it DOES pin an answer down — so the better a
description followed the rules the more likely B2 stopped running. Abstention was never a
pass; it shipped suites with no blocking quality gate at all.

Kill scoring now asks the checker the same question the driver will ask at grading time: a
wrong solution that happens to print a valid-but-different answer on a case is NOT killed by
that case, because the driver would have accepted it too.
"""

import os
import sys
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

import benchmark_suite as bs  # noqa: E402
import testcase_annotate as ta  # noqa: E402


class Checker:
    """Accepts either order of the two indices."""

    @staticmethod
    def reference_answer(stdin_text):
        return "0 1"

    @staticmethod
    def is_valid_answer(stdin_text, candidate_stdout):
        return candidate_stdout.strip() in ("0 1", "1 0")


def cases():
    return [{"input": "a\n", "output": "0 1", "kills": set()},
            {"input": "b\n", "output": "0 1", "kills": set()}]


class TestDetectorIsGone(unittest.TestCase):
    def test_the_regex_no_longer_exists(self):
        self.assertFalse(hasattr(bs, "is_open_ended_problem"))
        self.assertFalse(hasattr(bs, "_OPEN_ENDED_RE"))

    def test_b2_judges_an_open_ended_description_instead_of_abstaining(self):
        v = bs.b2_verdict(2, [{"file": "w1.py"}], cases(),
                          "Return any valid arrangement of the letters.")
        self.assertFalse(v["cannot_judge"], "abstention is not a pass; it must judge")
        self.assertTrue(v["hard_fail"], "a surviving wrong solution still blocks")

    def test_a_description_with_a_tie_break_also_judges(self):
        """The old regex fired on this wording and switched the gate off."""
        v = bs.b2_verdict(1, [], cases(),
                          "If there are multiple pairs, print the smallest first index.")
        self.assertFalse(v["cannot_judge"])
        self.assertFalse(v["hard_fail"])


class TestKillScoringThroughTheChecker(unittest.TestCase):
    def test_a_valid_but_different_answer_does_not_kill(self):
        c = cases()
        runner = lambda code, inputs: [("1 0", "ok") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=Checker)
        self.assertEqual(c[0]["kills"], set(),
                         "the driver would have accepted this, so the case does not kill")

    def test_an_invalid_answer_still_kills(self):
        c = cases()
        runner = lambda code, inputs: [("5 5", "ok") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=Checker)
        self.assertEqual(c[0]["kills"], {"w1.py"})

    def test_a_crash_still_kills_even_with_a_checker(self):
        c = cases()
        runner = lambda code, inputs: [("", "error") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=Checker)
        self.assertEqual(c[0]["kills"], {"w1.py"})

    def test_without_a_checker_comparison_stays_exact_text(self):
        c = cases()
        runner = lambda code, inputs: [("1 0", "ok") for _ in inputs]
        ta.annotate_kills(c, [("w1.py", "src")], runner, checker=None)
        self.assertEqual(c[0]["kills"], {"w1.py"})


class TestCrosscheckThroughTheChecker(unittest.TestCase):
    def test_a_valid_but_different_brute_answer_is_not_a_disagreement(self):
        opt = "import sys\nsys.stdin.read()\nprint('0 1')\n"
        bru = "import sys\nsys.stdin.read()\nprint('1 0')\n"
        self.assertEqual(
            bs.crosscheck_optimal_brute(opt, bru, ["a\n"], count=0, checker=Checker), [])

    def test_an_invalid_brute_answer_is_still_a_disagreement(self):
        opt = "import sys\nsys.stdin.read()\nprint('0 1')\n"
        bru = "import sys\nsys.stdin.read()\nprint('5 5')\n"
        self.assertTrue(
            bs.crosscheck_optimal_brute(opt, bru, ["a\n"], count=0, checker=Checker))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_b2_open_ended -v`
Expected: FAIL — `is_open_ended_problem` still exists, and `annotate_kills` /
`crosscheck_optimal_brute` reject the `checker` keyword.

- [ ] **Step 3: Delete the detector and update the four sites**

Site A — `benchmark_suite.py`, `b2_verdict` (707): delete lines 720-728 so control falls
straight through to the `if not wrong_files:` branch at 729, and drop the "Abstains
(`cannot_judge`)" paragraph from the docstring (717-718). Keep the `cannot_judge` key in
every returned dict (set to `False`) — `testcase_annotate.py:412` reads it.

Site B — `benchmark_suite.py`, `crosscheck_optimal_brute` (1397): add `checker=None` and use
it at 1415:

```python
    for inp, (o, s1), (br, s2) in zip(candidates, opt, bru):
        if s1 != "ok" or s2 != "ok" or normalize(o) == normalize(br):
            continue
        # A different-but-valid brute answer is not a disagreement — the driver would
        # accept it too. Without this, every open-ended problem reports fake mismatches,
        # which is exactly why the old regex skipped the sweep entirely.
        from open_ended_checker import accepts
        if accepts(checker, inp, normalize(br)):
            continue
        out.append({"input": inp, "optimal": normalize(o)[:80], "brute": normalize(br)[:80]})
```

Then in `run_benchmark` (1557) delete `and not is_open_ended_problem(description)` and pass
the checker where `crosscheck_optimal_brute` is called.

Site C — `generate_brute_force.py`: remove `is_open_ended_problem` from the import at 192-198
and delete the skip at 235-238 entirely. Pass the checker into `crosscheck_optimal_brute`:

```python
        from open_ended_checker import load_checker
        checker = load_checker(os.path.join("Outputs", "generatedFullCode", "PYTHON.py"))
        mismatches = crosscheck_optimal_brute(
            optimal_solution, brute_content, examples, checker=checker)
```

Site D — `validate_solutions.py`: remove `is_open_ended_problem` from the import at 23,
delete line 83, and rewrite 102-104:

```python
        if b is not None:
            bout, bstatus = b
            agrees = accepts(checker, e.get("input", ""), normalize(bout)) or (
                status == "ok" and bstatus == "ok" and normalize(bout) == normalize(out)
            )
```

with `checker` a new keyword-only parameter of `validate_examples` (72), defaulting to
`None`, supplied by `_run_solution_validation` (`generate_brute_force.py:138`).

Finally delete `_OPEN_ENDED_RE` (1378-1386) and `is_open_ended_problem` (1390-1394), then
confirm nothing references them:

```bash
cd pipeline/Scripts && grep -rn "is_open_ended_problem\|_OPEN_ENDED_RE" . --include="*.py"
```
Expected: no output.

- [ ] **Step 4: Make kill scoring read the driver's output**

In `pipeline/Scripts/testcase_annotate.py`, add `checker=None` to `annotate_kills` (171) and
route the comparison through `effective_output` (190-195):

```python
    from open_ended_checker import effective_output
    ...
        for c, exp, res in zip(cases, expected, results):
            out, status = res
            got = _norm_out(out)
            if status == "ok":
                # Ask the checker the same question the driver will ask at grading time:
                # a valid-but-different answer makes the driver print the REFERENCE's
                # answer, which is the stored output, so that case does not discriminate.
                got = _norm_out(effective_output(checker, c["input"], got, exp))
            if status != "ok" or got != exp:
                c["kills"].add(name)
                caught += 1
```

and load the checker once in `run_annotation`, before the `annotate_kills` call:

```python
    from open_ended_checker import load_checker
    from problem_flags import load_open_ended

    checker = None
    if load_open_ended(outputs_dir):
        checker = load_checker(
            os.path.join(outputs_dir, "generatedFullCode", "PYTHON.py"))
```

- [ ] **Step 5: Prune the tests that covered the detector**

- `tests/test_optimal_brute_crosscheck.py`: delete class `OpenEndedDetectorTests` (114-124).
- `tests/test_b2_gate.py`: delete `test_open_ended_problem_abstains_instead_of_passing`
  (55-61); rewrite `test_every_return_path_carries_every_key` (70-78) to walk the three
  surviving paths (`missing`, `pass`, `hard_fail`) instead of the abstain path.
- `tests/test_validate_solutions.py`: replace `test_open_ended_never_fails_brute` (102-112)
  with the checker-based equivalent — a brute whose output the checker accepts must set
  `brute_agrees: True`, and one it rejects must set it False.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_b2_open_ended -v`
Expected: PASS (9 tests)

- [ ] **Step 7: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 330 tests (325 − 4 deleted + 9 added).

- [ ] **Step 8: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(b2): grade open-ended problems with the checker and delete the regex"
```

---

## Phase 2 — C++, Java and Node.js

**Do not start Phase 2 until Phase 1 is done as defined in Execution Order.**

The checker is translated into every enabled language, so it is four checkers, not one. A
subtly wrong Java translation grades Java students by a different standard, and nothing
downstream notices: the Java suite still runs, still produces output, still reports a score.
The spec calls this "the largest risk in the design". Phase 1 exists so the mechanism can be
watched working in one language before that risk is taken on.

---

### Task 8: Translate the checker into every enabled language

**Files:**
- Modify: `pipeline/Scripts/Prompts/conversionPrompt.py` — `get_conversion_prompt` (4)
- Modify: `pipeline/Scripts/generate_full_question.py` — `run_translate_step` (565), the call
  at 589
- Test: `pipeline/Scripts/tests/test_conversion_checker.py` (create)

**Interfaces:**
- New signature: `get_conversion_prompt(target_language, source_code, question_type,
  description_signature=None, desc_response=None, open_ended=False)` — returns a string.
- Reuses `checker_defects` from Task 3 for Python and adds
  `checker_defects_for(language, source) -> list[str]` in `pipeline/Scripts/problem_flags.py`
  for the other three (regex-level, since there is no `ast` for them).

**The per-language contract, fixed and identical everywhere.** `Prompts/conversionPrompt.py`
already carries per-language rule blocks — C++ 59-72, Java 73-90, Node.js 91-109, Python
110-133 — so the checker rules go in the same place:

| language | shape | where it must live |
| --- | --- | --- |
| C++ | `std::string reference_answer(const std::string& stdin_text);` `bool is_valid_answer(const std::string& stdin_text, const std::string& candidate);` | free functions at file scope, **not** members of `solution` |
| Java | `static String referenceAnswer(String stdinText)` / `static boolean isValidAnswer(String stdinText, String candidate)` **named exactly `reference_answer` / `is_valid_answer`** — keep the snake_case names, Java permits them | `static` methods of the driver's `Main` class, never of `Solution` |
| Node.js | `function reference_answer(stdinText)` / `function is_valid_answer(stdinText, candidate)` | top-level functions; the Node driver `eval`s `Solution.js` (splittingPrompt.py:504-512) and uses **static** methods (196-199), so the checker must not be attached to `Solution` |

The names are identical in all four languages **on purpose**: the driver template calls them
by name and the static gates grep for them by name. A per-language naming convention would
mean four spellings to keep in sync across the prompt, the splitter and B2.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_conversion_checker.py`:

```python
"""Four languages, one checker contract — or Java students are graded differently.

The reference is translated per language, so a subtly wrong translation of `is_valid_answer`
silently applies a different grading standard to that language's submissions. The names and
the two-argument/one-argument shapes are identical everywhere so a static gate can check
them without parsing four grammars.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from problem_flags import checker_defects_for  # noqa: E402
from Prompts.conversionPrompt import get_conversion_prompt  # noqa: E402

CPP = '''
class solution { public: vector<int> f(vector<int> a) { return a; } };
std::string reference_answer(const std::string& stdin_text) { return "0 1"; }
bool is_valid_answer(const std::string& stdin_text, const std::string& candidate) { return true; }
'''

JAVA = '''
class Solution { int[] f(int[] a) { return a; } }
static String reference_answer(String stdinText) { return "0 1"; }
static boolean is_valid_answer(String stdinText, String candidate) { return true; }
'''

JS = '''
class Solution { static f(a) { return a; } }
function reference_answer(stdinText) { return "0 1"; }
function is_valid_answer(stdinText, candidate) { return true; }
'''


class TestCheckerDefectsPerLanguage(unittest.TestCase):
    def test_well_formed_translations_have_no_defects(self):
        self.assertEqual(checker_defects_for("C++", CPP), [])
        self.assertEqual(checker_defects_for("Java", JAVA), [])
        self.assertEqual(checker_defects_for("Node.js", JS), [])

    def test_a_missing_function_is_a_defect_in_every_language(self):
        for lang, src in (("C++", CPP), ("Java", JAVA), ("Node.js", JS)):
            with self.subTest(lang=lang):
                bad = src.replace("is_valid_answer", "isValidAnswer")
                self.assertIn("is_valid_answer", " ".join(checker_defects_for(lang, bad)))

    def test_a_renamed_reference_answer_is_a_defect(self):
        bad = CPP.replace("reference_answer", "referenceAnswer")
        self.assertIn("reference_answer", " ".join(checker_defects_for("C++", bad)))

    def test_python_still_routes_to_the_ast_check(self):
        bad = "class solution:\n    def reference_answer(self, s):\n        return '1'\n"
        self.assertIn("module-level", " ".join(checker_defects_for("Python", bad)))


class TestConversionPrompt(unittest.TestCase):
    def test_the_checker_rules_appear_only_when_open_ended(self):
        for lang in ("C++", "Java", "Node.js"):
            with self.subTest(lang=lang):
                off = get_conversion_prompt(lang, "src", "standard")
                on = get_conversion_prompt(lang, "src", "standard", open_ended=True)
                self.assertNotIn("is_valid_answer", off)
                self.assertIn("is_valid_answer", on)
                self.assertIn("reference_answer", on)

    def test_the_prompt_forbids_attaching_the_checker_to_the_solution_class(self):
        for lang in ("C++", "Java", "Node.js"):
            with self.subTest(lang=lang):
                on = get_conversion_prompt(lang, "src", "standard", open_ended=True)
                self.assertIn("not", on.lower())
                self.assertIn("solution", on.lower())

    def test_the_prompt_requires_identical_behaviour_not_a_rewrite(self):
        on = get_conversion_prompt("Java", "src", "standard", open_ended=True)
        self.assertIn("identical", on.lower())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_conversion_checker -v`
Expected: FAIL with `ImportError: cannot import name 'checker_defects_for'`

- [ ] **Step 3: Write the per-language gate**

Append to `pipeline/Scripts/problem_flags.py`:

```python
import re as _re


def checker_defects_for(language, source):
    """Static defects in a translated checker. Python routes to the AST check; the others
    are name/arity greps, which is enough to catch the failure that actually happens — a
    translator that renamed the functions or folded them into the solution class."""
    lang = (language or "").strip().lower()
    if lang in ("python", "py"):
        return checker_defects(source)
    src = source or ""
    defects = []
    for name in CHECKER_NAMES:
        if not _re.search(rf"\b{name}\s*\(", src):
            defects.append(f"{language}: {name} is missing or was renamed; the driver "
                           f"calls it by that exact name")
    return defects
```

- [ ] **Step 4: Add the checker rules to the conversion prompt**

In `pipeline/Scripts/Prompts/conversionPrompt.py`, add `open_ended=False` as the last
parameter of `get_conversion_prompt` (4), and when it is set, interpolate a per-language
block next to the existing rule blocks (C++ 59-72, Java 73-90, Node.js 91-109):

```python
_OPEN_ENDED_CONVERSION = {
    "C++": """
**OPEN-ENDED CHECKER — TRANSLATE IT TOO:**
The source contains `reference_answer(stdin_text)` and
`is_valid_answer(stdin_text, candidate_stdout)`. Translate BOTH as free functions at file
scope, NOT as members of `solution`:
    std::string reference_answer(const std::string& stdin_text);
    bool is_valid_answer(const std::string& stdin_text, const std::string& candidate);
Keep the names EXACTLY. Their behaviour must be IDENTICAL to the Python original for every
input — same acceptance set, same bytes out of `reference_answer`, including spacing and
number formatting. Do not "improve" the logic.
""",
    "Java": """
**OPEN-ENDED CHECKER — TRANSLATE IT TOO:**
Translate `reference_answer` and `is_valid_answer` as `static` methods, keeping the
snake_case names EXACTLY (Java allows them):
    static String reference_answer(String stdinText)
    static boolean is_valid_answer(String stdinText, String candidate)
They belong to the driver, NOT to `Solution`. Their behaviour must be IDENTICAL to the
Python original for every input, including how numbers are formatted into the output string.
""",
    "Node.js": """
**OPEN-ENDED CHECKER — TRANSLATE IT TOO:**
Translate `reference_answer` and `is_valid_answer` as top-level functions, keeping the names
EXACTLY:
    function reference_answer(stdinText)
    function is_valid_answer(stdinText, candidate)
Do NOT attach them to `Solution` — the driver `eval`s the user's `Solution.js` and would
shadow them. Their behaviour must be IDENTICAL to the Python original for every input.
""",
}
```

Then in `run_translate_step` (`generate_full_question.py:565`), read the flag once and gate
each translation:

```python
    from problem_flags import checker_defects_for, load_open_ended

    open_ended = load_open_ended(OUTPUT_DIR)
    ...
        conv_prompt = get_conversion_prompt(
            lang, working_code, structure_type, description_signature, desc_response,
            open_ended=open_ended,
        )
        conv_response, conv_usage = call_llm(conv_prompt, "", purpose="code")
        _track_llm_usage(conv_usage, f"{problem_name}_convert_{lang}", purpose="code")
        ...
        clean_code = clean_generated_code(clean_code, lang)
        if open_ended:
            defects = checker_defects_for(lang, clean_code)
            if defects:
                print(f"ERROR: the {lang} translation lost the checker:")
                for d in defects:
                    print(f"  - {d}")
                sys.exit(1)
```

`_track_llm_usage` stays on every translation, unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_conversion_checker -v`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 337 tests.

- [ ] **Step 7: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(translate): carry the checker into C++, Java and Node.js"
```

---

### Task 9: The C++, Java and Node.js drivers carry the checker

**Files:**
- Modify: `pipeline/Scripts/Prompts/splittingPrompt.py` — the C++ (306-366), Java (381-487)
  and Node.js (500-576) driver templates, and the `open_ended_rules` block from Task 5
- Modify: `pipeline/Scripts/code_splitter.py` — `split_defects` from Task 5
- Test: `pipeline/Scripts/tests/test_split_open_ended.py` (append)

**Interfaces:** unchanged from Task 5; `split_defects(language_name, split_data, open_ended)`
gains per-language marker and raw-stdin knowledge.

**Raw stdin capture, per language.** Each driver needs the untouched stdin text in the
Output Area while its existing reader keeps working:

| language | capture | re-point the existing reader |
| --- | --- | --- |
| C++ (317: `#include "solution.cpp"`) | `std::string RAW_STDIN((std::istreambuf_iterator<char>(std::cin)), {});` | `std::istringstream _in(RAW_STDIN); std::cin.rdbuf(_in.rdbuf());` |
| Java (393-434 `FastReader` over `System.in`) | read all of `System.in` into `RAW_STDIN` | `System.setIn(new ByteArrayInputStream(RAW_STDIN.getBytes()))` **before** `FastReader` is constructed |
| Node.js (504-512, already reads all input) | it already slurps stdin — bind that string to `RAW_STDIN` | none needed |

Output Area, per language — same rule as Python, and **never a verdict word**:

```cpp
    // Output Area Start
    std::string _candidate = /* stringify result exactly as the single-answer driver does */;
    if (is_valid_answer(RAW_STDIN, _candidate)) std::cout << reference_answer(RAW_STDIN) << "\n";
    else std::cout << _candidate << "\n";
    // Output Area End
```

**Marker names differ per language and must not be normalised.** C++ uses
`// Function call Area Start` with a **lowercase `call`** (splittingPrompt.py:341); Node.js
uses `// Output Printing Area Start` / `// Output Printing Area End ` (552, 556 — trailing
space on the End). These are the strings the model is asked to reproduce; changing them
changes the template.

- [ ] **Step 1: Write the failing test**

Append to `pipeline/Scripts/tests/test_split_open_ended.py`:

```python
class TestSplitOpenEndedOtherLanguages(unittest.TestCase):
    def _driver(self, lang):
        return {
            "C++": ("#include <sstream>\nstd::string RAW_STDIN;\n"
                    "std::string reference_answer(const std::string& s){return \"0 1\";}\n"
                    "bool is_valid_answer(const std::string& s, const std::string& c){return true;}\n"
                    "auto start=high_resolution_clock::now();\nauto res=sol.f(a);\n"
                    "auto end=high_resolution_clock::now();\n"
                    "if (is_valid_answer(RAW_STDIN,_c)) std::cout<<reference_answer(RAW_STDIN);\n"
                    "else std::cout<<_c;\n"),
            "Java": ("String RAW_STDIN = readAll();\n"
                     "static String reference_answer(String s){return \"0 1\";}\n"
                     "static boolean is_valid_answer(String s,String c){return true;}\n"
                     "long start_time_ns=System.nanoTime();\nint[] res=sol.f(a);\n"
                     "long end_time_ns=System.nanoTime();\n"
                     "if (is_valid_answer(RAW_STDIN,_c)) System.out.println(reference_answer(RAW_STDIN));\n"
                     "else System.out.println(_c);\n"),
            "Node.js": ("const RAW_STDIN = fs.readFileSync(0,'utf8');\n"
                        "function reference_answer(s){return '0 1';}\n"
                        "function is_valid_answer(s,c){return true;}\n"
                        "const start=process.hrtime.bigint();\nconst res=Solution.f(a);\n"
                        "const end=process.hrtime.bigint();\n"
                        "if (is_valid_answer(RAW_STDIN,_c)) console.log(reference_answer(RAW_STDIN));\n"
                        "else console.log(_c);\n"),
        }[lang]

    def _split(self, lang):
        return {"default_code": "class X{}", "solution_code": "class X{}",
                "driver_code": self._driver(lang), "debugger_code": "N/A"}

    def test_each_language_splits_clean(self):
        for lang in ("C++", "Java", "Node.js"):
            with self.subTest(lang=lang):
                self.assertEqual(code_splitter.split_defects(lang, self._split(lang), True), [])

    def test_a_missing_raw_stdin_capture_is_a_defect(self):
        for lang in ("C++", "Java", "Node.js"):
            with self.subTest(lang=lang):
                s = self._split(lang)
                s["driver_code"] = s["driver_code"].replace("RAW_STDIN", "STDIN_X")
                self.assertTrue(code_splitter.split_defects(lang, s, True))

    def test_a_verdict_is_a_defect_in_every_language(self):
        for lang in ("C++", "Java", "Node.js"):
            with self.subTest(lang=lang):
                s = self._split(lang)
                s["driver_code"] += '\nprintOut("INVALID");\n'
                self.assertIn("verdict", " ".join(code_splitter.split_defects(lang, s, True)))

    def test_the_checker_may_not_leak_into_user_facing_code_in_any_language(self):
        for lang in ("C++", "Java", "Node.js"):
            with self.subTest(lang=lang):
                s = self._split(lang)
                s["solution_code"] += "\nbool is_valid_answer(){return true;}\n"
                self.assertIn("solution_code",
                              " ".join(code_splitter.split_defects(lang, s, True)))


class TestSplittingPromptOtherLanguages(unittest.TestCase):
    def test_every_language_gets_the_checker_rules(self):
        for lang in ("C++", "Java", "Node.js"):
            with self.subTest(lang=lang):
                on, _ = get_splitting_prompt(lang, "code", desc_response="d", open_ended=True)
                self.assertIn("reference_answer", on)
                self.assertIn("RAW_STDIN", on)

    def test_the_per_language_markers_keep_their_exact_spelling(self):
        on, _ = get_splitting_prompt("C++", "code", desc_response="d", open_ended=True)
        self.assertIn("// Function call Area Start", on, "C++ uses a lowercase 'call'")
        on, _ = get_splitting_prompt("Node.js", "code", desc_response="d", open_ended=True)
        self.assertIn("// Output Printing Area Start", on)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_split_open_ended -v`
Expected: FAIL — `split_defects` has no raw-stdin rule and the per-language prompt blocks do
not exist.

- [ ] **Step 3: Extend the prompt and the gate**

Turn Task 5's single `open_ended_rules` string into a per-language dict keyed the same way
`_OPEN_ENDED_CONVERSION` is (`"Python"`, `"C++"`, `"Java"`, `"Node.js"`), each carrying its
own capture snippet and Output Area shape from the tables above, and select on `{language}`.

Extend `split_defects` in `code_splitter.py` with the raw-stdin rule:

```python
    if "RAW_STDIN" not in driver:
        defects.append("driver_code never captures the raw stdin the checker needs")
```

The existing name-based rules (missing checker, leak into `solution_code`/`default_code`,
verdict words, timing window) are language-agnostic string checks and already work for all
four; the timing-window rule needs the per-language markers:

```python
_TIMING_MARKERS = {
    "Python": ("start_time_ns", "end_time_ns"),
    "C++": ("high_resolution_clock::now()", "high_resolution_clock::now()"),
    "Java": ("System.nanoTime()", "System.nanoTime()"),
    "Node.js": ("process.hrtime.bigint()", "process.hrtime.bigint()"),
}
```
— take the first and last occurrence for the languages whose start and end calls are the
same expression.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_split_open_ended -v`
Expected: PASS (16 tests: Task 5's 10 plus 6)

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 343 tests.

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(split): carry the checker into the C++, Java and Node.js drivers"
```

---

### Task 10: B2 verifies the checker in every enabled language

**Files:**
- Modify: `pipeline/Scripts/benchmark_compiler.py` — `run_solutions_batch_compiler` (98),
  `run_solution_compiler` (174), the constants at 31-34
- Modify: `pipeline/Scripts/benchmark_suite.py` — `run_solutions_batch` (204),
  `run_solution` (166)
- Modify: `pipeline/Scripts/testcase_annotate.py` — `run_annotation`
- Test: `pipeline/Scripts/tests/test_b2_multilang.py` (create)

**Interfaces:**
- `run_solutions_batch_compiler(code_str, inputs, timeout, language="python")`
- `run_solutions_batch(code_str, inputs, timeout=BENCHMARK_RUN_TIMEOUT, language="python")`
- Produces `verify_checker_languages(outputs_dir, languages, cases, runner) -> list[dict]` in
  `pipeline/Scripts/open_ended_checker.py` — the per-language reference check.

**What it verifies.** For each enabled language, run **that language's assembled main file**
against every stored case and require its stdout to equal the stored `output`. The reference
must match everywhere. A translation that broke `reference_answer` fails here — which is the
only place it can fail, because everything downstream just records the score.

**Scope limit, stated plainly.** `benchmark_compiler.py` hardcodes `PYTHON_LANG_ID = "22"` /
`MAIN_FILE = "main.py"` (31-32) and `build_compile_payload` takes a `lang_id`
(`execution_manager_v3.py:513-525`). The ids and main-file names come from
`execution_manager_v3.LANG_CONFIG` (115-140): C++ `"7"` / `main.cpp`, Python `"22"` /
`main.py`, Java `"30"` / `Main.java`. **Node.js has no entry** — the compiler supports three
languages ("The new compiler supports only these three languages",
`execution_manager_v3.py:112`), and Node.js is routed to `execution_manager_v2.py` instead
(`src/lib/pipeline-config.ts:275-281`, `execution_manager_v3.py:151,180,1038`). So this task
covers **Python, C++ and Java**. Node.js keeps its existing coverage from the
`execute_tests_function` step, and that gap must be stated in the step log rather than
papered over — a silently-unverified Node.js checker is the exact failure mode Phase 2 exists
to prevent.

**Requires `BENCHMARK_USE_COMPILER=1`.** Without it, `run_solutions_batch` (204-213) falls
back to the local Python subprocess/batch runner, which cannot run C++ or Java at all. When
the flag is off, skip the per-language check and say so.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_b2_multilang.py`:

```python
"""One checker per enabled language, and only B2 can catch a bad translation.

If the Java translation of `is_valid_answer` is subtly wrong, Java submissions are graded by
a different standard than Python ones and every downstream step still reports a clean run.
So the reference is run through EVERY enabled language and must reproduce the stored output
everywhere.

No network here: the runner is injected.
"""

import os
import sys
import types
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

for _name in ("httpx", "openai", "dotenv", "psycopg2", "requests"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda n: type(n, (Exception,), {})
        sys.modules[_name] = _stub

from open_ended_checker import COMPILER_LANGUAGES, verify_checker_languages  # noqa: E402

CASES = [{"order": 1, "input": "a\n", "output": "0 1"},
         {"order": 2, "input": "b\n", "output": "0 1"}]


class TestVerifyCheckerLanguages(unittest.TestCase):
    def test_a_matching_reference_passes_in_every_language(self):
        runner = lambda src, inputs, lang: [("0 1", "ok") for _ in inputs]
        self.assertEqual(
            verify_checker_languages("/tmp", ["python", "cpp", "java"], CASES, runner), [])

    def test_a_broken_java_translation_is_reported_with_its_language(self):
        def runner(src, inputs, lang):
            return [("9 9" if lang == "java" else "0 1", "ok") for _ in inputs]
        fails = verify_checker_languages("/tmp", ["python", "cpp", "java"], CASES, runner)
        self.assertTrue(fails)
        self.assertTrue(all(f["language"] == "java" for f in fails))
        self.assertEqual(fails[0]["order"], 1)

    def test_a_language_that_crashes_is_reported_not_swallowed(self):
        runner = lambda src, inputs, lang: [("", "error") for _ in inputs]
        fails = verify_checker_languages("/tmp", ["cpp"], CASES, runner)
        self.assertEqual(len(fails), 2)
        self.assertIn("<error>", fails[0]["got"])

    def test_nodejs_is_not_attempted_and_is_reported_as_uncovered(self):
        """The grading compiler supports three languages; Node.js has no lang id, so it
        must be named as uncovered rather than silently counted as verified."""
        seen = []
        runner = lambda src, inputs, lang: (seen.append(lang) or [("0 1", "ok") for _ in inputs])
        fails = verify_checker_languages("/tmp", ["python", "nodejs"], CASES, runner)
        self.assertNotIn("nodejs", seen)
        self.assertTrue(any(f.get("uncovered") for f in fails))

    def test_the_compiler_language_map_matches_execution_manager_v3(self):
        self.assertEqual(COMPILER_LANGUAGES["python"], ("22", "main.py"))
        self.assertEqual(COMPILER_LANGUAGES["cpp"], ("7", "main.cpp"))
        self.assertEqual(COMPILER_LANGUAGES["java"], ("30", "Main.java"))
        self.assertNotIn("nodejs", COMPILER_LANGUAGES)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_b2_multilang -v`
Expected: FAIL with `ImportError: cannot import name 'verify_checker_languages'`

- [ ] **Step 3: Thread a language through the compiler client**

In `pipeline/Scripts/benchmark_compiler.py`, replace the two module constants at 31-32 with a
parameter. Keep `PYTHON_LANG_ID` / `MAIN_FILE` as the defaults so no existing caller changes
behaviour:

```python
LANG_IDS = {"python": ("22", "main.py"), "cpp": ("7", "main.cpp"), "java": ("30", "Main.java")}


def run_solutions_batch_compiler(code_str, inputs, timeout, language="python"):
    lang_id, main_file = LANG_IDS.get(language, (PYTHON_LANG_ID, MAIN_FILE))
    files_payload = [{"file_path": main_file, "file_contents": code_str,
                      "base64_encoded": False}]
    ...
    compile_payload = build_compile_payload(lang_id, main_file, files_payload, ...)
```

and add `language="python"` to `run_solution_compiler` (174), forwarding it. Then add the
same keyword to `benchmark_suite.run_solutions_batch` (204) and `run_solution` (166),
forwarding it only on the `_use_compiler()` branch — the local branch stays Python-only and
must raise a clear error if asked for another language rather than silently running C++
through `python3`.

- [ ] **Step 4: Write the per-language verification**

Append to `pipeline/Scripts/open_ended_checker.py`:

```python
# Mirrors execution_manager_v3.LANG_CONFIG (115-140). Node.js is deliberately absent: the
# grading compiler supports three languages, and Node.js runs through execution_manager_v2.
COMPILER_LANGUAGES = {
    "python": ("22", "main.py"),
    "cpp": ("7", "main.cpp"),
    "java": ("30", "Main.java"),
}

_MAIN_SOURCES = {
    "python": os.path.join("CodeContentFiles", "Python", "driver.py"),
    "cpp": os.path.join("CodeContentFiles", "Cpp", "driver.cpp"),
    "java": os.path.join("CodeContentFiles", "Java", "driver.java"),
}


def verify_checker_languages(outputs_dir, languages, cases, runner):
    """Run the reference through EVERY enabled language and require the stored output.

    This is the only gate that can catch a broken translation of the checker: everything
    downstream just records whatever score comes back, so a Java `is_valid_answer` that
    accepts too much would grade Java students by a different standard and report success.

    `runner(source, inputs, language) -> [(stdout, status), ...]`; injected so tests never
    touch the compiler. Returns a list of failure dicts; empty means every language agrees.
    """
    failures = []
    inputs = [c.get("input", "") or "" for c in cases]
    for lang in languages:
        key = str(lang).strip().lower()
        if key not in COMPILER_LANGUAGES:
            failures.append({"language": key, "uncovered": True, "order": None,
                             "expected": "", "got": "",
                             "detail": f"{key} has no grading-compiler language id; its "
                                       f"checker is NOT verified here — it is only covered "
                                       f"by the execute_tests step"})
            continue
        rel = _MAIN_SOURCES[key]
        path = os.path.join(outputs_dir, rel)
        try:
            with open(path, encoding="utf-8") as f:
                source = f.read()
        except OSError as e:
            failures.append({"language": key, "order": None, "expected": "",
                             "got": "<missing>", "detail": f"could not read {rel} ({e})"})
            continue
        for tc, (out, status) in zip(cases, runner(source, inputs, key)):
            expected = (tc.get("output") or "").strip()
            got = (out or "").strip()
            if status != "ok":
                failures.append({"language": key, "order": tc.get("order"),
                                 "expected": expected, "got": f"<{status}>", "detail": ""})
            elif got != expected:
                failures.append({"language": key, "order": tc.get("order"),
                                 "expected": expected, "got": got[:200],
                                 "detail": "the translated reference does not reproduce "
                                           "the stored output"})
    return failures
```

- [ ] **Step 5: Wire it into the gate**

In `testcase_annotate.run_annotation`, after the existing B2 verdict and before the blocking
check at 443, add:

```python
    from open_ended_checker import verify_checker_languages
    from problem_flags import load_open_ended

    if load_open_ended(outputs_dir) and os.environ.get(
            "BENCHMARK_USE_COMPILER", "").strip().lower() in ("1", "true", "yes"):
        from benchmark_suite import run_solutions_batch
        langs = [l.strip().lower() for l
                 in os.environ.get("PIPELINE_ENABLED_LANGS", "python,cpp,java,nodejs").split(",")
                 if l.strip()]
        lang_fails = verify_checker_languages(
            outputs_dir, langs, cases,
            lambda src, inputs, lang: run_solutions_batch(src, inputs, language=lang))
        for f in lang_fails:
            if f.get("uncovered"):
                log(f"      · {f['detail']}")
        hard = [f for f in lang_fails if not f.get("uncovered")]
        if hard:
            for f in hard[:12]:
                log(f"ERROR: {f['language']} case order={f['order']} "
                    f"expected={f['expected']!r} got={f['got']!r} {f['detail']}")
            b2["hard_fail"] = True
            b2["reason"] = ("the translated checker does not reproduce the stored outputs "
                            "in every enabled language")
    elif load_open_ended(outputs_dir):
        log("      · BENCHMARK_USE_COMPILER is not set — the C++/Java checkers are NOT "
            "verified. Set it before shipping an open-ended problem.")
```

`PIPELINE_ENABLED_LANGS` is the existing carrier, defined identically at
`prepare_lua_and_testcases.py:32-34` and `prepare_platform_json.py:368-369`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_b2_multilang -v`
Expected: PASS (5 tests)

- [ ] **Step 7: Run the whole suite**

Run: `npm run test:json`
Expected: PASS, 348 tests.

- [ ] **Step 8: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(b2): verify the checker in every enabled language"
```

---

## Execution Order

```
PHASE 1 — Python only
  Task 1 ──► Task 2 ──► Task 3 ──► Task 4 ──► Task 5
                                        └────► Task 7
  Task 6 (needs Task 1 only)  ──────────────► Task 7
                        ══════ PHASE 1 DONE ══════
PHASE 2 — C++, Java, Node.js
  Task 8 ──► Task 9 ──► Task 10
```

Task 1 is the root: every later task reads `Outputs/problem_flags.json`. Task 2 edits
`run_description_step`, which Task 1 also edits — **run them sequentially, never in parallel
worktrees.** Task 3 produces the checker Task 4 loads; Task 5 places what Task 3 produced;
Task 7 consumes Task 4's `open_ended_checker` module. Task 6 touches only the non-function
path and needs nothing but Task 1, so it can run alongside Tasks 3-5.

**Parallel-execution note:** Tasks 1, 2, 3 and 8 all edit `generate_full_question.py`; Tasks
5 and 9 both edit `splittingPrompt.py` and `code_splitter.py`; Tasks 1, 3 and 8 all edit
`problem_flags.py`. Within each of those groups, run in the order listed or in the same
agent. Do not run them concurrently in separate worktrees.

### The phase boundary, and why it is here

The checker is translated into every enabled language, so it is **four checkers, not one**. A
subtly wrong Java translation of `is_valid_answer` grades Java students by a different
standard than Python ones, and **nothing downstream would notice** — the Java suite still
runs, still returns a score, still reports success. That is the spec's "largest risk in the
design". Phase 1 gets the whole mechanism visible and working in one language first, so that
when Phase 2 goes wrong there is a known-good Python baseline to compare against instead of
four simultaneously-unproven translations.

### "Phase 1 done" means all of the following, concretely

1. `npm run test:json` is green at **330 tests** (272 baseline + 62 added − 4 deleted).
2. `grep -rn "is_open_ended_problem\|_OPEN_ENDED_RE" pipeline/Scripts --include="*.py"`
   returns nothing.
3. `grep -rn "get_description_spec_prompt\|get_description_prose_prompt\|assemble_description_parts" pipeline/Scripts --include="*.py"`
   returns nothing — the dead prompt trio is gone.
4. A full run of a **function-based open-ended problem** with `--langs python`, end to end
   (`generate_question` → `generate_testcases` → `generate_wrong_solutions` →
   `select_testcases` → `split_code` → `execute_tests_function`), produces:
   - `Outputs/problem_flags.json` with `open_ended: true`;
   - `Outputs/generatedFullCode/PYTHON.py` containing module-level `reference_answer` and
     `is_valid_answer` (`python3 -c "import problem_flags,sys; print(problem_flags.checker_defects(open('Outputs/generatedFullCode/PYTHON.py').read()))"` → `[]`);
   - `Outputs/CodeContentFiles/Python/driver.py` containing both functions and `RAW_STDIN`,
     and containing **none** of `VALID` / `INVALID` / `CORRECT` / `WRONG`;
   - `Outputs/CodeContentFiles/Python/solution.py` and `default.py` containing **neither**
     `reference_answer` nor `is_valid_answer`;
   - a green checker-grounding line, and a B2 verdict with `cannot_judge: False`;
   - `execute_tests_function` scoring the reference **150/150**, including cases 1 and 2.
5. A full run of a **non-function open-ended problem** produces at least one case with
   `multiple_possible_output: true` and a non-empty `outputs`, and
   `multi_answer_defects(cases, description)` returns `[]` — in particular the answer printed
   in Example 1 is in that case's `outputs`.
6. A full run of an ordinary **single-answer** problem is byte-identical in behaviour to
   before: `problem_flags.json` says `open_ended: false`, no checker is emitted, no driver
   changes, and B2 judges exactly as it did.

Item 6 is the regression guard. Open-ended problems are the minority; the change must be
invisible to everything else.

### Phase 2 done means

`npm run test:json` green at **348 tests**, a full `--langs python,cpp,java,nodejs` run of
the same open-ended problem scoring the reference 150/150 in **every** language, and the
`select_testcases` log naming Node.js explicitly as not verified by B2 (see Task 10's scope
limit) rather than omitting it.
