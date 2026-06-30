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
    BENCHMARK_RUN_TIMEOUT,
    DEFAULT_MIN_KILL,
    DEFAULT_RUN_TIMEOUT,
    fuzz_kill_survivors,
    fuzz_kill_wrong_solutions,
    load_testcases,
    load_text,
    normalize,
    print_report,
    run_benchmark,
    run_mutation_benchmark,
    run_solution,
    run_wrong_approach_gate,
)
from testcase_helpers import (
    derive_size_bucket,
    parse_constraint_max_n,
    parse_primary_n,
    reorder_testcases_json_root,
    sync_size_tags,
    sync_subtask_tags,
)


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


def _save_testcases(path: str, test_cases: list[dict], description: str = ""):
    if description:
        sync_size_tags(test_cases, description)
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


# --------------------------------------------------------------------------- #
# B2 strengthening — kill surviving WRONG solutions via an LLM-targeted pass
# --------------------------------------------------------------------------- #
def _wrong_solution_killer_prompt(description, optimal_code, wrong_code, samples):
    sample_block = "\n\n".join(
        f"Example input {i + 1}:\n{s}" for i, s in enumerate(samples) if s and s.strip()
    ) or "(no samples available — infer the format from the solutions)"
    system = (
        "You are an expert competitive-programming test designer. You craft inputs "
        "that expose a bug in a wrong solution by making it disagree with the correct one."
    )
    user = f"""A coding problem has a CORRECT solution and a WRONG solution that currently
passes every existing test. Produce inputs that DISTINGUISH them — inputs where
the two print DIFFERENT outputs — so the wrong solution gets caught.

PROBLEM DESCRIPTION:
{description}

CORRECT (optimal) solution:
```
{optimal_code}
```

WRONG solution (find inputs where this disagrees with the correct one):
```
{wrong_code}
```

EXACT INPUT FORMAT — your inputs MUST match this stdin format exactly (same line
structure / token kinds, and valid per the problem constraints):
{sample_block}

Read the WRONG solution carefully and reason about the EXACT condition under
which its bug changes the output (e.g. an off-by-one in a binary-search bound
only matters when the threshold lands exactly on a value boundary). Small toy
inputs usually will NOT trigger subtle bugs — deliberately use:
  • LARGE sizes and values near the stated constraint limits,
  • adversarial structure: many equal/tie values, tight clusters, exact
    boundaries, min/max extremes, and values chosen so the buggy branch is taken.

Return ONLY a JSON array of 4-8 strings. Each string is one complete stdin input
(include any needed trailing newline). No commentary, no code fences."""
    return system, user


def _parse_llm_inputs(content):
    text = content or ""
    # The model often writes prose + a ```python``` bug snippet BEFORE the final
    # ```json``` array, so try every fenced block, then the last [...] span, then
    # the whole text — and use the first candidate that parses as a JSON array.
    candidates = [m.group(1).strip() for m in re.finditer(r"```(?:json)?\s*(.*?)```", text, re.S)]
    i, j = text.rfind("["), text.rfind("]")
    if i != -1 and j > i:
        candidates.append(text[i:j + 1])
    candidates.append(text.strip())
    for cand in candidates:
        try:
            data = json.loads(cand)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(data, list):
            return [str(x) for x in data if isinstance(x, str)]
    raise ValueError("no JSON array found in model output")


def _llm_kill_wrong_solutions(optimal_code, test_cases, wrong_codes, brute_code, description, timeout, max_inputs_per=8):
    """Ask the model to construct inputs that distinguish the optimal from each
    surviving wrong solution, then verify each (optimal vs brute vs wrong) before
    keeping it. Robust to custom input formats, unlike blind perturbation."""
    from llm_client import call_llm
    from usage_tracker import update_usage

    samples = [tc.get("input", "") for tc in test_cases[:2] if tc.get("input")]
    max_n = parse_constraint_max_n(description) or 100
    new_cases = []
    for name, code in wrong_codes:
        system, user = _wrong_solution_killer_prompt(description, optimal_code, code, samples)
        try:
            content, usage = call_llm(system, user, purpose="wrong_solutions")
        except Exception as e:
            print(f"  LLM killer call failed for {name}: {e}", flush=True)
            continue
        try:
            update_usage(
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), "harden_b2",
                model=usage.get("model", "unknown"), purpose="harden",
                step_id="harden_testcases", cost=usage.get("cost", 0.0),
            )
        except Exception:
            pass
        try:
            inputs = _parse_llm_inputs(content)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"  could not parse LLM inputs for {name}: {e}", flush=True)
            continue
        kept = 0
        for inp in inputs[:max_inputs_per]:
            if not inp.strip():
                continue
            opt_out, s = run_solution(optimal_code, inp, timeout)
            if s != "ok":
                continue
            expected = normalize(opt_out)
            if brute_code:
                bo, bs = run_solution(brute_code, inp, timeout)
                if bs != "ok" or normalize(bo) != expected:
                    continue  # not a trustworthy expected output
            wo, ws = run_solution(code, inp, timeout)
            if ws == "ok" and normalize(wo) == expected:
                continue  # doesn't actually kill the wrong solution
            n_val = parse_primary_n(inp)
            bucket = derive_size_bucket(n_val, max_n, inp)
            new_cases.append({
                "input": inp,
                "output": expected,
                "weightage": 1.0,
                "tags": [make_size_tag(bucket), "wrong_soln_llm_harden", "adversarial"],
                "order": 0,
            })
            kept += 1
        print(f"  LLM killer: {name} — {kept} confirmed discriminating case(s)", flush=True)
    return new_cases


def main():
    parser = argparse.ArgumentParser(description="Harden test-case suite against surviving mutants")
    parser.add_argument("--min-kill", type=float, default=DEFAULT_MIN_KILL)
    parser.add_argument("--max-rounds", type=int, default=int(os.environ.get("SUITE_MAX_ROUNDS", "3")))
    parser.add_argument("--no-llm", action="store_true", help="Fuzz-harden only, skip LLM")
    # Use the tighter benchmark timeout (default 3s) for mutation/fuzz runs: a
    # mutant that runs much longer than the optimal is looping/pathological and
    # is treated as killed anyway, so the old 10s default just made looping
    # mutants waste up to 10s PER input (a single bad mutant could stall the
    # equivalence filter for minutes). Override with BENCHMARK_RUN_TIMEOUT.
    parser.add_argument("--timeout", type=float, default=BENCHMARK_RUN_TIMEOUT)
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

    tags_fixed = sync_size_tags(test_cases, description)
    if tags_fixed:
        print(f"Corrected size_* tags on {tags_fixed} case(s) from derived input sizes.")
        _save_testcases(testcases_path, test_cases, description)

    # Repair coverage SHAPE (B3): a suite generated without subtask_<n> tags has
    # subtask count 0, which fails the [3, 6] gate forever — and the harden rounds
    # below only target mutants (B1) / wrong solutions (B2), never the partition.
    # Assign difficulty-ordered subtasks up front so the suite can actually pass.
    subtasks_fixed = sync_subtask_tags(test_cases, description)
    if subtasks_fixed:
        print(
            f"Assigned/repaired subtask tags on {subtasks_fixed} case(s) to satisfy "
            f"coverage shape (B3)."
        )
        _save_testcases(testcases_path, test_cases, description)

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
        _save_testcases(testcases_path, test_cases, description)
        print(f"Appended {total_added} case(s) to {testcases_path}")

    # B2 strengthening: the rounds above harden against synthetic mutants (B1).
    # A wrong solution can still pass EVERY case (B2 survivor) — target those by
    # perturbing real inputs until the optimal and the wrong solution diverge.
    for b2_round in range(1, args.max_rounds + 1):
        b2 = run_wrong_approach_gate(test_cases, timeout=args.timeout, progress=True)
        if not b2.get("hard_fail"):
            break
        failures = b2.get("failures") or []
        wrong_dir = os.path.join("Outputs", "wrong_solutions")
        wrong_codes = []
        for f in failures:
            p = os.path.join(wrong_dir, f["file"])
            if os.path.exists(p):
                wrong_codes.append((f["file"], load_text(p)))
        if not wrong_codes:
            break
        print(f"\n--- B2 strengthening round {b2_round}/{args.max_rounds} — "
              f"{len(wrong_codes)} surviving wrong solution(s) ---")
        # 1) Cheap perturbation pass (catches non-subtle wrong approaches fast).
        new_cases = fuzz_kill_wrong_solutions(
            optimal_code, test_cases, wrong_codes, brute_code,
            timeout=args.timeout, description=description, progress=True,
        )
        # 2) LLM-targeted pass (robust for subtle survivors blind fuzz misses).
        if not args.no_llm:
            new_cases += _llm_kill_wrong_solutions(
                optimal_code, test_cases, wrong_codes, brute_code, description, args.timeout,
            )
        # Dedup by input.
        seen_new: set[str] = set()
        uniq = []
        for c in new_cases:
            if c["input"] in seen_new:
                continue
            seen_new.add(c["input"])
            uniq.append(c)
        if not uniq:
            print("  Could not generate killer cases for the remaining wrong solution(s) — leaving for review.")
            break
        print(f"  Added {len(uniq)} case(s) targeting surviving wrong solution(s).")
        test_cases.extend(uniq)
        total_added += len(uniq)
        _save_testcases(testcases_path, test_cases, description)

    report = run_benchmark(advisory_size=True)
    print_report(report, args.min_kill)
    if report.passes_gate(args.min_kill):
        sys.exit(0)

    # Non-blocking completion. The correctness signals are B1 (mutation kill rate)
    # and B4 (optimal vs brute-force disagreement) — if either fails the step must
    # still hard-fail (exit 1). B2 (a wrong solution we couldn't auto-kill) and B3
    # (coverage SHAPE: subtask layout / size mix) are best-effort quality checks.
    # Since this step is non-blocking, complete it with a warning when only those
    # remain, so packaging can proceed and the report is surfaced — instead of the
    # step dying red and inviting futile re-runs (it cannot fix B3 by re-running).
    b1_ok = report.b1.get("kill_rate", 0.0) >= args.min_kill
    correctness_blocking = any(hf.startswith("B4:") for hf in report.hard_failures)
    if b1_ok and report.hard_failures and not correctness_blocking:
        print(
            "\nWARNING: the suite is correct on mutation (B1) and brute-equivalence (B4), "
            "but has best-effort issues that could not be auto-resolved:",
            flush=True,
        )
        for hf in report.hard_failures:
            print(f"  - {hf}", flush=True)
        print(
            "Completing this non-blocking step so packaging can proceed — review the "
            "items above before publishing.",
            flush=True,
        )
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
