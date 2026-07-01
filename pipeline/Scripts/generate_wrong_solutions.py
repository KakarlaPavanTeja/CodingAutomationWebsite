"""
Wrong-solution generator (pipeline step `generate_wrong_solutions`).

Runs AFTER `generate_testcases` and BEFORE `benchmark_testcases` / `harden_testcases`.
Writes runnable incorrect Python programs to `Outputs/wrong_solutions/*.py` for the
B2 wrong-approach gate in benchmark_suite.py.

Uses Claude via OpenRouter (purpose `wrong_solutions`, default anthropic/claude-sonnet-4.5).
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.wrongsolutionsprompt import get_wrong_solutions_prompt
from llm_client import call_llm
from usage_tracker import update_usage
from benchmark_suite import (
    BENCHMARK_RUN_TIMEOUT,
    extract_example_inputs,
    normalize,
    run_solutions_batch,
    structured_random_inputs,
)


def _valid_input_sample(description: str, testcases_path: str, limit: int = 60) -> list[str]:
    """Collect a set of VALID problem inputs to test candidate wrong solutions
    against: the generated test-case inputs + the description's worked examples +
    a structure-aware random sweep derived from them. Deduped, capped at `limit`."""
    inputs: list[str] = []
    if os.path.exists(testcases_path):
        try:
            with open(testcases_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            container = data[0] if isinstance(data, list) and data else data
            for tc in (container.get("test_cases") or []):
                inp = tc.get("input")
                if inp:
                    inputs.append(inp)
        except Exception:
            pass
    examples = extract_example_inputs(description)
    inputs.extend(examples)
    inputs.extend(structured_random_inputs(examples, 30))
    seen: set[str] = set()
    uniq: list[str] = []
    for inp in inputs:
        if inp and inp not in seen:
            seen.add(inp)
            uniq.append(inp)
    return uniq[:limit]


def _differs_from_optimal(
    code: str, sample: list[str], expected: list[str | None], timeout: float
) -> bool:
    """True if `code` produces a DIFFERENT result from the optimal on at least one
    valid sampled input (or crashes/times out where the optimal succeeds). A
    candidate that matches the optimal everywhere is functionally equivalent or
    only performance-wrong (e.g. O(n) vs required O(log n)) — it can never be
    killed by an I/O test case, so it must not be kept as a 'wrong' solution."""
    if not sample:
        return True  # no oracle available — keep (previous behavior)
    results = run_solutions_batch(code, sample, timeout)
    for (out, status), exp in zip(results, expected):
        if exp is None:
            continue  # optimal itself failed here — not a usable discriminator
        if status != "ok" or normalize(out) != exp:
            return True
    return False


def _sanitize_code(content: str) -> str:
    text = (content or "").strip()
    if text.startswith("```"):
        first_nl = text.find("\n")
        text = text[first_nl + 1:] if first_nl != -1 else text[3:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def _parse_llm_json(content: str) -> list[dict]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text.rstrip())
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("expected JSON array")
    return data


def _safe_filename(name: str, index: int) -> str:
    base = (name or f"wrong_{index + 1}.py").strip()
    base = os.path.basename(base)
    if not base.endswith(".py"):
        base = f"{base}.py"
    safe = re.sub(r"[^a-zA-Z0-9_]+", "_", base[:-3]).strip("_").lower()
    if not safe:
        safe = f"wrong_{index + 1}"
    return f"{safe}.py"


def _parse_error(code: str) -> str | None:
    try:
        ast.parse(code)
        return None
    except SyntaxError as exc:
        return f"{exc.__class__.__name__}: {exc}"


def _normalize(code: str) -> str:
    return re.sub(r"\s+", "", code or "")


def _has_explanatory_comments(code: str) -> bool:
    """Require a leading comment block or docstring in the saved solution."""
    lines = (code or "").strip().splitlines()
    if not lines:
        return False
    first = lines[0].strip()
    if first.startswith("#") or first.startswith('"""') or first.startswith("'''"):
        return True
    # Allow blank line then comment block
    for line in lines[:8]:
        s = line.strip()
        if s.startswith("#"):
            return True
        if s and not s.startswith("#"):
            break
    return False


def _retry_fix_json(description: str, optimal: str, failed_content: str, error: str):
    system = (
        "You returned invalid JSON for wrong-solution generation. "
        "Return ONLY a valid JSON array of objects with keys: "
        "filename, label, description, code. Each code string must start with a "
        "# comment block explaining the wrong approach. No markdown fences, no prose."
    )
    user = (
        f"### Problem Description:\n{description}\n\n"
        f"### Optimal Python Solution:\n{optimal}\n\n"
        f"### Parse error:\n{error}\n\n"
        f"### Your previous response:\n{failed_content[:8000]}\n\n"
        "Return the corrected JSON array only."
    )
    return call_llm(system, user, purpose="wrong_solutions")


def _log_usage(usage: dict, label: str, totals: dict) -> None:
    """Record OpenRouter usage + print cost from the API response."""
    prompt_t = int(usage.get("prompt_tokens") or 0)
    completion_t = int(usage.get("completion_tokens") or 0)
    cost = float(usage.get("cost") or 0.0)
    model = usage.get("model", "unknown")
    update_usage(
        prompt_t,
        completion_t,
        label,
        model=model,
        purpose="wrong_solutions",
        step_id="generate_wrong_solutions",
        cost=cost,
    )
    totals["calls"] += 1
    totals["prompt_tokens"] += prompt_t
    totals["completion_tokens"] += completion_t
    totals["total_tokens"] += prompt_t + completion_t
    totals["cost_usd"] += cost
    print(
        f"  [{label}] {model} | in={prompt_t} out={completion_t} "
        f"| ${cost:.6f} (OpenRouter)",
        flush=True,
    )


def main():
    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    os.chdir(root_dir)

    description_path = os.path.join("Outputs", "generated_description.md")
    optimal_path = os.path.join("Outputs", "generatedFullCode", "PYTHON.py")
    out_dir = os.path.join("Outputs", "wrong_solutions")

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
        print("Error: no problem statement found. Run generate_question first.")
        sys.exit(1)

    if not os.path.exists(optimal_path):
        print(f"Error: {optimal_path} not found. Run generate_question first.")
        sys.exit(1)
    with open(optimal_path, "r", encoding="utf-8") as f:
        optimal_solution = f.read()
    if not optimal_solution.strip():
        print(f"Error: {optimal_path} is empty.")
        sys.exit(1)

    testcases_path = os.path.join("Outputs", "testcases.json")
    if not os.path.exists(testcases_path):
        print("Warning: testcases.json not found — run generate_testcases first for best results.")
    else:
        print(f"Found {testcases_path} (B2 will run wrong solutions against this suite).")

    system_prompt, user_prompt = get_wrong_solutions_prompt(description, optimal_solution)
    usage_totals = {
        "calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "cost_usd": 0.0,
    }

    print("Calling LLM via OpenRouter (Claude Sonnet 4.5) for wrong-approach solutions...")
    content, usage = call_llm(system_prompt, user_prompt, purpose="wrong_solutions")
    _log_usage(usage, "wrong_solutions_generation", usage_totals)

    try:
        proposals = _parse_llm_json(content)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"Warning: could not parse LLM JSON ({exc}). Retrying once...")
        content, retry_usage = _retry_fix_json(description, optimal_solution, content, str(exc))
        _log_usage(retry_usage, "wrong_solutions_generation_retry", usage_totals)
        proposals = _parse_llm_json(content)

    if not proposals:
        print("Error: LLM returned an empty wrong-solutions array.")
        sys.exit(1)

    os.makedirs(out_dir, exist_ok=True)
    # Clear stale files from prior runs.
    for old in os.listdir(out_dir):
        if old.endswith(".py"):
            os.remove(os.path.join(out_dir, old))

    opt_norm = _normalize(optimal_solution)
    saved = 0
    seen_names: set[str] = set()

    # Upper bound on how many wrong solutions to keep. The prompt asks for 3–5, but
    # a model can over-produce (e.g. 10), which only slows the B2 gate. Cap it so a
    # runaway response stays bounded; override with PIPELINE_MAX_WRONG_SOLUTIONS.
    try:
        max_wrong = int(os.environ.get("PIPELINE_MAX_WRONG_SOLUTIONS", "8"))
    except ValueError:
        max_wrong = 8
    if max_wrong < 1:
        max_wrong = 8

    # Oracle for execution-based validation: run the optimal once over a set of
    # valid inputs so each candidate can be checked for ACTUALLY producing a wrong
    # answer somewhere. Without this, functionally-correct or performance-only
    # "wrong" solutions slip through and make the B2 gate unsatisfiable.
    sample = _valid_input_sample(description, testcases_path)
    expected: list[str | None] = []
    if sample:
        opt_results = run_solutions_batch(optimal_solution, sample, BENCHMARK_RUN_TIMEOUT)
        expected = [normalize(out) if status == "ok" else None for out, status in opt_results]
        usable = sum(1 for e in expected if e is not None)
        print(f"Validating candidates against {usable} valid input(s) via the optimal oracle.")
    else:
        print("Warning: no valid input sample available — skipping execution validation of wrong solutions.")

    for i, prop in enumerate(proposals):
        if saved >= max_wrong:
            print(f"  Reached wrong-solution cap ({max_wrong}); skipping the remaining proposals.")
            break
        if not isinstance(prop, dict):
            continue
        code = _sanitize_code(str(prop.get("code") or ""))
        if not code:
            print(f"  Skipping entry {i + 1}: empty code")
            continue
        err = _parse_error(code)
        if err:
            print(f"  Skipping entry {i + 1}: does not parse ({err})")
            continue
        if _normalize(code) == opt_norm:
            print(f"  Skipping entry {i + 1}: identical to optimal")
            continue
        if not _has_explanatory_comments(code):
            print(f"  Skipping entry {i + 1}: missing leading comment block in code")
            continue
        if not _differs_from_optimal(code, sample, expected, BENCHMARK_RUN_TIMEOUT):
            print(
                f"  Skipping entry {i + 1}: matches the optimal's output on all sampled "
                "valid inputs (functionally equivalent or performance-only — not actually wrong)"
            )
            continue

        fname = _safe_filename(str(prop.get("filename") or ""), i)
        if fname in seen_names:
            stem = fname[:-3]
            fname = f"{stem}_{i + 1}.py"
        seen_names.add(fname)

        label = str(prop.get("label") or "wrong_approach")
        path = os.path.join(out_dir, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(code + ("\n" if not code.endswith("\n") else ""))
        saved += 1
        print(f"  Saved {fname} ({label})")

    if saved == 0:
        print("Error: no valid wrong-solution files were saved.")
        sys.exit(1)

    print(f"Successfully saved {saved} wrong solution(s) to {out_dir}/")
    print(
        f"LLM cost (OpenRouter, {usage_totals['calls']} call(s)): "
        f"{usage_totals['total_tokens']} tokens "
        f"(in={usage_totals['prompt_tokens']} out={usage_totals['completion_tokens']}) "
        f"| ${usage_totals['cost_usd']:.6f} → llm_usage + usage_tracker.json",
        flush=True,
    )
    print("B2 wrong-approach gate will run on benchmark / harden steps.")


if __name__ == "__main__":
    main()
