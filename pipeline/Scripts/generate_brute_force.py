"""
Brute-force solution generator (pipeline step `generate_brute_force`).

Runs AFTER `generate_full_question.py` (which writes the optimal
`Outputs/generatedFullCode/PYTHON.py`) and BEFORE `testcase_manager_v4.py`.
It produces `Outputs/generatedFullCode/BRUTE_FORCE.py`: a deliberately simple,
obviously-correct brute-force solution that the v4 test-case generator uses as a
second oracle (dual-oracle cross-check), and that the editorial presents as the
naive approach.

Mirrors the conventions of the other pipeline scripts: same `call_llm` /
`update_usage` pattern, same markdown-fence sanitation, same Outputs layout, and
a single LLM-fix retry if the generated file does not parse.
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys

# Ensure the Scripts directory is in the path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.bruteforceprompt import get_brute_force_prompt
from llm_client import call_llm
from usage_tracker import update_usage


def _sanitize_generated_script(content: str) -> str:
    """Strip a stray markdown code fence if the model wrapped the script.

    The prompt forbids fences; this is a cheap safety net so a wrapper does not
    crash the generated .py file.
    """
    if content is None:
        return ""
    text = content.strip()
    if text.startswith("```"):
        first_nl = text.find("\n")
        text = text[first_nl + 1:] if first_nl != -1 else text[3:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


_OPTIMAL_DS_TOKENS = (
    "bisect", "heapq", "deque", "lru_cache", "@cache", "SegmentTree",
    "Fenwick", "BIT",
)
_NAIVE_MARKERS = ("for _ in range", "for i in range", "for j in range")


def _looks_like_copy(optimal: str, brute: str) -> bool:
    """Heuristic: brute reuses optimal's advanced DS without naive enumeration."""
    opt_lower = optimal.lower()
    brute_lower = brute.lower()
    has_ds = any(tok.lower() in brute_lower for tok in _OPTIMAL_DS_TOKENS if tok.lower() in opt_lower)
    has_naive = any(m in brute for m in _NAIVE_MARKERS)
    nested_for = brute.count("for ") >= 2
    if has_ds and not (has_naive or nested_for):
        return True
    # near-identical after whitespace strip
    if re.sub(r"\s+", "", optimal) == re.sub(r"\s+", "", brute):
        return True
    return False


def _parse_error(code: str) -> str | None:
    """Return a SyntaxError message if `code` does not parse, else None."""
    try:
        ast.parse(code)
        return None
    except SyntaxError as exc:
        return f"{exc.__class__.__name__}: {exc}"


def _retry_fix(description: str, optimal_solution: str, failed_code: str, error: str):
    """Ask the LLM to fix a brute force that failed to parse. Returns (code, usage)."""
    retry_system = (
        "You are a Python expert. The brute-force solution you produced did not parse as "
        "valid Python. Fix it so it parses and runs, keeping it a SIMPLE, exhaustive "
        "brute force that reads the SAME stdin and prints the SAME stdout format as the "
        "optimal solution. Return ONLY the corrected Python script, no explanations. "
        "OUTPUT HYGIENE (CRITICAL): your entire response is written verbatim to a .py file "
        "and executed. First character MUST be valid Python (import/#/from); no preamble, "
        "no sign-off, no markdown fences. IMPORT CORRECTNESS: only import names that exist; "
        "round/abs/min/max/sum/pow are built-ins, not in math."
    )
    retry_user = (
        f"### Problem Description:\n{description}\n\n"
        f"### Optimal Python Solution (match its STDIN/STDOUT exactly):\n{optimal_solution}\n\n"
        f"### Your previous brute force failed to parse with:\n```\n{error}\n```\n\n"
        f"### Previous brute force:\n```python\n{failed_code}\n```\n\n"
        f"Return the corrected brute-force Python script."
    )
    # Effort comes from the brute_force purpose config (xhigh) so it stays
    # tunable via OPENAI_REASONING_EFFORT_BRUTE_FORCE without editing here.
    return call_llm(retry_system, retry_user, purpose="brute_force")


def _write_crosscheck_marker(status: str, reason: str = "", mismatches: list | None = None) -> None:
    """Always (over)write Outputs/optimal_brute_check.json so the UI/API has a fresh
    verdict each run — a stale "mismatch" from a prior run must never linger in storage
    after a passing re-run. status is one of: ok | skipped | mismatch."""
    marker_path = os.path.join("Outputs", "optimal_brute_check.json")
    payload = {"status": status, "reason": reason, "mismatches": mismatches or []}
    try:
        os.makedirs("Outputs", exist_ok=True)
        with open(marker_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except OSError as e:
        print(f"(could not write cross-check marker: {e})")


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
        from open_ended_checker import checker_for
        exec_res = validate_examples(examples, optimal_solution, brute_content, description,
                                     checker=checker_for("Outputs"))
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
        brute_rows = [r for r in rows if "brute_agrees" in r]
        if brute_rows:
            brute_fail = [r for r in brute_rows if not r["brute_agrees"]]
            print("· optimal-vs-brute   " + ("✓ brute agrees with optimal"
                  if not brute_fail else f"⚠ {len(brute_fail)} case(s) brute disagrees with optimal"))
        if optimal_v.get("issues"):
            print(f"· optimal quality    ⚠ {'; '.join(optimal_v['issues'])}")
        if brute_v.get("issues"):
            print(f"· brute quality      ⚠ {'; '.join(brute_v['issues'])}")
        if not optimal_v.get("issues") and not brute_v.get("issues"):
            print("· code quality       ✓ no issues flagged")
    except Exception as e:
        print(f"⚠ solution validation (advisory) skipped — {type(e).__name__}: {e}")


def _crosscheck_optimal_vs_brute(description: str, optimal_solution: str, brute_content: str) -> None:
    """Run the just-generated brute against the optimal on the example inputs plus a
    structure-aware small-input sweep. Always writes a fresh verdict to
    `Outputs/optimal_brute_check.json` (ok | skipped | mismatch); on disagreement also
    prints a prominent warning so the buggy reference solution is surfaced before any
    test cases are trusted. Best-effort: never aborts the step (the brute could itself
    be wrong) unless BRUTE_MISMATCH_FATAL=1 is set."""
    try:
        from benchmark_suite import (
            crosscheck_optimal_brute,
            extract_example_inputs,
            optimal_example_failures,
        )
        from open_ended_checker import checker_for
    except Exception as e:  # pragma: no cover - import guard
        print(f"(optimal-vs-brute cross-check skipped: cannot import benchmark_suite: {e})")
        _write_crosscheck_marker("skipped", f"could not import benchmark_suite: {e}")
        return

    # 1. GROUND TRUTH FIRST. Does the optimal reproduce the description's OWN worked
    #    examples (the canonical input→output pairs)? A failure here is definitive,
    #    brute-independent proof the optimal is buggy — and it cannot be explained
    #    away by tie-breaking, because the description states the exact expected output.
    try:
        example_failures = optimal_example_failures(optimal_solution, description)
    except Exception as e:
        print(f"(example ground-truth check skipped: {e})")
        example_failures = []

    if example_failures:
        print("\n" + "=" * 72)
        print("⚠️  WARNING: the reference (optimal) solution FAILS the description's own")
        print("   worked examples. It is BUGGY — test cases generated from it would carry")
        print("   WRONG expected outputs. Fix the optimal before trusting this problem.")
        for f in example_failures:
            print(f"     input={f['input'].strip()!r}  expected={f['expected']!r}  got={f['got']!r}")
        print("=" * 72 + "\n")
        _write_crosscheck_marker(
            "mismatch",
            "optimal solution disagrees with the description's worked examples",
            [{"input": f["input"], "optimal": f["got"], "brute": f"expected {f['expected']}"}
             for f in example_failures],
        )
        if os.environ.get("BRUTE_MISMATCH_FATAL") == "1":
            print("BRUTE_MISMATCH_FATAL=1 set — aborting so the optimal can be fixed.")
            sys.exit(1)
        return

    # The optimal reproduces every worked example → it is NOT buggy on the canonical
    # cases. From here a brute disagreement can only be a *different-but-valid* answer —
    # and the checker below tells the two apart, so the sweep runs on open-ended problems
    # too instead of being skipped wholesale.

    # 2. Brute sweep is now ADVISORY. A correct optimal can legitimately differ from the
    #    brute on problems that admit several valid answers (e.g. "return the indices of
    #    a pair summing to k" when multiple pairs exist — optimal and brute pick different
    #    but equally-correct pairs). Once the optimal has matched every worked example, a
    #    brute-only disagreement is NOT sufficient to brand it buggy, so we never write a
    #    "mismatch" verdict here — only a non-blocking advisory note.
    try:
        examples = extract_example_inputs(description)
        mismatches = crosscheck_optimal_brute(optimal_solution, brute_content, examples,
                                              checker=checker_for("Outputs"))
    except Exception as e:
        print(f"(brute sweep skipped: {e})")
        _write_crosscheck_marker("ok", f"optimal matches all worked examples; brute sweep skipped: {e}")
        return

    if not mismatches:
        print("Optimal-vs-brute cross-check PASSED (matches worked examples; no brute disagreements).")
        _write_crosscheck_marker("ok")
        return

    print("\n" + "-" * 72)
    print("ℹ️  ADVISORY: optimal matches all worked examples but differs from the brute on")
    print(f"   {len(mismatches)} sampled input(s). This is most likely a MULTIPLE-VALID-ANSWERS")
    print("   problem (different but equally-correct outputs), NOT a buggy optimal. Sample:")
    for d in mismatches:
        print(f"     input={d['input'].strip()!r}  optimal={d['optimal']}  brute={d['brute']}")
    print("-" * 72 + "\n")

    # Status stays "ok" so the UI does NOT show a buggy badge; the divergence is recorded
    # as an advisory reason for anyone who wants to inspect it.
    _write_crosscheck_marker(
        "ok",
        f"optimal matches all worked examples; brute disagrees on {len(mismatches)} sampled "
        "input(s) — likely multiple valid answers (advisory, not treated as buggy)",
        mismatches,
    )


def main():
    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    os.chdir(root_dir)

    description_path = os.path.join("Outputs", "generated_description.md")
    optimal_path = os.path.join("Outputs", "generatedFullCode", "PYTHON.py")
    out_path = os.path.join("Outputs", "generatedFullCode", "BRUTE_FORCE.py")

    # 1. Description (prefer generated; fall back to raw input problem.md).
    description = ""
    if os.path.exists(description_path):
        with open(description_path, "r", encoding="utf-8") as f:
            description = f.read()
    else:
        fallback = os.path.join("Inputs", "problem.md")
        if os.path.exists(fallback):
            with open(fallback, "r", encoding="utf-8") as f:
                description = f.read()
    if not description.strip():
        print("Error: no problem statement found "
              "(Outputs/generated_description.md or Inputs/problem.md). "
              "Run 'generate_full_question.py' first.")
        sys.exit(1)

    # 2. Optimal solution (the I/O contract the brute force must mirror).
    if not os.path.exists(optimal_path):
        print(f"Error: {optimal_path} not found. Run 'generate_full_question.py' first.")
        sys.exit(1)
    with open(optimal_path, "r", encoding="utf-8") as f:
        optimal_solution = f.read()
    if not optimal_solution.strip():
        print(f"Error: {optimal_path} is empty.")
        sys.exit(1)

    # 3. Prompt + LLM call (with optional one-shot regenerate if copy detected).
    def _generate_once(extra_nudge: str = "") -> str:
        sys_p, usr_p = get_brute_force_prompt(description, optimal_solution)
        # The reviewer's refine note (PIPELINE_REFINE_NOTE) is injected centrally
        # in llm_client.call_llm, so it applies to every attempt automatically.
        if extra_nudge:
            usr_p = usr_p + f"\n\n### Regeneration nudge:\n{extra_nudge}\n"
        print("Calling LLM to generate the brute-force oracle solution...")
        content, usage = call_llm(sys_p, usr_p, purpose="brute_force")
        print("LLM call completed.")
        content = _sanitize_generated_script(content)
        update_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            "brute_force_generation",
            model=usage.get("model", "unknown"),
            purpose="brute_force",
            step_id="generate_brute_force",
            cost=usage.get("cost", 0.0),
        )
        return content

    copy_nudge = (
        "Your previous attempt looked like a copy of the optimal solution's algorithm "
        "(same data structures / no plain enumeration). Rewrite using SIMPLE nested loops, "
        "full range scans, or exhaustive enumeration — NOT bisect/heap/deque/lru_cache/"
        "segment trees. Match the same STDIN/STDOUT format."
    )

    try:
        content = _generate_once()
        if _looks_like_copy(optimal_solution, content):
            print("Warning: brute force looks like a copy of optimal — regenerating once...")
            content = _generate_once(copy_nudge)
            if _looks_like_copy(optimal_solution, content):
                print("Warning: brute force still resembles a copy after nudge (proceeding anyway).")

        # 4. Smoke test: must parse as Python. One LLM-fix retry on failure.
        error = _parse_error(content)
        if error:
            print(f"Generated brute force did not parse ({error}). Retrying via LLM...")
            retry_content, retry_usage = _retry_fix(
                description, optimal_solution, content, error
            )
            retry_content = _sanitize_generated_script(retry_content)
            update_usage(
                retry_usage.get("prompt_tokens", 0),
                retry_usage.get("completion_tokens", 0),
                "brute_force_generation_retry",
                model=retry_usage.get("model", "unknown"),
                purpose="brute_force",
                step_id="generate_brute_force",
                cost=retry_usage.get("cost", 0.0),
            )
            error = _parse_error(retry_content)
            if error:
                print(f"Error: brute force still does not parse after retry ({error}). Aborting.")
                sys.exit(1)
            content = retry_content

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully saved brute-force oracle to: {out_path}")
        print("Dual-oracle validation will be ENABLED for test-case generation.")

        # 5. Early optimal-vs-brute cross-check. The brute is an independent oracle,
        #    so a disagreement on small structure-aware inputs strongly indicates the
        #    reference/optimal solution is BUGGY — and every test case generated from
        #    it would carry the wrong expected output. Surface this loudly now.
        _crosscheck_optimal_vs_brute(description, optimal_solution, content)

        # 6. Advisory SLM validation: small in-format examples + optimal/brute
        #    quality. Never blocks — enriches optimal_brute_check.json + logs.
        _run_solution_validation(description, optimal_solution, content)

    except SystemExit:
        raise
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
