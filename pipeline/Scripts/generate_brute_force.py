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
    return call_llm(retry_system, retry_user, purpose="code")


def _crosscheck_optimal_vs_brute(description: str, optimal_solution: str, brute_content: str) -> None:
    """Run the just-generated brute against the optimal on the example inputs plus a
    structure-aware small-input sweep. On disagreement, print a prominent warning and
    write `Outputs/optimal_brute_mismatch.txt` so downstream steps / the UI can flag
    that the reference solution is likely buggy. Best-effort: never aborts the step
    (the brute could itself be wrong) unless BRUTE_MISMATCH_FATAL=1 is set."""
    try:
        from benchmark_suite import (
            crosscheck_optimal_brute,
            extract_example_inputs,
            is_open_ended_problem,
        )
    except Exception as e:  # pragma: no cover - import guard
        print(f"(optimal-vs-brute cross-check skipped: cannot import benchmark_suite: {e})")
        return

    # Problems that accept any valid answer ("return any grid such that ...") would
    # false-positive a plain output comparison — optimal and brute differ legitimately.
    if is_open_ended_problem(description):
        print("Optimal-vs-brute cross-check skipped (problem accepts multiple valid outputs).")
        return

    marker_path = os.path.join("Outputs", "optimal_brute_mismatch.txt")
    # Clear any stale marker from a previous run.
    try:
        if os.path.exists(marker_path):
            os.remove(marker_path)
    except OSError:
        pass

    try:
        examples = extract_example_inputs(description)
        mismatches = crosscheck_optimal_brute(optimal_solution, brute_content, examples)
    except Exception as e:
        print(f"(optimal-vs-brute cross-check skipped: {e})")
        return

    if not mismatches:
        print("Optimal-vs-brute cross-check PASSED (no disagreements on sampled inputs).")
        return

    print("\n" + "=" * 72)
    print("⚠️  WARNING: the reference (optimal) solution DISAGREES with the brute force.")
    print("   The reference solution is most likely BUGGY. Test cases generated from it")
    print("   will have WRONG expected outputs — review/fix the optimal before trusting")
    print("   this problem. Disagreeing inputs (optimal vs brute):")
    for d in mismatches:
        print(f"     input={d['input'].strip()!r}  optimal={d['optimal']}  brute={d['brute']}")
    print("=" * 72 + "\n")

    try:
        with open(marker_path, "w", encoding="utf-8") as f:
            f.write("Reference (optimal) solution disagrees with the brute-force oracle.\n")
            f.write("The optimal is most likely buggy; test cases derived from it are unreliable.\n\n")
            for d in mismatches:
                f.write(f"input={d['input']!r} optimal={d['optimal']} brute={d['brute']}\n")
    except OSError as e:
        print(f"(could not write mismatch marker: {e})")

    if os.environ.get("BRUTE_MISMATCH_FATAL") == "1":
        print("BRUTE_MISMATCH_FATAL=1 set — aborting so the optimal can be fixed.")
        sys.exit(1)


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
        if extra_nudge:
            usr_p = usr_p + f"\n\n### Regeneration nudge:\n{extra_nudge}\n"
        print("Calling LLM to generate the brute-force oracle solution...")
        content, usage = call_llm(sys_p, usr_p, purpose="code")
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

    except SystemExit:
        raise
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
