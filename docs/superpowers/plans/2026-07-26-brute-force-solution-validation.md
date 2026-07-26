# Brute-Force Solution Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an advisory SLM-driven validation pass to the `generate_brute_force` step that extracts small executable examples from the description and judges optimal/brute quality before test-case generation.

**Architecture:** A new `validate_solutions` LLM purpose (gemini-3.5-flash) drives one `call_llm` per run via a new prompt; a new `validate_solutions.py` module makes the call, tolerantly parses JSON, and executes the extracted examples against the optimal/brute using existing `benchmark_suite` runners; `generate_brute_force.main()` calls it at the end, merges results into `Outputs/optimal_brute_check.json`, and prints an advisory report. Nothing blocks.

**Tech Stack:** Python 3 (pipeline), `unittest` (no pytest in this repo), OpenRouter via `llm_client.call_llm`.

## Global Constraints

- Advisory only — the new validation NEVER exits non-zero and NEVER blocks test-case generation. (Only the pre-existing `BRUTE_MISMATCH_FATAL` path may exit; unchanged.)
- SLM extracted examples are validation-only — NEVER injected into the generated test-case suite.
- SLM model: `google/gemini-3.5-flash` (constant `_GEMINI_FLASH` in `llm_client.py`), env-overridable.
- One `call_llm(purpose="validate_solutions")` per `generate_brute_force` run.
- Reuse `benchmark_suite` runners (`run_solutions_batch`, `normalize`, `is_open_ended_problem`); honor `BENCHMARK_USE_COMPILER` transparently through them.
- No frontend, DB, or step-ordering changes.
- Preserve LLM usage tracking (`update_usage`).
- Tests use a fake `call_llm` / fake batch runner — no live LLM, no live compiler.
- Run tests with: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest <module> -v` (run from `pipeline/Scripts`; test files add `../` to `sys.path`).

## File Structure

- **Create** `pipeline/Scripts/Prompts/validatesolutionsprompt.py` — the extraction+judge prompt builder. One responsibility: build `(system, user)`.
- **Create** `pipeline/Scripts/validate_solutions.py` — SLM call + tolerant JSON parse (`validate_solutions_llm`) and example execution (`validate_examples`). One responsibility: produce and check validation data.
- **Create** `pipeline/Scripts/tests/test_validate_solutions.py` — unit tests for both functions with fakes.
- **Modify** `pipeline/Scripts/llm_client.py` — register the `validate_solutions` purpose in the routing tables.
- **Modify** `pipeline/Scripts/generate_brute_force.py` — call the validator at the end of `main()`, merge into the marker, print the report.

---

### Task 1: Register the `validate_solutions` LLM purpose

**Files:**
- Modify: `pipeline/Scripts/llm_client.py` (`_PURPOSE_DEFAULTS` ~79, `_PURPOSE_CONFIG` ~92, `_ENV_SUFFIX` ~163, `_DEFAULT_MAX_TOKENS` ~199)
- Test: `pipeline/Scripts/tests/test_validate_solutions.py`

**Interfaces:**
- Produces: purpose string `"validate_solutions"` resolvable by `_resolve_model` → `"google/gemini-3.5-flash"` and by `_resolve_reasoning_effort` → `"low"` when env unset.

- [ ] **Step 1: Write the failing test**

Create `pipeline/Scripts/tests/test_validate_solutions.py`:

```python
"""Unit tests for the validate_solutions purpose + module (advisory SLM validation)."""

import os
import sys
import unittest

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)


class TestValidateSolutionsRouting(unittest.TestCase):
    def setUp(self):
        # Ensure no env override leaks in from the shell.
        for k in ("OPENROUTER_MODEL_VALIDATE_SOLUTIONS", "OPENAI_REASONING_EFFORT_VALIDATE_SOLUTIONS"):
            os.environ.pop(k, None)

    def test_purpose_routes_to_gemini_flash_low(self):
        import llm_client as lc
        self.assertEqual(lc._resolve_model("validate_solutions"), "google/gemini-3.5-flash")
        self.assertEqual(lc._resolve_reasoning_effort("validate_solutions"), "low")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions -v` (from `pipeline/Scripts`)
Expected: FAIL — `_resolve_model("validate_solutions")` falls back to a default that is not gemini-flash (purpose unknown).

- [ ] **Step 3: Add the purpose to all four routing tables**

In `pipeline/Scripts/llm_client.py`:

`_PURPOSE_DEFAULTS` — add:
```python
    "validate_solutions": _GEMINI_FLASH,
```

`_PURPOSE_CONFIG` — add:
```python
    "validate_solutions": {
        "default_effort": "low",
        "fallbacks": [
            {"model": _GPT_54, "effort": "low"},
        ],
    },
```

`_ENV_SUFFIX` — add:
```python
    "validate_solutions": "VALIDATE_SOLUTIONS",
```

`_DEFAULT_MAX_TOKENS` — add (small JSON output):
```python
    "validate_solutions": 8000,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/llm_client.py pipeline/Scripts/tests/test_validate_solutions.py
git commit -m "Add validate_solutions LLM purpose (gemini-3.5-flash)"
```

---

### Task 2: The extraction + quality-judge prompt

**Files:**
- Create: `pipeline/Scripts/Prompts/validatesolutionsprompt.py`
- Test: `pipeline/Scripts/tests/test_validate_solutions.py`

**Interfaces:**
- Produces: `get_validate_solutions_prompt(description: str, optimal_code: str, brute_code: str) -> tuple[str, str]` returning `(system_prompt, user_prompt)`.

- [ ] **Step 1: Write the failing test** (append this class to `test_validate_solutions.py`)

```python
class TestValidatePrompt(unittest.TestCase):
    def test_builder_returns_two_strings_with_inputs(self):
        from Prompts.validatesolutionsprompt import get_validate_solutions_prompt
        system, user = get_validate_solutions_prompt(
            "Add two numbers. Read n then n ints.", "OPTCODE_MARKER", "BRUTECODE_MARKER"
        )
        self.assertIsInstance(system, str)
        self.assertIsInstance(user, str)
        # The optimal + brute + description must reach the model.
        self.assertIn("OPTCODE_MARKER", user)
        self.assertIn("BRUTECODE_MARKER", user)
        self.assertIn("Add two numbers", user)
        # The system prompt must mandate strict JSON, the format-inference job,
        # and the expected_output field.
        for token in ("STRICT JSON", "expected_output", "input format", "examples"):
            self.assertIn(token, system)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions.TestValidatePrompt -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'Prompts.validatesolutionsprompt'`.

- [ ] **Step 3: Create the prompt builder**

Create `pipeline/Scripts/Prompts/validatesolutionsprompt.py`:

```python
"""Prompt for the advisory solution-validation SLM pass (validate_solutions purpose).

One call: read the description + optimal + brute, emit small executable examples
in the optimal's stdin format, and judge both solutions. STRICT JSON output.
"""


def get_validate_solutions_prompt(description: str, optimal_code: str, brute_code: str):
    system = (
        "You validate competitive-programming solutions. You are given a problem "
        "description, an OPTIMAL Python solution (reads stdin, writes stdout), and a "
        "BRUTE-FORCE Python solution. Do TWO things and return STRICT JSON only "
        "(no markdown fences, no prose outside the JSON).\n"
        "\n"
        "1) EXTRACT 5-8 SMALL, hand-verifiable test examples. INFER THE EXACT STDIN "
        "FORMAT the OPTIMAL solution parses by reading its input-handling code, and "
        "produce inputs in THAT exact format so the solution can parse them (the "
        "'input format' must be followed precisely — a size/count line then data "
        "lines, etc., exactly as the code reads). Cover degenerate/edge cases (min "
        "size, single element, all-equal, boundary values) plus a few typical small "
        "cases. Where the description gives worked examples, include them verbatim. "
        "For each case give the exact raw stdin as `input` (newline-terminated) and "
        "the exact stdout the CORRECT answer should print as `expected_output`.\n"
        "\n"
        "2) JUDGE code quality. For the optimal: is the approach correct for the "
        "problem, and is the input/output format honored (`input_format_ok`)? For the "
        "brute: is it correct AND a genuinely INDEPENDENT simpler method (not a copy "
        "of the optimal's algorithm) (`independent`)? List concrete `issues` (empty "
        "list if none).\n"
        "\n"
        "Output JSON shape EXACTLY:\n"
        "{\n"
        '  "examples": [{"input": "<raw stdin>", "expected_output": "<stdout>"}],\n'
        '  "optimal": {"ok": true, "input_format_ok": true, "issues": []},\n'
        '  "brute": {"ok": true, "independent": true, "issues": []}\n'
        "}"
    )
    user = (
        "### Problem Description\n"
        f"{description}\n\n"
        "### Optimal Python Solution\n"
        f"{optimal_code}\n\n"
        "### Brute-Force Python Solution\n"
        f"{brute_code}\n"
    )
    return system, user
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions.TestValidatePrompt -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/Prompts/validatesolutionsprompt.py pipeline/Scripts/tests/test_validate_solutions.py
git commit -m "Add validate_solutions extraction+judge prompt"
```

---

### Task 3: `validate_solutions_llm` — SLM call + tolerant JSON parse

**Files:**
- Create: `pipeline/Scripts/validate_solutions.py`
- Test: `pipeline/Scripts/tests/test_validate_solutions.py`

**Interfaces:**
- Consumes: `get_validate_solutions_prompt` (Task 2); `call_llm` (returns `(content, usage)`); `update_usage`.
- Produces:
  - `_parse_slm_json(content: str) -> dict | None`
  - `validate_solutions_llm(description: str, optimal_code: str, brute_code: str, *, _call=None, record_usage: bool = True) -> dict | None` — returns the parsed dict, or `None` on any failure. When `_call` is provided (tests), usage is NOT recorded.

- [ ] **Step 1: Write the failing test** (append)

```python
class TestValidateSolutionsLLM(unittest.TestCase):
    def _fake_call(self, content):
        def _c(system, user, purpose="chat", **kw):
            self.assertEqual(purpose, "validate_solutions")
            return content, {"prompt_tokens": 1, "completion_tokens": 1, "model": "fake", "cost": 0.0}
        return _c

    def test_clean_json_parses(self):
        from validate_solutions import validate_solutions_llm
        payload = '{"examples": [{"input": "1\\n", "expected_output": "1\\n"}], "optimal": {"ok": true, "input_format_ok": true, "issues": []}, "brute": {"ok": true, "independent": true, "issues": []}}'
        out = validate_solutions_llm("d", "o", "b", _call=self._fake_call(payload))
        self.assertEqual(len(out["examples"]), 1)
        self.assertTrue(out["optimal"]["ok"])

    def test_fenced_json_parses(self):
        from validate_solutions import validate_solutions_llm
        payload = '```json\n{"examples": [], "optimal": {"ok": true, "input_format_ok": true, "issues": []}, "brute": {"ok": true, "independent": true, "issues": []}}\n```'
        out = validate_solutions_llm("d", "o", "b", _call=self._fake_call(payload))
        self.assertEqual(out["examples"], [])

    def test_malformed_json_returns_none(self):
        from validate_solutions import validate_solutions_llm
        out = validate_solutions_llm("d", "o", "b", _call=self._fake_call("not json at all"))
        self.assertIsNone(out)

    def test_call_raises_returns_none(self):
        from validate_solutions import validate_solutions_llm
        def _boom(system, user, purpose="chat", **kw):
            raise RuntimeError("network")
        out = validate_solutions_llm("d", "o", "b", _call=_boom)
        self.assertIsNone(out)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions.TestValidateSolutionsLLM -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'validate_solutions'`.

- [ ] **Step 3: Create the module (call + parse)**

Create `pipeline/Scripts/validate_solutions.py`:

```python
"""Advisory SLM validation of the optimal + brute solutions.

One LLM call (validate_solutions purpose) extracts small executable examples in
the optimal's stdin format and judges both solutions; the examples are then run
against the optimal/brute to check input-format, ground-truth, and agreement.
Everything here is advisory — callers never fail on its output.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from llm_client import call_llm  # noqa: E402
from usage_tracker import update_usage  # noqa: E402
from Prompts.validatesolutionsprompt import get_validate_solutions_prompt  # noqa: E402


def _parse_slm_json(content: str) -> dict | None:
    """Parse the SLM's JSON, tolerating an accidental ```json fence. None on failure."""
    if not content or not content.strip():
        return None
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        stripped = text.rstrip()
        if stripped.endswith("```"):
            text = stripped[:-3]
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def validate_solutions_llm(description, optimal_code, brute_code, *, _call=None, record_usage=True):
    """Run the one SLM validation call. Returns the parsed dict or None on any failure.

    `_call` injects a fake call_llm in tests; when provided, usage is not recorded.
    """
    call = _call or call_llm
    system, user = get_validate_solutions_prompt(description, optimal_code, brute_code)
    try:
        content, usage = call(system, user, purpose="validate_solutions")
    except Exception:
        return None
    if record_usage and _call is None:
        try:
            update_usage(
                usage.get("prompt_tokens", 0),
                usage.get("completion_tokens", 0),
                "solution_validation",
                model=usage.get("model", "unknown"),
                purpose="validate_solutions",
                step_id="generate_brute_force",
                cost=usage.get("cost", 0.0),
            )
        except Exception:
            pass
    return _parse_slm_json(content)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions.TestValidateSolutionsLLM -v`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/validate_solutions.py pipeline/Scripts/tests/test_validate_solutions.py
git commit -m "Add validate_solutions_llm: SLM call + tolerant JSON parse"
```

---

### Task 4: `validate_examples` — execute examples against optimal/brute

**Files:**
- Modify: `pipeline/Scripts/validate_solutions.py`
- Test: `pipeline/Scripts/tests/test_validate_solutions.py`

**Interfaces:**
- Consumes: `benchmark_suite.run_solutions_batch` (returns `list[tuple[str, str]]` of `(stdout, status)` where status ∈ `ok|timeout|error`), `benchmark_suite.normalize`, `benchmark_suite.is_open_ended_problem`, `benchmark_suite.BENCHMARK_RUN_TIMEOUT`.
- Produces: `validate_examples(examples: list[dict], optimal_code: str, brute_code: str | None, description: str, *, _batch=None) -> dict` returning:
  ```python
  {"example_results": [
       {"input": str, "optimal_status": str, "input_format_ok": bool,
        "matches_expected": bool, "brute_agrees": bool}  # brute_agrees absent when no brute
   ],
   "optimal_ok": bool, "brute_ok": bool}
  ```
  `_batch(code, inputs) -> list[tuple[str,str]]` injects a fake runner in tests.

- [ ] **Step 1: Write the failing test** (append)

```python
class TestValidateExamples(unittest.TestCase):
    def test_flags_format_error_and_mismatch_and_brute_disagreement(self):
        from validate_solutions import validate_examples
        examples = [
            {"input": "1\n", "expected_output": "1\n"},   # ok, matches, brute agrees
            {"input": "bad\n", "expected_output": "9\n"},  # optimal errors -> format flag
            {"input": "2\n", "expected_output": "2\n"},    # optimal ok but wrong output
        ]

        def fake_batch(code, inputs):
            if code == "OPT":
                return [("1\n", "ok"), ("", "error"), ("5\n", "ok")]
            return [("1\n", "ok"), ("", "error"), ("2\n", "ok")]  # BRUTE disagrees on case 3

        res = validate_examples(examples, "OPT", "BRUTE", "Add numbers.", _batch=fake_batch)
        rows = res["example_results"]
        self.assertEqual(len(rows), 3)
        self.assertTrue(rows[0]["input_format_ok"] and rows[0]["matches_expected"] and rows[0]["brute_agrees"])
        self.assertFalse(rows[1]["input_format_ok"])          # optimal errored
        self.assertFalse(rows[2]["matches_expected"])         # 5 != 2
        self.assertFalse(rows[2]["brute_agrees"])             # brute 2 != optimal 5
        self.assertFalse(res["optimal_ok"])
        self.assertFalse(res["brute_ok"])

    def test_open_ended_never_fails_brute(self):
        from validate_solutions import validate_examples
        examples = [{"input": "1\n", "expected_output": "1\n"}]

        def fake_batch(code, inputs):
            return [("1\n", "ok")] if code == "OPT" else [("99\n", "ok")]

        res = validate_examples(examples, "OPT", "BRUTE", "Return any valid answer.", _batch=fake_batch)
        self.assertTrue(res["example_results"][0]["brute_agrees"])
        self.assertTrue(res["brute_ok"])

    def test_no_examples_is_ok(self):
        from validate_solutions import validate_examples
        res = validate_examples([], "OPT", "BRUTE", "d", _batch=lambda c, i: [])
        self.assertEqual(res["example_results"], [])
        self.assertTrue(res["optimal_ok"] and res["brute_ok"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions.TestValidateExamples -v`
Expected: FAIL — `AttributeError: module 'validate_solutions' has no attribute 'validate_examples'`.

- [ ] **Step 3: Add `validate_examples` to `validate_solutions.py`**

Append to `pipeline/Scripts/validate_solutions.py` (add the import near the top imports):

```python
from benchmark_suite import (  # noqa: E402
    run_solutions_batch,
    normalize,
    is_open_ended_problem,
    BENCHMARK_RUN_TIMEOUT,
)
```

```python
def validate_examples(examples, optimal_code, brute_code, description, *, _batch=None):
    """Run the SLM examples against the optimal (and brute). Advisory checks:
    input-format (optimal didn't error), ground-truth (optimal output == SLM
    expected), and optimal-vs-brute agreement (skipped for open-ended problems)."""
    runner = _batch or (lambda code, inputs: run_solutions_batch(code, inputs, BENCHMARK_RUN_TIMEOUT))
    inputs = [e.get("input", "") for e in examples]
    if not inputs:
        return {"example_results": [], "optimal_ok": True, "brute_ok": True}

    opt = runner(optimal_code, inputs)
    brute = runner(brute_code, inputs) if brute_code else [None] * len(inputs)
    open_ended = is_open_ended_problem(description or "")

    results = []
    optimal_ok = True
    brute_ok = True
    for e, o, b in zip(examples, opt, brute):
        out, status = o
        fmt_ok = status != "error"
        matches = status == "ok" and normalize(out) == normalize(e.get("expected_output", ""))
        if not fmt_ok or not matches:
            optimal_ok = False
        rec = {
            "input": e.get("input", ""),
            "optimal_status": status,
            "input_format_ok": fmt_ok,
            "matches_expected": matches,
        }
        if b is not None:
            bout, bstatus = b
            agrees = open_ended or (
                status == "ok" and bstatus == "ok" and normalize(bout) == normalize(out)
            )
            rec["brute_agrees"] = agrees
            if not agrees:
                brute_ok = False
        results.append(rec)
    return {"example_results": results, "optimal_ok": optimal_ok, "brute_ok": brute_ok}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions.TestValidateExamples -v`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/validate_solutions.py pipeline/Scripts/tests/test_validate_solutions.py
git commit -m "Add validate_examples: run SLM examples vs optimal/brute"
```

---

### Task 5: Wire into `generate_brute_force.main()` + merge marker + report

**Files:**
- Modify: `pipeline/Scripts/generate_brute_force.py` (add `_merge_slm_into_marker` + `_run_solution_validation` near `_write_crosscheck_marker` ~102; call after `_crosscheck_optimal_vs_brute(...)` ~314)
- Test: `pipeline/Scripts/tests/test_validate_solutions.py`

**Interfaces:**
- Consumes: `validate_solutions_llm`, `validate_examples` (Tasks 3-4); existing `_write_crosscheck_marker` marker file `Outputs/optimal_brute_check.json` = `{"status","reason","mismatches"}`.
- Produces: `_merge_slm_into_marker(slm_block: dict) -> None` (reads the marker, adds an `"slm"` key, rewrites); `_run_solution_validation(description, optimal_solution, brute_content) -> None` (orchestrates, non-fatal).

- [ ] **Step 1: Write the failing test** (append; exercises the merge helper in a temp cwd)

```python
class TestMergeMarker(unittest.TestCase):
    def test_merge_preserves_existing_keys_and_adds_slm(self):
        import json, tempfile
        import generate_brute_force as gbf
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as d:
            os.chdir(d)
            try:
                os.makedirs("Outputs", exist_ok=True)
                with open("Outputs/optimal_brute_check.json", "w", encoding="utf-8") as f:
                    json.dump({"status": "ok", "reason": "r", "mismatches": []}, f)
                gbf._merge_slm_into_marker({"examples_count": 2, "optimal": {"ok": True}})
                with open("Outputs/optimal_brute_check.json", encoding="utf-8") as f:
                    data = json.load(f)
                self.assertEqual(data["status"], "ok")          # preserved
                self.assertEqual(data["slm"]["examples_count"], 2)  # added
            finally:
                os.chdir(cwd)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions.TestMergeMarker -v`
Expected: FAIL — `AttributeError: module 'generate_brute_force' has no attribute '_merge_slm_into_marker'`.

- [ ] **Step 3: Add the merge helper + orchestration**

In `pipeline/Scripts/generate_brute_force.py`, after `_write_crosscheck_marker` (~line 114) add:

```python
def _merge_slm_into_marker(slm_block: dict) -> None:
    """Add the advisory SLM validation block to Outputs/optimal_brute_check.json,
    preserving the existing cross-check keys."""
    marker_path = os.path.join("Outputs", "optimal_brute_check.json")
    payload = {"status": "ok", "reason": "", "mismatches": []}
    if os.path.exists(marker_path):
        try:
            with open(marker_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, ValueError):
            pass
    payload["slm"] = slm_block
    try:
        os.makedirs("Outputs", exist_ok=True)
        with open(marker_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except OSError as e:
        print(f"(could not merge SLM validation into marker: {e})")


def _run_solution_validation(description: str, optimal_solution: str, brute_content: str) -> None:
    """Advisory: one SLM call extracts small examples + judges quality; run the
    examples against the optimal/brute; merge into the marker and print a report.
    NEVER raises to the caller — validation must not fail the step."""
    try:
        from validate_solutions import validate_solutions_llm, validate_examples
        print("\n=== SOLUTION VALIDATION (advisory) ===")
        slm = validate_solutions_llm(description, optimal_solution, brute_content)
        if not slm:
            print("⚠ SLM validation skipped (no/invalid response) — existing checks stand.")
            return
        examples = [
            e for e in (slm.get("examples") or [])
            if isinstance(e, dict) and e.get("input")
        ]
        exec_res = validate_examples(examples, optimal_solution, brute_content, description)
        optimal_v = slm.get("optimal") or {}
        brute_v = slm.get("brute") or {}
        _merge_slm_into_marker({
            "examples_count": len(examples),
            "optimal": optimal_v,
            "brute": brute_v,
            "example_results": exec_res["example_results"],
        })
        rows = exec_res["example_results"]
        fmt_fail = [r for r in rows if not r["input_format_ok"]]
        gt_fail = [r for r in rows if not r["matches_expected"]]
        print(f"· examples run       {len(examples)}")
        print("· input-format       " + ("✓ all parsed by optimal"
              if not fmt_fail else f"⚠ {len(fmt_fail)} input(s) the optimal could not parse"))
        print("· ground-truth       " + ("✓ optimal matches expected"
              if not gt_fail else f"⚠ {len(gt_fail)} case(s) optimal disagrees with expected"))
        if optimal_v.get("issues"):
            print(f"· optimal quality    ⚠ {'; '.join(optimal_v['issues'])}")
        if brute_v.get("issues"):
            print(f"· brute quality      ⚠ {'; '.join(brute_v['issues'])}")
        if not optimal_v.get("issues") and not brute_v.get("issues"):
            print("· code quality       ✓ no issues flagged")
    except Exception as e:
        print(f"⚠ solution validation (advisory) skipped — {type(e).__name__}: {e}")
```

- [ ] **Step 4: Call it at the end of `main()`**

In `main()`, immediately after `_crosscheck_optimal_vs_brute(description, optimal_solution, content)` (~line 314) add:

```python
        # 6. Advisory SLM validation: small in-format examples + optimal/brute
        #    quality. Never blocks — enriches optimal_brute_check.json + logs.
        _run_solution_validation(description, optimal_solution, content)
```

- [ ] **Step 5: Run the merge test + the full validate-solutions suite**

Run: `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest tests.test_validate_solutions -v`
Expected: PASS (all classes).

- [ ] **Step 6: Run the FULL Python suite (no regressions)**

Run (from repo root): `/Users/kakarlapavanteja/.codingautomation-venv/bin/python3 -m unittest discover -s pipeline/Scripts/tests -p "test_*.py"`
Expected: `OK` (previous 137 + the new tests).

- [ ] **Step 7: Commit**

```bash
git add pipeline/Scripts/generate_brute_force.py pipeline/Scripts/tests/test_validate_solutions.py
git commit -m "Wire advisory SLM validation into generate_brute_force"
```

---

## Self-Review

**Spec coverage:**
- Prompt (`validatesolutionsprompt.py`, format inference + strict JSON + expected_output) → Task 2. ✓
- Validator module returning None on failure → Task 3. ✓
- Execution validation (input-format / ground-truth / optimal-vs-brute, reuse benchmark_suite, honor compiler) → Task 4. ✓
- `validate_solutions` purpose = gemini-3.5-flash, env-overridable → Task 1. ✓
- Wiring into `generate_brute_force.main()` end + merge into `optimal_brute_check.json` + advisory report → Task 5. ✓
- Advisory only / never blocks → Tasks 3-5 (try/except, non-fatal). ✓
- Validation-only examples (not injected into suite) → confirmed: no task writes to `testcases.json`. ✓
- Usage tracking preserved → Task 3 `update_usage(... purpose="validate_solutions", step_id="generate_brute_force")`. ✓
- Tests with fakes, no live LLM/compiler → Tasks 1-5. ✓

**Type consistency:** `validate_solutions_llm` returns `dict | None`; `validate_examples` returns `{"example_results", "optimal_ok", "brute_ok"}`; `_merge_slm_into_marker(dict)`; runner tuples are `(stdout, status)` matching `run_solutions_batch`. Names consistent across Tasks 3-5. ✓

**Placeholder scan:** none — every code step has full code and exact run commands. ✓
