"""
Hardening loop for test-case suites (Component C).

Imports benchmark_suite, runs free fuzz-harden, then one batched LLM call if needed.
Appends verified killer cases to testcases.json.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.hardenprompt import get_harden_prompt
from Prompts.testcasesprompt_v4 import (
    MAX_CASES_PER_SUBTASK,
    MAX_SUBTASKS,
    MIN_SUBTASKS,
    subtask_tag,
    tier_from_tags,
)
from Prompts.testcasesprompt_v4 import size_tag as make_size_tag
from benchmark_suite import (
    DEFAULT_MIN_KILL,
    DEFAULT_RUN_TIMEOUT,
    derive_size_bucket,
    fuzz_kill_survivors,
    load_testcases,
    load_text,
    normalize,
    parse_constraint_max_n,
    parse_primary_n,
    print_report,
    run_benchmark,
    run_mutation_benchmark,
    run_solution,
)
from testcase_helpers import reorder_testcases_json_root


def _parse_llm_json(content: str) -> list[dict]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text.rstrip())
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("expected JSON array")
    return data


def _materialize_input(case: dict, timeout: float) -> str | None:
    if "input" in case and case["input"]:
        return str(case["input"])
    gen = case.get("gen")
    if not gen:
        return None
    # Execute gen snippet in restricted namespace
    import random as random_mod
    import math as math_mod
    ns = {"random": random_mod, "math": math_mod, "print": print}
    import io
    import contextlib
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(gen, {"__builtins__": {}}, ns)
    except Exception:
        return None
    return buf.getvalue()


def _kills_any_survivor(
    inp: str,
    expected: str,
    survivor_ids: set[str],
    mutant_map: dict,
    timeout: float,
) -> bool:
    for sid in survivor_ids:
        m = mutant_map.get(sid)
        if not m:
            continue
        out, status = run_solution(m.code, inp, timeout)
        if status in ("timeout", "error"):
            continue
        if normalize(out) != expected:
            return True
    return False


def _pick_subtask_tag(test_cases: list[dict], bucket: str) -> str:
    """Assign stress-tier subtask, balancing counts within effective_cap."""
    total = len(test_cases)
    counts: dict[int, int] = {}
    tiers_present: set[int] = set()
    for tc in test_cases:
        try:
            t = tier_from_tags(tc.get("tags") or [])
            tiers_present.add(t)
            counts[t] = counts.get(t, 0) + 1
        except ValueError:
            pass
    subtask_n = max(len(tiers_present), MIN_SUBTASKS)
    subtask_n = min(subtask_n, MAX_SUBTASKS)
    effective_cap = max(MAX_CASES_PER_SUBTASK, math.ceil((total + 1) / subtask_n))
    # prefer top stress tiers for large/edge hardening cases
    prefer = (subtask_n, subtask_n - 1, subtask_n - 2) if bucket in ("large", "edge") else (2, 3, subtask_n)
    for tier in prefer:
        if tier < 1:
            continue
        if counts.get(tier, 0) < effective_cap:
            return subtask_tag(tier)
    return subtask_tag(subtask_n)


def _save_testcases(path: str, test_cases: list[dict]):
    data = [{"test_cases": test_cases}]
    reorder_testcases_json_root(data)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


def harden_round(
    optimal_code: str,
    test_cases: list[dict],
    description: str,
    brute_code: str | None,
    min_kill: float,
    timeout: float,
    use_llm: bool,
) -> tuple[list[dict], dict, bool]:
    """One harden round. Returns (new_cases_added, b1_result, improved)."""
    print("  Measuring current kill rate...", flush=True)
    b1 = run_mutation_benchmark(optimal_code, test_cases, timeout=timeout, progress=True)
    if b1["kill_rate"] >= min_kill:
        return [], b1, False

    survivors = b1.get("survivors", [])
    mutant_map = b1.get("mutant_objects", {})
    if not survivors:
        return [], b1, False

    prev_ids = {s["id"] for s in survivors}
    new_cases: list[dict] = []

    # Free fuzz-harden
    print(f"  {len(survivors)} survivor(s) - fuzzing for killer cases...", flush=True)
    fuzzed = fuzz_kill_survivors(
        optimal_code, test_cases, survivors, mutant_map,
        brute_code=brute_code, description=description, timeout=timeout, progress=True,
    )
    print(f"  Fuzz found {len(fuzzed)} killer case(s)", flush=True)
    for fc in fuzzed:
        max_n = parse_constraint_max_n(description)
        n_val = parse_primary_n(fc["input"])
        bucket = derive_size_bucket(n_val, max_n, fc["input"])
        st = _pick_subtask_tag(test_cases + new_cases, bucket)
        tags = list(fc.get("tags") or [])
        if not any(t.startswith("size_") for t in tags):
            tags.append(make_size_tag(bucket))
        if st not in tags:
            tags.append(st)
        fc["tags"] = tags
    new_cases.extend(fuzzed)

    if new_cases:
        test_cases.extend(new_cases)
        print("  Re-measuring kill rate after fuzz...", flush=True)
        b1_after = run_mutation_benchmark(optimal_code, test_cases, timeout=timeout, progress=True)
        if b1_after["kill_rate"] >= min_kill:
            return new_cases, b1_after, True
        survivors = b1_after.get("survivors", [])
        mutant_map = b1_after.get("mutant_objects", {})
        b1 = b1_after

    if not use_llm or not survivors:
        new_ids = {s["id"] for s in survivors}
        improved = new_ids != prev_ids or bool(fuzzed)
        return new_cases, b1, improved

    # Batched LLM call
    from llm_client import call_llm
    from usage_tracker import update_usage

    print(f"  Calling LLM to target {len(survivors)} survivor(s)...", flush=True)
    system_prompt, user_prompt = get_harden_prompt(description, survivors, len(test_cases))
    content, usage = call_llm(system_prompt, user_prompt, purpose="harden")
    update_usage(
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        "harden_suite",
        model=usage.get("model", "unknown"),
        purpose="harden",
        step_id="harden_testcases",
        cost=usage.get("cost", 0.0),
    )

    try:
        proposals = _parse_llm_json(content)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"Warning: could not parse harden LLM output: {e}")
        return new_cases, b1, bool(fuzzed)

    survivor_ids = {s["id"] for s in survivors}
    max_n = parse_constraint_max_n(description)
    llm_added = 0
    for prop in proposals:
        inp = _materialize_input(prop, timeout)
        if not inp:
            continue
        opt_out, status = run_solution(optimal_code, inp, timeout)
        if status != "ok":
            continue
        expected = normalize(opt_out)
        if brute_code:
            bru_out, s2 = run_solution(brute_code, inp, timeout)
            if s2 != "ok" or normalize(bru_out) != expected:
                continue
        if not _kills_any_survivor(inp, expected, survivor_ids, mutant_map, timeout):
            continue
        n_val = parse_primary_n(inp)
        bucket = derive_size_bucket(n_val, max_n, inp)
        scenario = prop.get("scenario", "harden_targeted")
        st = _pick_subtask_tag(test_cases + new_cases, bucket)
        case = {
            "input": inp,
            "output": expected,
            "weightage": 1.0,
            "tags": [make_size_tag(bucket), st, scenario, "adversarial"],
            "order": 0,
        }
        new_cases.append(case)
        test_cases.append(case)
        llm_added += 1

    print(f"Harden round: fuzz={len(fuzzed)} llm_verified={llm_added}", flush=True)
    print("  Final re-measure for this round...", flush=True)
    b1_final = run_mutation_benchmark(optimal_code, test_cases, timeout=timeout, progress=True)
    new_ids = {s["id"] for s in b1_final.get("survivors", [])}
    improved = new_ids != prev_ids or llm_added > 0 or bool(fuzzed)
    return new_cases, b1_final, improved


def main():
    parser = argparse.ArgumentParser(description="Harden test-case suite against surviving mutants")
    parser.add_argument("--min-kill", type=float, default=DEFAULT_MIN_KILL)
    parser.add_argument("--max-rounds", type=int, default=int(os.environ.get("SUITE_MAX_ROUNDS", "3")))
    parser.add_argument("--no-llm", action="store_true", help="Fuzz-harden only, skip LLM")
    parser.add_argument("--timeout", type=float, default=DEFAULT_RUN_TIMEOUT)
    args = parser.parse_args()

    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    os.chdir(root_dir)

    optimal_path = os.path.join("Outputs", "generatedFullCode", "PYTHON.py")
    testcases_path = os.path.join("Outputs", "testcases.json")
    description_path = os.path.join("Outputs", "generated_description.md")
    brute_path = os.path.join("Outputs", "generatedFullCode", "BRUTE_FORCE.py")

    if not os.path.exists(optimal_path):
        print(f"Error: {optimal_path} not found")
        sys.exit(1)
    if not os.path.exists(testcases_path):
        print(f"Error: {testcases_path} not found")
        sys.exit(1)

    optimal_code = load_text(optimal_path)
    test_cases = load_testcases(testcases_path)
    description = load_text(description_path) if os.path.exists(description_path) else ""
    brute_code = load_text(brute_path) if os.path.exists(brute_path) else None

    prev_survivor_key = None
    total_added = 0

    for round_num in range(1, args.max_rounds + 1):
        print(f"\n--- Harden round {round_num}/{args.max_rounds} ---")
        added, b1, improved = harden_round(
            optimal_code, test_cases, description, brute_code,
            args.min_kill, args.timeout, use_llm=not args.no_llm,
        )
        total_added += len(added)
        print(f"Kill rate: {b1['kill_rate']:.1%} survivors: {len(b1.get('survivors', []))}")

        if b1["kill_rate"] >= args.min_kill:
            print("Target kill rate reached.")
            break

        survivor_key = tuple(sorted(s["id"] for s in b1.get("survivors", [])))
        if survivor_key == prev_survivor_key and not improved:
            print("No progress — stopping early.")
            break
        prev_survivor_key = survivor_key

    if total_added:
        _save_testcases(testcases_path, test_cases)
        print(f"Appended {total_added} case(s) to {testcases_path}")

    report = run_benchmark(advisory_size=True)
    print_report(report, args.min_kill)
    if not report.passes_gate(args.min_kill):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
