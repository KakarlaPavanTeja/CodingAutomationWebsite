# Testcase Generation Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop asking the LLM to predict computations we run anyway — derive size buckets, subtask numbering, weights and order deterministically, let the model own only the inputs and their semantic grouping, and gate the result on evidence (B2) instead of on a selector.

**Architecture:** The generator script produces 80–250 cases that ship as-is. A deterministic derive step assigns everything computable. The selector is removed; `testcase_annotate` keeps kill-scoring and TLE verification but no longer trims. B2 becomes the single blocking gate.

**Tech Stack:** Python 3 (stdlib `unittest`), no new dependencies. Tests live in `pipeline/Scripts/tests/`, run with `npm run test:json`.

**Spec:** `docs/superpowers/specs/2026-08-13-testcase-generation-simplification-design.md`

## Global Constraints

- Branch: `redesign/testcase-generation`. Never commit to `main`.
- All work is inside `pipeline/Scripts/` except Task 8, which also touches `src/lib/pipeline-config.ts`.
- Test runner: `npm run test:json` (from repo root) = `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest discover -s tests -p 'test_*.py'`. It must stay green after every task.
- Tests use stdlib `unittest`, class-based, with this exact import preamble (matching existing tests):
  ```python
  import os, sys, unittest
  SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
  sys.path.insert(0, SCRIPT_DIR)
  ```
- `MIN_SUBTASKS = 3`, `MAX_SUBTASKS = 12` (raised from 8), `MIN_TESTCASES = 25` (unchanged — the only enforced floor).
- Count band by difficulty: easy 80–120 · medium 120–180 · hard 180–250.
- Weight multipliers: `edge`/`small` = 1.0 · `medium` = 2.0 · `large` = 4.0 · ×1.5 if the group holds any `STRESS_SCENARIO_TAGS` tag. Range 1.0–6.0.
- **Tags stay plain strings.** `tier_from_tags` and `_scenario_of` parse tag lists positionally. Semantic subtask names go in a root-level `subtask_names` map, never inside the tag.
- Never log secrets or tokens. Preserve all `update_usage(...)` LLM-usage tracking calls when touching LLM paths.

---

### Task 1: Derive subtask groups, numbering and weights

**Files:**
- Modify: `pipeline/Scripts/testcase_helpers.py` (add at end, near `sync_subtask_tags`)
- Test: `pipeline/Scripts/tests/test_derive_subtasks.py` (create)

**Interfaces:**
- Consumes: existing `bucket_for_case(tc, max_n, kind)`, `case_size_metric(tc, kind, max_n)`, `dedupe_tags(tags)`, `_strip_subtask_tags(tags)` in `testcase_helpers.py`; `STRESS_SCENARIO_TAGS` and `subtask_tag(tier)` from `Prompts.testcasesprompt_v4`.
- Produces: `derive_subtasks(test_cases, kind, max_n) -> dict[str, str]` — mutates each case's `tags` and `weightage` in place, returns the `subtask_names` map (`{"subtask_1": "Empty And Singleton", ...}`). Tasks 5 and 8 call it.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_derive_subtasks.py`:

```python
"""Tests for derive_subtasks: semantic grouping -> demand-ordered numbering + weights.

A subtask is WHAT a case validates, not how big its input is. The model names the
group; we number the groups by demand so weights come out monotonic for free, and
give every case in a group the same weight.
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from testcase_helpers import derive_subtasks  # noqa: E402


def case(subtask, n, tags=None, order=1):
    """A minimal case whose first input token is its size."""
    return {
        "input": f"{n}\n" + " ".join("1" for _ in range(max(n, 1))) + "\n",
        "output": "1",
        "subtask": subtask,
        "tags": list(tags or []),
        "order": order,
    }


class TestDeriveSubtasks(unittest.TestCase):
    def test_groups_are_numbered_by_ascending_demand(self):
        cases = [
            case("max_constraint_performance", 100000),
            case("empty_and_singleton", 1),
            case("all_equal_elements", 10),
        ]
        names = derive_subtasks(cases, "count", 100000)
        by_subtask = {c["subtask"]: c["tags"] for c in cases}
        self.assertIn("subtask_1", by_subtask["empty_and_singleton"])
        self.assertIn("subtask_3", by_subtask["max_constraint_performance"])
        self.assertEqual(names["subtask_1"], "Empty And Singleton")
        self.assertEqual(names["subtask_3"], "Max Constraint Performance")

    def test_every_case_in_a_group_shares_one_weight(self):
        cases = [
            case("mixed_group", 1),
            case("mixed_group", 100000),
            case("mixed_group", 10),
        ]
        derive_subtasks(cases, "count", 100000)
        weights = {c["weightage"] for c in cases}
        self.assertEqual(len(weights), 1, "one group must carry exactly one weight")
        # The group holds a large case, so it is weighted as large.
        self.assertEqual(weights.pop(), 4.0)

    def test_stress_tag_multiplies_the_group_weight(self):
        cases = [case("perf", 100000, tags=["stress"])]
        derive_subtasks(cases, "count", 100000)
        self.assertEqual(cases[0]["weightage"], 6.0)  # 4.0 large * 1.5 stress

    def test_edge_only_group_gets_the_floor_weight(self):
        cases = [case("degenerate", 1)]
        derive_subtasks(cases, "count", 100000)
        self.assertEqual(cases[0]["weightage"], 1.0)

    def test_exactly_one_subtask_tag_per_case_and_no_stale_tags(self):
        cases = [case("grp_a", 5, tags=["subtask_9", "stress"])]
        derive_subtasks(cases, "count", 100000)
        subtask_tags = [t for t in cases[0]["tags"] if t.startswith("subtask_")]
        self.assertEqual(subtask_tags, ["subtask_1"], "stale subtask tag must be replaced")
        self.assertIn("stress", cases[0]["tags"], "non-subtask tags survive")

    def test_missing_subtask_name_falls_back_without_crashing(self):
        cases = [{"input": "1\n1\n", "output": "1", "tags": [], "order": 1}]
        names = derive_subtasks(cases, "count", 100000)
        self.assertTrue(any(t.startswith("subtask_") for t in cases[0]["tags"]))
        self.assertEqual(len(names), 1)

    def test_numbering_is_stable_for_equal_demand(self):
        cases = [case("beta_group", 5), case("alpha_group", 5)]
        first = derive_subtasks(cases, "count", 100000)
        cases2 = [case("alpha_group", 5), case("beta_group", 5)]
        second = derive_subtasks(cases2, "count", 100000)
        self.assertEqual(first, second, "equal demand must tie-break by name, not input order")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_derive_subtasks -v`
Expected: FAIL with `ImportError: cannot import name 'derive_subtasks'`

- [ ] **Step 3: Write minimal implementation**

Append to `pipeline/Scripts/testcase_helpers.py`:

```python
# --------------------------------------------------------------------------- #
# Semantic subtasks: the model names WHAT a case validates; we number the groups
# by demand and give every case in a group the same weight. Numbering by demand is
# what makes weights monotonic without a weight table.
# --------------------------------------------------------------------------- #
_DEMAND_RANK = {"edge": 0, "small": 1, "medium": 2, "large": 3}
_DEMAND_WEIGHT = {"edge": 1.0, "small": 1.0, "medium": 2.0, "large": 4.0}
STRESS_WEIGHT_MULTIPLIER = 1.5


def _subtask_display_name(slug: str) -> str:
    """"max_constraint_performance" -> "Max Constraint Performance"."""
    return " ".join(word.capitalize() for word in str(slug).split("_") if word) or "General"


def _case_is_stress(tc: dict) -> bool:
    from Prompts.testcasesprompt_v4 import STRESS_SCENARIO_TAGS
    names = {str(t) for t in (tc.get("tags") or []) if isinstance(t, str)}
    names.add(str(tc.get("scenario") or ""))
    return bool(names & set(STRESS_SCENARIO_TAGS))


def derive_subtasks(test_cases: list, kind: str, max_n: int) -> dict:
    """Group by the model's `subtask` name, number groups by demand, set weights.

    Mutates each case's `tags` (exactly one `subtask_<n>`, stale ones stripped) and
    `weightage` (one value per group). Returns {"subtask_1": "Display Name", ...} for
    the root-level `subtask_names` map — tags stay plain strings so `tier_from_tags`
    and `_scenario_of` keep parsing them unchanged.
    """
    cases = [tc for tc in (test_cases or []) if isinstance(tc, dict)]
    if not cases:
        return {}

    groups: dict[str, list] = {}
    for tc in cases:
        name = str(tc.get("subtask") or "").strip() or "general"
        groups.setdefault(name, []).append(tc)

    def _demand(members: list) -> tuple:
        rank = max(_DEMAND_RANK.get(bucket_for_case(tc, max_n, kind), 1) for tc in members)
        size = max(case_size_metric(tc, kind, max_n) or 0 for tc in members)
        return rank, size

    # Ascending demand; name breaks ties so numbering does not depend on input order.
    ordered = sorted(groups.items(), key=lambda kv: (_demand(kv[1]), kv[0]))

    names: dict[str, str] = {}
    for tier, (name, members) in enumerate(ordered, start=1):
        rank, _ = _demand(members)
        bucket = next(b for b, r in _DEMAND_RANK.items() if r == rank)
        weight = _DEMAND_WEIGHT[bucket]
        if any(_case_is_stress(tc) for tc in members):
            weight *= STRESS_WEIGHT_MULTIPLIER
        enum = subtask_tag(tier)
        names[enum] = _subtask_display_name(name)
        for tc in members:
            tc["tags"] = dedupe_tags(_strip_subtask_tags(tc.get("tags") or []) + [enum])
            tc["weightage"] = weight
    return names
```

If `subtask_tag` is not already imported in `testcase_helpers.py`, add it to the existing `from Prompts.testcasesprompt_v4 import ...` block.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_derive_subtasks -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS. `test_sync_subtask_tags.py` still passes — `sync_subtask_tags` is untouched in this task.

- [ ] **Step 6: Commit**

```bash
git add pipeline/Scripts/testcase_helpers.py pipeline/Scripts/tests/test_derive_subtasks.py
git commit -m "feat(testcases): derive semantic subtask groups, numbering and weights"
```

---

### Task 2: Raise MAX_SUBTASKS to 12 and drop the weight tables

**Files:**
- Modify: `pipeline/Scripts/Prompts/testcasesprompt_v4.py:28` (`MAX_SUBTASKS = 8`) and the `DISTRIBUTION_BY_MODE` / `DEFAULT_DISTRIBUTION_PRESET` definitions
- Delete: `pipeline/Scripts/tests/test_distribution_tables.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MAX_SUBTASKS == 12`, relied on by Task 3's prompt text and Task 7's B3 check. `DISTRIBUTION_BY_MODE` and `DEFAULT_DISTRIBUTION_PRESET` no longer exist — Task 5 removes their last importer.

- [ ] **Step 1: Change the constant**

In `pipeline/Scripts/Prompts/testcasesprompt_v4.py`, change `MAX_SUBTASKS = 8` to `MAX_SUBTASKS = 12`.

- [ ] **Step 2: Run the suite to see what breaks**

Run: `npm run test:json`
Expected: FAIL in `test_distribution_tables.py` — `DISTRIBUTION_BY_MODE` has rows only up to key 8, and the table's invariant is that the highest key equals `MAX_SUBTASKS`.

- [ ] **Step 3: Delete the weight tables**

Weights are derived per group now (Task 1), so the tables have no consumer. In `Prompts/testcasesprompt_v4.py` delete the `DISTRIBUTION_BY_MODE` dict, `DEFAULT_DISTRIBUTION_PRESET`, and any helper that reads them (e.g. a `distribution_for` / `weights_for_count` function). Delete `pipeline/Scripts/tests/test_distribution_tables.py`.

`testcase_manager_v4.py` still imports `DEFAULT_DISTRIBUTION_PRESET` at this point. Remove that name from its `from Prompts.testcasesprompt_v4 import (...)` block and delete the `--distribution` argparse option and the `distribution_preset=args.distribution` argument it feeds, so the suite stays importable. Task 5 removes the rest of that call site.

- [ ] **Step 4: Run the suite**

Run: `npm run test:json`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(testcases): raise MAX_SUBTASKS to 12, drop the weight distribution tables"
```

---

### Task 3: Prompt surgery

**Files:**
- Modify: `pipeline/Scripts/Prompts/testcasesprompt_v4.py`
- Test: `pipeline/Scripts/tests/test_prompt_shape.py` (create)
- Delete: `pipeline/Scripts/tests/test_size_fix_prompt.py`, `pipeline/Scripts/tests/test_audit_size_distribution.py`

**Interfaces:**
- Consumes: `MAX_SUBTASKS` / `MIN_SUBTASKS` from Task 2.
- Produces: `get_testcases_prompt(description, optimal_solution, brute_force_code=None, num_testcases=None, difficulty=None, is_function=False, signature_params=None, io_contract=None) -> (system, user)`. Removed parameters: `total_score`, `distribution_preset`, `problem_type`. Task 5 calls it with exactly this signature.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_prompt_shape.py`:

```python
"""The prompt asks only for judgment calls; everything computable is derived.

Guards the sections that were deleted (they described arithmetic we now do
ourselves) and the ones that must survive (each defends against a real observed
failure, and the reply is executed as Python).
"""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from Prompts.testcasesprompt_v4 import get_testcases_prompt  # noqa: E402

DESCRIPTION = (
    "Sum an array.\n\nConstraints\n1 <= n <= 100000\n\n"
    "Example 1\nInput\n3\n1 2 3\nOutput\n6\n"
)
SOLUTION = "import sys\nd=sys.stdin.read().split()\nprint(sum(map(int,d[1:])))\n"


def build(**kw):
    system, user = get_testcases_prompt(DESCRIPTION, SOLUTION, **kw)
    return system + "\n" + user


class TestPromptShape(unittest.TestCase):
    def test_deleted_sections_are_gone(self):
        text = build()
        for marker in [
            "WEIGHT DISTRIBUTION",
            "HOW THE SIZE AUDIT ACTUALLY BUCKETS",
            "SELF-CHECK BEFORE WRITE",
            "PER-PROBLEM-TYPE REQUIRED SCENARIOS",
            "SOURCE MUST BE PURE ASCII",
            "partial-credit judge",
        ]:
            self.assertNotIn(marker, text, f"{marker!r} should have been deleted")

    def test_defensive_sections_survive(self):
        text = build()
        for marker in [
            "OUTPUT HYGIENE",
            "NEVER CRASH",
            "IMPORT CORRECTNESS",
            "DUAL-ORACLE",
            "MULTI-AXIS STRESS",
            "ADVERSARIAL",
        ]:
            self.assertIn(marker, text, f"{marker!r} must survive — it defends a real failure")

    def test_states_the_difficulty_count_band(self):
        self.assertIn("120", build(difficulty="medium"))
        self.assertIn("250", build(difficulty="hard"))

    def test_explicit_count_overrides_the_band(self):
        self.assertIn("exactly 42", build(num_testcases=42))

    def test_asks_for_a_semantic_subtask_name(self):
        text = build()
        self.assertIn("subtask", text.lower())
        self.assertIn("snake_case", text)

    def test_does_not_ask_for_size_tags_or_weights(self):
        text = build()
        self.assertNotIn("size_edge", text, "size tags are derived, not declared")
        self.assertNotIn("weightage", text, "weights are derived, not declared")

    def test_says_the_suite_ships_untrimmed(self):
        self.assertIn("final suite", build().lower())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_prompt_shape -v`
Expected: FAIL — the deleted sections are still present, and `get_testcases_prompt` still requires the positional `total_score`.

- [ ] **Step 3: Perform the surgery**

In `Prompts/testcasesprompt_v4.py`:

1. Delete these prompt blocks entirely: the `scoring_block` (SCORING — partial-credit judge), `(WEIGHT DISTRIBUTION)`, the `(SIZE DISTRIBUTION …)` targets/tolerance block, `(HOW THE SIZE AUDIT ACTUALLY BUCKETS YOUR CASES …)`, `(SELF-CHECK BEFORE WRITE)`, `(PER-PROBLEM-TYPE REQUIRED SCENARIOS)`, `(SOURCE MUST BE PURE ASCII)`.
2. Delete the now-unused module constants and helpers: `SIZE_CATEGORY_TARGETS`, `SIZE_TOLERANCE_PP`, `TYPE_COUNT_HINT`, `POOL_TARGET_MIN`, `POOL_TARGET_MAX`, the `from testcase_selection import CASE_CAP, CASE_FLOOR, LARGE_FRAC, SMALL_FRAC` block, and `get_size_fix_prompt`. Keep `size_tag`, `subtask_tag`, `tier_from_tags`, `STRESS_SCENARIO_TAGS`, `MIN_TESTCASES`, `MAX_CASES_PER_SUBTASK` — all still have consumers.
3. Change the signature to `get_testcases_prompt(description, optimal_solution, brute_force_code=None, num_testcases=None, difficulty=None, is_function=False, signature_params=None, io_contract=None)`.
4. Replace `COUNT_BAND_BY_DIFFICULTY` and `_count_hint` with:

```python
COUNT_BAND_BY_DIFFICULTY = {
    "easy": (80, 120),
    "medium": (120, 180),
    "hard": (180, 250),
}


def _count_hint(difficulty, num_testcases):
    if num_testcases:
        return f"exactly {num_testcases} cases (the owner asked for this count)"
    lo, hi = COUNT_BAND_BY_DIFFICULTY.get(
        str(difficulty or "medium").strip().lower(), COUNT_BAND_BY_DIFFICULTY["medium"])
    return (f"{lo}-{hi} cases — pick within that band based on how large the problem's "
            f"legal input space actually is")
```

5. Replace the `(OVER-GENERATE …)` block with:

```python
    final_suite_block = f"""
(THIS IS THE FINAL SUITE — nothing trims it):
There is NO downstream selector. Every case you emit ships to the platform exactly as
written. So:
  * Emit {num_hint}. Every case must be DISTINCT — never pad with duplicates.
  * You are responsible for: correct outputs, distinct inputs, explicit edge cases, real
    at-MAX_N stress cases, and honest grouping (below).
  * You are NOT responsible for: size tags, weights, case order, or subtask numbers.
    Those are computed from your inputs after you run. Do not emit them.
"""
```

6. Add the new subtask block and include it in the assembled system prompt:

```python
    subtask_block = f"""
(SUBTASKS — group cases by WHAT THEY VALIDATE):
Every case carries a `subtask` field: a snake_case name for the behaviour that case is
checking. Cases validating the SAME behaviour MUST share the same name.
  * Good names describe a behaviour: `empty_and_singleton`, `all_equal_elements`,
    `duplicate_keys`, `max_constraint_performance`, `negative_values`.
  * Bad names describe a size or restate the problem: `small_cases`, `test_group_2`.
  * Use between {MIN_SUBTASKS} and {MAX_SUBTASKS} distinct names across the whole suite.
  * Numbering and weighting are derived from these groups afterwards — a group of
    max-constraint cases automatically outweighs a group of degenerate ones. Do NOT
    emit `subtask_1`-style tags or any `weightage`.
"""
```

7. In the `(DECLARED PER-CASE METADATA)` block and `(OUTPUT JSON SHAPE)`, the required per-case keys become exactly: `input`, `output`, `subtask`, `scenario`, `is_edge`, `size_metric`. Remove `weightage`, `tags` and `order` from both.
8. Delete `pipeline/Scripts/tests/test_size_fix_prompt.py` and `pipeline/Scripts/tests/test_audit_size_distribution.py` — both test deleted behaviour.

If `tests/test_testcases_prompt_metadata.py` asserts the old required-key list, update it to the new one rather than deleting it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_prompt_shape -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(testcases): cut the prompt to judgment calls only"
```

---

### Task 4: I/O contract — model proposes one layout, execution decides

**Files:**
- Modify: `pipeline/Scripts/testcase_manager_v4.py` — replace `_resolve_named_var_example` (lines 312-335) and its call site inside `verify_io_contract`
- Test: `pipeline/Scripts/tests/test_io_contract_llm.py` (create)

**Interfaces:**
- Consumes: existing `_run_reference_on_input(optimal_path, stdin_str, timeout)`, `_normalize_output(text)`, `update_usage(...)`, and `call_llm(system, user, purpose)` from `llm_client`.
- Produces: `resolve_example_stdin(optimal_path, block, expected, timeout, llm=None) -> (stdin, stdout, detail)` — same 3-tuple contract as the `_resolve_named_var_example` it replaces, so `verify_io_contract` needs only its call site renamed. `llm` is injected for testing; production passes `None` and the real `call_llm` is used.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_io_contract_llm.py`:

```python
"""The small model proposes ONE stdin layout; execution decides whether it is right.

The model reads the reference solution's actual parser, so there is no ambiguity left
to hedge against with multiple blind candidates. On a mismatch it gets ONE informed
retry that sees its own wrong stdout against the expected one.
"""

import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

import testcase_manager_v4 as tm  # noqa: E402

SOLUTION = "import sys\nd=sys.stdin.read().split()\nprint(sum(map(int,d[1:])))\n"


class FakeLLM:
    """Returns queued replies; records the prompts it was given."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    def __call__(self, system, user, purpose=None):
        self.prompts.append(user)
        return self.replies.pop(0), {"prompt_tokens": 1, "completion_tokens": 1,
                                     "model": "fake", "cost": 0.0}


class TestResolveExampleStdin(unittest.TestCase):
    def setUp(self):
        self._orig = tm._run_reference_on_input
        fd, self.sol = tempfile.mkstemp(suffix=".py")
        with os.fdopen(fd, "w") as f:
            f.write(SOLUTION)

    def tearDown(self):
        tm._run_reference_on_input = self._orig
        os.unlink(self.sol)

    def test_accepts_a_layout_the_reference_reproduces(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: ("6", "ok")
        llm = FakeLLM("3\n1 2 3\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "3\n1 2 3\n")
        self.assertEqual(stdout, "6")
        self.assertIsNone(detail)
        self.assertEqual(len(llm.prompts), 1, "one call on the happy path")

    def test_retries_once_with_the_wrong_output_fed_back(self):
        def fake_run(path, stdin, timeout):
            return ("6", "ok") if stdin == "3\n1 2 3\n" else ("0", "ok")

        tm._run_reference_on_input = fake_run
        llm = FakeLLM("1 2 3\n", "3\n1 2 3\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "3\n1 2 3\n")
        self.assertEqual(len(llm.prompts), 2, "exactly one retry")
        self.assertIn("0", llm.prompts[1], "retry must show what the layout printed")
        self.assertIn("6", llm.prompts[1], "retry must show what was expected")

    def test_gives_up_after_one_retry(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: ("999", "ok")
        llm = FakeLLM("a\n", "b\n")
        stdin, stdout, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1]", "6", 5.0, llm=llm)
        self.assertIsNone(stdin)
        self.assertIsNotNone(detail)
        self.assertEqual(len(llm.prompts), 2, "never more than two calls")

    def test_a_crashing_reference_is_reported_not_accepted(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: ("", "error")
        llm = FakeLLM("x\n", "y\n")
        stdin, _, detail = tm.resolve_example_stdin(
            self.sol, "nums = [1]", "6", 5.0, llm=llm)
        self.assertIsNone(stdin)
        self.assertIn("error", detail)

    def test_strips_markdown_fences_from_the_proposal(self):
        tm._run_reference_on_input = lambda path, stdin, timeout: ("6", "ok")
        llm = FakeLLM("```\n3\n1 2 3\n```")
        stdin, _, _ = tm.resolve_example_stdin(
            self.sol, "nums = [1, 2, 3]", "6", 5.0, llm=llm)
        self.assertEqual(stdin, "3\n1 2 3\n")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_io_contract_llm -v`
Expected: FAIL with `AttributeError: module 'testcase_manager_v4' has no attribute 'resolve_example_stdin'`

- [ ] **Step 3: Write the implementation**

In `pipeline/Scripts/testcase_manager_v4.py`, replace `_resolve_named_var_example` with:

```python
_IO_LAYOUT_SYSTEM = (
    "You convert a problem statement's worked Example into the RAW STDIN the given "
    "reference solution reads. The solution's own parser is the source of truth — read "
    "how it consumes stdin and produce the exact byte layout it expects (usually a "
    "size/count line, then space-separated data line(s); a bracketed level-order line "
    "for tree/linked-list inputs). "
    "Return ONLY the stdin text. No explanation, no markdown fences, no `name = value` "
    "assignments. End with a trailing newline."
)


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        nl = t.find("\n")
        t = t[nl + 1:] if nl != -1 else t[3:]
    if t.rstrip().endswith("```"):
        t = t.rstrip()[:-3]
    t = t.strip("\n")
    return t + "\n" if t else ""


def resolve_example_stdin(optimal_path, block, expected, timeout, llm=None):
    """Convert one display-form example block into the raw stdin the reference reads.

    The model reads the solution's actual parser and proposes ONE layout; we run it and
    accept only if the reference reproduces the stated answer. A mismatch buys exactly
    one INFORMED retry — the model sees its own layout, what it printed, and what was
    expected, which beats a second blind guess.

    Returns (stdin, reference_stdout, detail); stdin is None when unresolved.
    """
    from benchmark_suite import display_value_tokens

    if llm is None:
        llm = call_llm
    try:
        with open(optimal_path, "r", encoding="utf-8") as f:
            solution = f.read()
    except OSError as e:
        return None, None, f"could not read the reference solution ({e})"

    want = display_value_tokens(expected)
    user = (
        f"REFERENCE SOLUTION (its stdin parser is the source of truth):\n\n"
        f"```python\n{solution}\n```\n\n"
        f"EXAMPLE from the problem statement:\n{block}\n\n"
        f"Its stated answer is: {expected}\n\n"
        f"Return the raw stdin that makes this solution print that answer."
    )
    tried = []
    for attempt in (1, 2):
        try:
            content, usage = llm(_IO_LAYOUT_SYSTEM, user, purpose="io_contract_layout")
        except Exception as e:
            return None, None, f"LLM call failed ({e})"
        if usage:
            update_usage(
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                "io_contract_layout", model=usage.get("model", "unknown"),
                purpose="testcases", step_id="generate_testcases",
                cost=usage.get("cost", 0.0),
            )
        candidate = _strip_fences(content)
        got, status = _run_reference_on_input(optimal_path, candidate, timeout)
        if status != "ok":
            tried.append(f"{candidate!r} -> <{status}>")
        else:
            got = _normalize_output(got)
            if display_value_tokens(got) == want:
                return candidate, got, None
            tried.append(f"{candidate!r} -> {got[:60]!r}")
        if attempt == 1:
            shown = got if status == "ok" else f"<{status}>"
            user += (
                f"\n\nYour layout {candidate!r} was WRONG. The solution printed "
                f"{shown!r} but the stated answer is {expected!r}. "
                f"Re-read the parser and return a corrected stdin."
            )
    return None, None, "; ".join(tried)
```

Then in `verify_io_contract`, change the call site from
`_resolve_named_var_example(optimal_path, block, out, timeout)` to
`resolve_example_stdin(optimal_path, block, out, timeout)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_io_contract_llm -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS. `test_named_var_examples.py` tests the deleted heuristic — delete that file if it fails. `test_io_contract.py` tests `verify_io_contract` itself and should still pass; if it stubs `_resolve_named_var_example`, repoint the stub at `resolve_example_stdin`.

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(testcases): resolve example stdin with a model that reads the parser"
```

---

### Task 5: Derive step replaces the repair step

**Files:**
- Modify: `pipeline/Scripts/testcase_manager_v4.py` — delete `_size_fix_rounds` (587-600), `_print_size_audit` (603-607), `_reformat_and_audit` (610-659), `_regenerate_for_size` (662-719); rewrite `main()` steps 4, 5 and 9
- Test: `pipeline/Scripts/tests/test_derive_and_normalize.py` (create)
- Delete: `pipeline/Scripts/tests/test_size_fix_rounds.py`

**Interfaces:**
- Consumes: `derive_subtasks(cases, kind, max_n)` from Task 1; the new `get_testcases_prompt` signature from Task 3; `dedup_by_input(cases)` from `testcase_selection`.
- Produces: `derive_and_normalize(out_path, description, io_contract=None) -> dict` returning `{"kept": int, "duplicates": int, "buckets": {str: int}, "subtask_names": {str: str}, "examples_synced": int}`. Task 8 formats it into the log.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_derive_and_normalize.py`:

```python
"""The derive step computes what we never asked the model for.

It replaced a repair step that overrode the model's own claims. Dedup lives here now —
the selector used to do it and the selector is gone.
"""

import json
import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

import testcase_manager_v4 as tm  # noqa: E402

DESCRIPTION = "Sum an array.\n\nConstraints\n1 <= n <= 100000\n"


def write_suite(cases, space_mode="sampled"):
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    root = [{"test_cases": cases,
             "size_model": {"kind": "count", "max_n": 100000},
             "space_mode": space_mode}]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(root, f)
    return path


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)[0]


def case(subtask, n):
    return {"input": f"{n}\n" + " ".join("1" for _ in range(max(n, 1))) + "\n",
            "output": "1", "subtask": subtask, "scenario": subtask, "is_edge": n <= 1}


class TestDeriveAndNormalize(unittest.TestCase):
    def test_removes_exact_input_duplicates(self):
        path = write_suite([case("a", 5), case("a", 5), case("b", 10)])
        report = tm.derive_and_normalize(path, DESCRIPTION)
        self.assertEqual(report["duplicates"], 1)
        self.assertEqual(len(load(path)["test_cases"]), 2)
        os.unlink(path)

    def test_assigns_size_tags_and_subtask_tags(self):
        path = write_suite([case("tiny", 1), case("huge", 100000)])
        tm.derive_and_normalize(path, DESCRIPTION)
        for tc in load(path)["test_cases"]:
            self.assertTrue(any(t.startswith("size_") for t in tc["tags"]))
            self.assertTrue(any(t.startswith("subtask_") for t in tc["tags"]))
        os.unlink(path)

    def test_renumbers_order_contiguously_from_one(self):
        path = write_suite([case("a", 5), case("b", 10), case("c", 20)])
        tm.derive_and_normalize(path, DESCRIPTION)
        orders = [tc["order"] for tc in load(path)["test_cases"]]
        self.assertEqual(orders, [1, 2, 3])
        os.unlink(path)

    def test_every_case_ends_with_a_positive_weight(self):
        path = write_suite([case("a", 5), case("b", 100000)])
        tm.derive_and_normalize(path, DESCRIPTION)
        for tc in load(path)["test_cases"]:
            self.assertGreater(float(tc["weightage"]), 0)
        os.unlink(path)

    def test_writes_the_subtask_names_map_to_the_root(self):
        path = write_suite([case("empty_and_singleton", 1)])
        tm.derive_and_normalize(path, DESCRIPTION)
        names = load(path)["subtask_names"]
        self.assertEqual(names["subtask_1"], "Empty And Singleton")
        os.unlink(path)

    def test_exhaustive_space_stamps_suite_complete(self):
        path = write_suite([case("a", 1), case("b", 2)], space_mode="exhaustive")
        tm.derive_and_normalize(path, DESCRIPTION)
        self.assertTrue(load(path)["suite_complete"])
        os.unlink(path)

    def test_sampled_space_does_not_stamp_suite_complete(self):
        path = write_suite([case("a", 1)], space_mode="sampled")
        tm.derive_and_normalize(path, DESCRIPTION)
        self.assertFalse(load(path).get("suite_complete", False))
        os.unlink(path)

    def test_drops_cases_with_no_input(self):
        path = write_suite([case("a", 5), {"input": "  ", "output": "1", "subtask": "b"}])
        report = tm.derive_and_normalize(path, DESCRIPTION)
        self.assertEqual(report["kept"], 1)
        os.unlink(path)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_derive_and_normalize -v`
Expected: FAIL with `AttributeError: module 'testcase_manager_v4' has no attribute 'derive_and_normalize'`

- [ ] **Step 3: Write the implementation**

In `testcase_manager_v4.py`, delete `_size_fix_rounds`, `_print_size_audit`, `_regenerate_for_size` and `_reformat_and_audit`, and add:

```python
def derive_and_normalize(out_path: str, description: str, io_contract=None) -> dict:
    """Compute everything the model was never asked for, deterministically.

    dedup -> size tags -> semantic subtask numbering + weights -> order -> example sync.
    Dedup lives here because the selector used to do it and the selector is gone.
    """
    from testcase_helpers import (
        bucket_for_case, case_size_metric, dedupe_tags, derive_subtasks,
        resolve_size_context,
    )
    from testcase_selection import dedup_by_input

    with open(out_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    root = data[0] if isinstance(data, list) and data else data
    cases = [tc for tc in (root.get("test_cases") or []) if isinstance(tc, dict)]

    before = len(cases)
    cases = [tc for tc in cases if str(tc.get("input") or "").strip()]
    unique, _ = dedup_by_input(cases)
    duplicates = before - len(unique)

    kind, max_n = resolve_size_context(root, description, unique)

    buckets: dict = {}
    for tc in unique:
        bucket = bucket_for_case(tc, max_n, kind)
        buckets[bucket] = buckets.get(bucket, 0) + 1
        tc["tags"] = dedupe_tags(
            [t for t in (tc.get("tags") or []) if not str(t).startswith("size_")]
            + [f"size_{bucket}"]
        )
        if tc.get("size_metric") is None:
            tc["size_metric"] = case_size_metric(tc, kind, max_n) or 0

    subtask_names = derive_subtasks(unique, kind, max_n)

    for idx, tc in enumerate(unique, start=1):
        tc["order"] = idx

    examples_fixed = sync_example_testcases(unique, description, io_contract) if unique else 0

    root["test_cases"] = unique
    root["subtask_names"] = subtask_names
    if str(root.get("space_mode") or "").strip().lower() == "exhaustive":
        root["suite_complete"] = True
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

    io_shape = format_io_shape(audit_io_shape(unique, description)) if unique else ""
    if io_shape:
        print(f"WARNING: {io_shape}")

    return {"kept": len(unique), "duplicates": duplicates, "buckets": buckets,
            "subtask_names": subtask_names, "examples_synced": examples_fixed}
```

`dedup_by_input(cases)` returns `(unique, dropped)`; verify that signature in `testcase_selection.py` and adjust the unpacking if it differs.

Update the module imports in `testcase_manager_v4.py`: drop `audit_size_distribution`, `detect_problem_type`, `format_compliance`, `has_subtask_tags`, `reorder_testcases_json_root`, `repair_suite_json_root`, `sync_size_tags_json_root`, `sync_subtask_tags` from the `testcase_helpers` import; drop `MAX_CASES_PER_SUBTASK` and `get_size_fix_prompt` from the `Prompts` import.

In `main()`: delete the `--type` argparse option, the `problem_type` detection and its log line, the whole size-audit / size-fix `while` loop in step 9, and the `total_score` computation that fed the prompt. Keep the `PIPELINE_OWNER_SCORE` and `resolve_pipeline_difficulty()` reads — difficulty still routes the model and picks the count band. Call `derive_and_normalize(out_path, description, io_contract)` where `_reformat_and_audit` was called, and call `get_testcases_prompt` with the Task 3 signature.

Delete `pipeline/Scripts/tests/test_size_fix_rounds.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_derive_and_normalize -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS. `test_repair_suite.py` and `test_size_tags_per_problem.py` test replaced behaviour — repoint them at `derive_and_normalize`, or delete them if they only assert deleted functions. `test_weight_invariants.py` must still pass: every case ends with `weightage > 0`.

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(testcases): derive step replaces the repair-and-resize step"
```

---

### Task 6: Remove the selector; annotation validates without trimming

**Files:**
- Modify: `pipeline/Scripts/testcase_selection.py` — delete `select_suite`, `guarantee_pass`, `_fill_pass`, `fill_target`, `format_funnel`, `CASE_CAP`, `CASE_FLOOR`, `TARGET_BY_DIFFICULTY`, `DEFAULT_DIFFICULTY`
- Modify: `pipeline/Scripts/testcase_annotate.py` — `run_annotation` (355-550); delete `write_selected`
- Test: `pipeline/Scripts/tests/test_testcase_annotate.py` (append), `pipeline/Scripts/tests/test_testcase_selection.py` (trim)

**Interfaces:**
- Consumes: the on-disk suite produced by Task 5 (already deduped, tagged, ordered).
- Produces: `count_dead_cases(cases) -> int`; `run_annotation(outputs_dir="Outputs") -> dict` returning `{"total": int, "kills_covered": int, "kills_total": int, "uncatchable": [str], "dead_cases": int, "tle_verified": int}`. Task 8 formats it.

- [ ] **Step 1: Write the failing test**

Append to `pipeline/Scripts/tests/test_testcase_annotate.py` (reuse whatever import preamble that file already has; add `count_dead_cases` to its `from testcase_annotate import ...`):

```python
class TestAnnotationDoesNotTrim(unittest.TestCase):
    def test_counts_cases_that_killed_nothing(self):
        """The selector's signal without the selector's authority."""
        cases = [
            {"id": 0, "kills": {"a.py"}, "input": "1\n", "output": "1"},
            {"id": 1, "kills": set(), "input": "2\n", "output": "1"},
            {"id": 2, "kills": set(), "input": "3\n", "output": "1"},
        ]
        self.assertEqual(count_dead_cases(cases), 2)

    def test_all_cases_dead_is_reported_not_crashed(self):
        cases = [{"id": 0, "kills": set(), "input": "1\n", "output": "1"}]
        self.assertEqual(count_dead_cases(cases), 1)

    def test_no_cases_is_zero(self):
        self.assertEqual(count_dead_cases([]), 0)

    def test_selector_entry_points_are_gone(self):
        """The suite ships as generated; nothing may trim it."""
        import testcase_selection as ts
        for name in ("select_suite", "guarantee_pass", "fill_target", "format_funnel",
                     "CASE_CAP", "CASE_FLOOR"):
            self.assertFalse(hasattr(ts, name), f"{name} should have been deleted")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_testcase_annotate -v`
Expected: FAIL with `ImportError: cannot import name 'count_dead_cases'`

- [ ] **Step 3: Write the implementation**

In `testcase_annotate.py` add:

```python
def count_dead_cases(cases: list) -> int:
    """Cases that killed no wrong solution. Informational — nothing acts on it.

    With no selector, a suite of 200 cases all walking the same easy path still ships.
    This number is what makes that visible in the log.
    """
    return sum(1 for c in cases if not (c.get("kills") or set()))
```

Rewrite `run_annotation` to:
- take only `outputs_dir="Outputs"` (delete the `cap`, `floor`, `difficulty`, `count` parameters and the `_resolve_difficulty` call that served them),
- load `Outputs/testcases.json` directly — delete the `testcases_pool.json` snapshot, the `already_selected` check and the `shutil` import if now unused,
- run `annotate_kills` and `annotate_tle` exactly as today,
- **write nothing back to disk** — delete the `select_suite` and `write_selected` calls and the `write_selected` function itself,
- return the dict named in **Interfaces** above.

Update the `if __name__ == "__main__":` argparse block to drop `--cap`, `--floor`, `--difficulty` and `--count`.

In `testcase_selection.py`, delete the functions and constants listed under **Files**. Keep `bucket_size`, `bucket_case`, `dedup_by_input`, `normalize_input_for_dedup`, `SMALL_FRAC`, `LARGE_FRAC`. Remove now-unused imports.

In `tests/test_testcase_selection.py`, delete every test that exercises a removed function; keep the bucketing and dedup tests.

If `src/lib/pipeline-config.ts:337` passes a count argument to this script for `select_testcases`, remove that argument so the CLI call still parses.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:json`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A pipeline/Scripts src/lib/pipeline-config.ts
git commit -m "feat(testcases): remove the selector; annotation validates without trimming"
```

---

### Task 7: B2 becomes the blocking gate

**Files:**
- Modify: `pipeline/Scripts/benchmark_suite.py` — `run_wrong_approach_gate` (698-745), its call in `run_benchmark` (~1457)
- Modify: `pipeline/Scripts/testcase_annotate.py` — the benchmark call at the end of `run_annotation`
- Test: `pipeline/Scripts/tests/test_b2_gate.py` (create)

**Interfaces:**
- Consumes: `is_open_ended_problem(description)` (already at `benchmark_suite.py:1346`).
- Produces: `suite_is_float_valued(test_cases) -> bool`; `run_wrong_approach_gate(test_cases, wrong_dir=None, timeout=..., progress=False, description=None)` now returns `{"skipped", "missing", "cannot_judge", "reason", "wrong_files", "failures", "hard_fail"}`.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_b2_gate.py`:

```python
"""B2 is the only blocking gate now, so it must never silently no-op.

A skipped B2 used to be harmless because the selector was still filtering. It is not
harmless any more: it means zero quality control on a suite that reports success.
"""

import os
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

from benchmark_suite import run_wrong_approach_gate, suite_is_float_valued  # noqa: E402


class TestFloatDetection(unittest.TestCase):
    def test_decimal_outputs_are_float_valued(self):
        self.assertTrue(suite_is_float_valued([{"output": "3.14159"}]))

    def test_integer_outputs_are_not_float_valued(self):
        self.assertFalse(suite_is_float_valued([{"output": "42"}, {"output": "7"}]))

    def test_non_numeric_outputs_are_not_float_valued(self):
        self.assertFalse(suite_is_float_valued([{"output": "YES"}]))

    def test_one_decimal_among_many_is_enough(self):
        self.assertTrue(suite_is_float_valued([{"output": "1"}, {"output": "2.5"}]))

    def test_a_dotted_non_number_is_not_float_valued(self):
        self.assertFalse(suite_is_float_valued([{"output": "a.b"}]))


class TestMissingWrongSolutionsBlocks(unittest.TestCase):
    def test_empty_directory_is_a_hard_fail_not_a_skip(self):
        with tempfile.TemporaryDirectory() as empty:
            result = run_wrong_approach_gate([{"input": "1\n", "output": "1"}],
                                             wrong_dir=empty)
        self.assertTrue(result["hard_fail"], "missing wrong solutions must block")
        self.assertTrue(result["missing"])

    def test_open_ended_problem_abstains_instead_of_passing(self):
        with tempfile.TemporaryDirectory() as empty:
            result = run_wrong_approach_gate(
                [{"input": "1\n", "output": "1"}], wrong_dir=empty,
                description="Return any valid arrangement of the letters.")
        self.assertTrue(result["cannot_judge"])
        self.assertFalse(result["hard_fail"], "abstention must not block")

    def test_float_suite_abstains_instead_of_passing(self):
        with tempfile.TemporaryDirectory() as empty:
            result = run_wrong_approach_gate(
                [{"input": "1\n", "output": "3.14159"}], wrong_dir=empty,
                description="Compute the average.")
        self.assertTrue(result["cannot_judge"])
        self.assertFalse(result["hard_fail"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_b2_gate -v`
Expected: FAIL with `ImportError: cannot import name 'suite_is_float_valued'`

- [ ] **Step 3: Write the implementation**

In `benchmark_suite.py` add:

```python
def suite_is_float_valued(test_cases: list) -> bool:
    """True when any stored output holds a decimal number.

    Output comparison is textual, so `3.14159` vs `3.141590` mismatches and a CORRECT
    solution reads as killed. Integers parse as floats too, hence the decimal-point
    requirement.
    """
    for tc in test_cases or []:
        for token in str(tc.get("output") or "").split():
            if "." not in token:
                continue
            try:
                float(token)
                return True
            except ValueError:
                continue
    return False
```

Change `run_wrong_approach_gate` to accept `description: str | None = None` and, before the glob:

```python
    cannot_judge_reason = ""
    if description and is_open_ended_problem(description):
        cannot_judge_reason = ("this problem accepts multiple valid outputs, so textual "
                               "comparison would misreport")
    elif suite_is_float_valued(test_cases):
        cannot_judge_reason = ("this suite has decimal outputs, so textual comparison "
                               "would misreport")
    if cannot_judge_reason:
        _log_warn(f"[B2] CANNOT JUDGE — {cannot_judge_reason}. Gate skipped (not a pass).")
        return {"skipped": True, "cannot_judge": True, "missing": False,
                "reason": cannot_judge_reason, "wrong_files": 0,
                "failures": [], "hard_fail": False}
```

and replace the empty-glob branch with:

```python
    if not paths:
        _log_fail("[B2] no wrong_solutions/*.py found. B2 is the only blocking quality "
                  "gate; without it the suite is unvalidated. "
                  "Run Generate Wrong Solutions first.")
        return {"skipped": False, "cannot_judge": False, "missing": True,
                "reason": "no wrong_solutions/*.py found", "wrong_files": 0,
                "failures": [], "hard_fail": True}
```

Add `"cannot_judge": False, "missing": False` to the normal return dict at the end of the function so callers can read the keys unconditionally.

Pass `description=description` from `run_benchmark`'s `run_wrong_approach_gate(...)` call.

In `testcase_annotate.run_annotation`, after `print_report(bench, DEFAULT_MIN_KILL, report_only=True)`:

```python
        if bench.b2.get("hard_fail"):
            log("ERROR: a known-wrong solution passes every test case. The suite does "
                "not discriminate it. Refusing to ship.")
            raise SystemExit(1)
```

The benchmark call is currently wrapped in `try/except Exception` — add `except SystemExit: raise` before it, or move the gate check outside the `try`, so the exit is not swallowed.

The `precomputed_b2` dict built in `run_annotation` must also carry `"cannot_judge": False, "missing": False` for the same reason.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_b2_gate -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(testcases): B2 blocks, including when it cannot run"
```

---

### Task 8: Rewrite the printed logs

**Files:**
- Modify: `pipeline/Scripts/testcase_manager_v4.py` — `main()` print statements
- Modify: `pipeline/Scripts/testcase_annotate.py` — `run_annotation` log lines
- Modify: `src/lib/pipeline-config.ts:72-82` — the `select_testcases` label and description

**Interfaces:**
- Consumes: the report dicts from Tasks 5 and 6.

- [ ] **Step 1: Rewrite the generation-step logs**

In `testcase_manager_v4.main()`, delete every stale line (see Step 4's grep for the exact list) and emit:

```python
    print("=== GENERATE TEST CASES ===")
    print(f"      difficulty={effective} ({source_label})  ·  target {count_label}  ·  "
          f"I/O: {'function (raw stdin)' if is_function else 'STDIN/STDOUT'}")
```

where `count_label` is `f"exactly {num_testcases}"` when the owner set a count, else `f"{lo}-{hi} cases"` from `COUNT_BAND_BY_DIFFICULTY`.

After `report = derive_and_normalize(out_path, description, io_contract)`:

```python
    print(f"Generated {report['kept'] + report['duplicates']} case(s).")
    print(f"Derived: {report['duplicates']} duplicate(s) removed · "
          f"{report['kept']} case(s) kept")
    print("      size buckets   " + " · ".join(
        f"{b} {report['buckets'].get(b, 0)}"
        for b in ("edge", "small", "medium", "large")))

    with open(out_path, "r", encoding="utf-8") as f:
        shipped_root = json.load(f)[0]
    shipped = shipped_root["test_cases"]

    names = report["subtask_names"]
    counts, weights = {}, {}
    for tc in shipped:
        for t in tc.get("tags") or []:
            if str(t).startswith("subtask_"):
                counts[t] = counts.get(t, 0) + 1
                weights[t] = tc.get("weightage")
    print(f"      subtasks ({len(names)}, ordered by demand):")
    for enum in sorted(names, key=lambda e: int(e.rsplit("_", 1)[1])):
        print(f"        {enum:<12} {names[enum]:<28} {counts.get(enum, 0):>3} cases   "
              f"weight {weights.get(enum)}")

    if report["examples_synced"]:
        print(f"      {report['examples_synced']} public example case(s) synced "
              f"from the description")
    if shipped_root.get("suite_complete"):
        print(f"      space=exhaustive — the whole legal input space is "
              f"{report['kept']} case(s); shipped complete")
```

- [ ] **Step 2: Rewrite the validation-step logs**

In `testcase_annotate.run_annotation`, replace the `=== SELECT TEST CASES ===` banner, the bounds line and the `[N/4]` lines with:

```python
    log("=== VALIDATE TEST CASES (no trimming — the generated suite ships) ===")
    log(f"[1/3] Loaded {len(cases)} case(s)  ·  size_model={size_kind} (max_n={max_n})  "
        f"·  space={space_mode}")
    log(f"      oracles: reference={'present' if reference else 'MISSING'}  ·  "
        f"brute-force={'present' if brute else 'absent'}  ·  "
        f"wrong-solutions={len(wrong)}")
```

after kill scoring:

```python
    dead = count_dead_cases(cases)
    log(f"[2/3] Scoring kills: ran {len(wrong)} wrong solution(s) over {len(cases)} case(s)")
    log(f"      · wrong sols caught   {len(wrong_ids)}/{len(wrong)}")
    log(f"      · cases that killed nothing   {dead} of {len(cases)}")
```

and after TLE:

```python
    log(f"[3/3] Brute-force TLE (limit {tle_limit:g}s; a timeout = verified TLE)")
    log(f"      · verified brute TLE  {tle_n}")
```

Delete the `format_funnel` call and every `Selected N of M` / `Wrote N case(s)` line.

- [ ] **Step 3: Update the step description**

In `src/lib/pipeline-config.ts`, change the `select_testcases` entry's `label` to `"Validate Test Cases"` and its `description` to:

```
"Runs every wrong solution over the suite to confirm each is caught, times the brute force to verify TLE on large cases, and benchmarks suite strength (injected bugs, coverage, fuzz). Does not add, remove, or reorder cases — the generated suite ships as-is. A wrong solution that passes every case fails this step."
```

Leave the step `id` as `select_testcases` — it is a stored key in `pipelineStates.stepConfigs` and renaming it would orphan existing rows.

- [ ] **Step 4: Verify no stale log text survives**

Run:
```bash
cd pipeline/Scripts && grep -rn "Over-generate\|candidate POOL\|SELECT TEST CASES\|Contract auto-repaired\|for count scaling\|Realized size distribution\|Size distribution\|Assigned subtask tags\|Reordered cases\|Moved testcases.json" *.py
```
Expected: no matches.

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/Scripts src/lib/pipeline-config.ts
git commit -m "feat(testcases): rewrite step logs for the derive-and-validate flow"
```

---

### Task 9: Show the semantic subtask name on the platform

**Files:**
- Modify: `pipeline/Scripts/prepare_platform_json.py` — `normalize_tags` (488-516) and its call sites in `exam_parse_test_cases` (~520) and the practice path
- Test: `pipeline/Scripts/tests/test_prepare_platform_json.py` (append)

**Interfaces:**
- Consumes: the root-level `subtask_names` map written by Task 5.
- Produces: `normalize_tags(tc, subtask_names=None)` — when the map holds an entry for a
  tag's enum, that entry becomes the `display_name`.

Without this task the whole semantic-subtask change is invisible to users: the platform
would still render `subtask_5` as "Subtask 5" via `_tag_display_name`.

- [ ] **Step 1: Write the failing test**

Append to `pipeline/Scripts/tests/test_prepare_platform_json.py` (reuse that file's existing import preamble; add `normalize_tags` to its imports):

```python
class TestSubtaskDisplayNames(unittest.TestCase):
    def test_semantic_name_wins_over_the_generated_label(self):
        tc = {"tags": ["subtask_5", "stress"]}
        out = normalize_tags(tc, {"subtask_5": "Max Constraint Performance"})
        by_enum = {t["name_enum"]: t["display_name"] for t in out}
        self.assertEqual(by_enum["subtask_5"], "Max Constraint Performance")

    def test_non_subtask_tags_keep_the_generated_label(self):
        tc = {"tags": ["subtask_1", "stress"]}
        out = normalize_tags(tc, {"subtask_1": "Empty And Singleton"})
        by_enum = {t["name_enum"]: t["display_name"] for t in out}
        self.assertEqual(by_enum["stress"], "Stress")

    def test_missing_map_falls_back_to_the_generated_label(self):
        tc = {"tags": ["subtask_2"]}
        out = normalize_tags(tc, None)
        self.assertEqual(out[0]["display_name"], "Subtask 2")

    def test_enum_absent_from_the_map_falls_back(self):
        tc = {"tags": ["subtask_9"]}
        out = normalize_tags(tc, {"subtask_1": "Something Else"})
        self.assertEqual(out[0]["display_name"], "Subtask 9")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_prepare_platform_json -v`
Expected: FAIL with `TypeError: normalize_tags() takes 1 positional argument but 2 were given`

- [ ] **Step 3: Write the implementation**

In `prepare_platform_json.py`, change the signature to
`def normalize_tags(tc, subtask_names=None):` and, inside the loop where `display` is
resolved, replace the fallback with:

```python
        if not display and subtask_names:
            display = subtask_names.get(name, "")
        out.append({"name_enum": name, "display_name": display or _tag_display_name(name)})
```

Read the map once where the container is loaded and thread it through:

```python
    subtask_names = container.get("subtask_names") or {}
```

then pass `subtask_names=subtask_names` at every `normalize_tags(tc)` call site (there is
one in `exam_parse_test_cases` and one in the practice path — grep for `normalize_tags(`
to confirm you caught them all).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && PYTHONPATH=. python3 -m unittest tests.test_prepare_platform_json -v`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:json`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/Scripts
git commit -m "feat(platform): show the semantic subtask name instead of Subtask N"
```

---

## Execution Order

```
Task 1 ──┐
Task 2 ──┼──► Task 5 ──► Task 6 ──► Task 7 ──► Task 8 ──► Task 9
Task 3 ──┤
Task 4 ──┘
```

Tasks 1–4 are independent and may run in parallel. Task 5 needs 1, 2 and 3 (it calls
`derive_subtasks` and the new `get_testcases_prompt` signature). Tasks 6, 7 and 8 are
sequential — 6 removes the selector, 7 gates on what 6 reports, 8 narrates both.

**Parallel-execution note:** Tasks 2 and 3 both edit `Prompts/testcasesprompt_v4.py`, and
Tasks 4 and 5 both edit `testcase_manager_v4.py`. Run 2 before 3, and 4 before 5, or run
each pair in the same agent. Do not run 2 and 3 concurrently in separate worktrees.
