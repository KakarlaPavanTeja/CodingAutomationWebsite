from __future__ import annotations

import json
import os
import sys
import subprocess
import argparse
import random

# Ensure the Scripts directory is in the path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.testcasesprompt_v4 import (
    DEFAULT_DISTRIBUTION_PRESET,
    MAX_CASES_PER_SUBTASK,
    MAX_SUBTASKS,
    MIN_SUBTASKS,
    MIN_TESTCASES,
    subtask_tag,
    tier_from_tags,
    get_testcases_prompt,
    get_size_fix_prompt,
)
from llm_client import apply_testcases_routing, call_llm, resolve_pipeline_difficulty
from usage_tracker import update_usage
from testcase_helpers import (
    audit_size_distribution,
    detect_problem_type,
    sync_size_tags_json_root,
    sync_subtask_tags,
    sync_example_testcases,
)


# --------------------------------------------------------------------------- #
# Script sanitation (markdown fence guard)
# --------------------------------------------------------------------------- #
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


# --------------------------------------------------------------------------- #
# Reorder helpers (payload-size sort, subtask-aware) — v3 compatible
# --------------------------------------------------------------------------- #
def _testcase_payload_byte_size(tc: dict) -> int:
    inp = tc.get("input", "") or ""
    out = tc.get("output", "") or ""
    if not isinstance(inp, str):
        inp = str(inp)
    if not isinstance(out, str):
        out = str(out)
    return len(inp.encode("utf-8")) + len(out.encode("utf-8"))


def _tier_from_testcase(tc: dict) -> int | None:
    if not isinstance(tc, dict):
        return None
    try:
        return tier_from_tags(tc.get("tags") or [])
    except ValueError:
        return None


def _has_subtask_tags(test_cases: list) -> bool:
    return any(
        _tier_from_testcase(tc) is not None
        for tc in test_cases
        if isinstance(tc, dict)
    )


def reorder_testcases_by_subtask(test_cases: list) -> tuple[list, bool]:
    """Weighted mode: preserve subtask_<n> blocks; sort by payload size within tier >= 3."""
    if not test_cases or not _has_subtask_tags(test_cases):
        return test_cases, False

    buckets: dict[int, list] = {}
    for tc in test_cases:
        tier = _tier_from_testcase(tc)
        if tier is None:
            continue
        buckets.setdefault(tier, []).append(tc)

    ordered: list = []
    for tier in range(1, MAX_SUBTASKS + 1):
        group = buckets.get(tier)
        if not group:
            continue
        if tier >= 3:
            group = sorted(group, key=_testcase_payload_byte_size)
        ordered.extend(group)

    for idx, tc in enumerate(ordered, start=1):
        tc["order"] = idx
    test_cases[:] = ordered
    return test_cases, True


def reorder_testcases_by_payload_size(test_cases: list) -> tuple[list, bool]:
    """Fallback (no subtask tags present): smallest first, largest (stress) last."""
    if not test_cases:
        return test_cases, False
    ordered = sorted(test_cases, key=_testcase_payload_byte_size)
    for idx, tc in enumerate(ordered, start=1):
        tc["order"] = idx
    test_cases[:] = ordered
    return test_cases, True


def _reorder_testcases_json_root(data) -> bool:
    """In-place reorder. Subtask blocks when tagged; payload-size fallback otherwise."""
    def _reorder_list(test_cases: list) -> bool:
        if _has_subtask_tags(test_cases):
            _, ok = reorder_testcases_by_subtask(test_cases)
            return ok
        _, ok = reorder_testcases_by_payload_size(test_cases)
        return ok

    if isinstance(data, list) and data and isinstance(data[0], dict):
        if "test_cases" in data[0]:
            return _reorder_list(data[0]["test_cases"])
    if isinstance(data, dict) and "test_cases" in data:
        return _reorder_list(data["test_cases"])
    return False


# --------------------------------------------------------------------------- #
# I/O for the generated script (run + retry-on-failure)
# --------------------------------------------------------------------------- #
def _python_executable() -> str:
    candidate = os.path.join("venv", "bin", "python3")
    return candidate if os.path.exists(candidate) else "python3"


def _script_timeout_sec() -> int:
    """Wall-clock cap for running the GENERATED test-case script (default 600s).

    This is separate from the LLM read timeout (1800s for testcases, in
    llm_client). It bounds only the LOCAL execution of the generated script, so
    a runaway generation loop fails into the retry path instead of hanging.
    Override with TESTCASE_SCRIPT_TIMEOUT_SEC for unusually heavy dual-oracle
    generation (e.g. very large counts at max constraints).
    """
    raw = os.environ.get("TESTCASE_SCRIPT_TIMEOUT_SEC", "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return 600


def _run_generator(script_path: str):
    timeout_sec = _script_timeout_sec()
    try:
        return subprocess.run(
            [_python_executable(), script_path],
            capture_output=True, text=True, timeout=timeout_sec,
        )
    except subprocess.TimeoutExpired:
        print(f"Error: Test case generator script timed out after {timeout_sec} seconds.")
        sys.exit(1)


def _retry_fix_script(script_path: str, first_error: str) -> None:
    """Ask the LLM to fix a script that crashed, save, and re-run. Exits on failure."""
    print("\n--- Retrying: calling LLM to fix the generator script ---")
    with open(script_path, "r") as f:
        failed_script = f.read()

    retry_system = (
        "You are a Python expert. The user gave you a test case generator script that failed. "
        "Fix the script so it runs without errors and produces the same output format and the "
        "same dual-oracle / scoring behavior. Return ONLY the corrected Python script, no explanations. "
        "OUTPUT HYGIENE (CRITICAL): your entire response is written verbatim to a .py file and executed. "
        "First character MUST be valid Python (import/#/from); no preamble, no sign-off, no markdown fences. "
        "IMPORT CORRECTNESS: only import names that exist; round/abs/min/max/sum/pow are built-ins, not in math."
    )
    retry_user = (
        f"The following Python script failed with this error:\n\n"
        f"```\n{first_error[-2000:]}\n```\n\n"
        f"Here is the script:\n\n```python\n{failed_script}\n```\n\n"
        f"Fix the error and return the corrected script."
    )
    try:
        retry_content, retry_usage = call_llm(retry_system, retry_user, purpose="testcases_retry")
        print("LLM retry call completed.")
        retry_content = _sanitize_generated_script(retry_content)
        with open(script_path, "w") as f:
            f.write(retry_content)
        print(f"Saved fixed script to: {script_path}")
        update_usage(
            retry_usage.get("prompt_tokens", 0),
            retry_usage.get("completion_tokens", 0),
            "testcase_generation_retry",
            model=retry_usage.get("model", "unknown"),
            purpose="testcases",
            step_id="generate_testcases",
            cost=retry_usage.get("cost", 0.0),
        )
    except Exception as retry_err:
        print(f"LLM retry failed: {retry_err}")
        sys.exit(1)

    print(f"Running fixed {script_path}...")
    result = _run_generator(script_path)
    if result.returncode != 0:
        print(f"Error: Fixed script also failed:\n{result.stderr}")
        sys.exit(1)


# --------------------------------------------------------------------------- #
# Size-diversity feedback loop (re-prompt the LLM when the realized size mix
# misses targets — e.g. an all-small suite that fails B3 / vacuous mutation)
# --------------------------------------------------------------------------- #
def _move_testcases_to_outputs() -> str:
    """Move a freshly written ./testcases.json into Outputs/. Returns the path."""
    out_path = os.path.join("Outputs", "testcases.json")
    if os.path.exists("testcases.json"):
        os.rename("testcases.json", out_path)
    return out_path


def _cleanup(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _size_fix_rounds() -> int:
    """Max LLM-regeneration rounds for size diversity (default 1, 0 disables).

    Each round is one extra LLM call + script run, so it is bounded and cheap to
    turn off. Override with TESTCASE_SIZE_FIX_ROUNDS.
    """
    raw = os.environ.get("TESTCASE_SIZE_FIX_ROUNDS", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 1


def _print_size_audit(audit: dict, prefix: str = "Size distribution") -> None:
    realized = audit.get("realized", {})
    order = ("edge", "small", "medium", "large")
    parts = [f"{b} {realized.get(b, 0.0)}%" for b in order]
    print(f"{prefix}: " + ", ".join(parts) + f"  (n={audit.get('total', 0)})")


def _reformat_and_audit(out_path: str, description: str) -> dict:
    """Load the suite, sync size + subtask tags, reorder, save, and return a size audit."""
    with open(out_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    tags_fixed = sync_size_tags_json_root(data, description)
    # Guarantee a valid subtask partition (B3). LLM generator scripts sometimes emit
    # NO subtask_<n> tags despite the prompt, which fails "subtask count outside [3,6]"
    # downstream and can't be fixed by re-running Strengthen. Assign difficulty-ordered
    # subtasks here so a freshly generated suite is shape-valid from the start.
    tcs = (
        data[0]["test_cases"]
        if isinstance(data, list) and data and isinstance(data[0], dict)
        else data.get("test_cases") if isinstance(data, dict) else []
    )
    subtasks_fixed = sync_subtask_tags(tcs, description) if tcs else 0
    # Reorder AFTER subtask tags exist so the subtask-aware sort applies.
    did_reorder = _reorder_testcases_json_root(data)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    if tags_fixed:
        print(f"Corrected size_* tags on {tags_fixed} case(s) from derived input sizes.")
    if subtasks_fixed:
        print(f"Assigned subtask tags on {subtasks_fixed} case(s) (generator emitted none/invalid).")
    if examples_fixed:
        print(f"Synced {examples_fixed} public example case(s) from description Examples 1 & 2.")
    if did_reorder:
        if _has_subtask_tags(tcs):
            print("Reordered within subtask tag blocks (payload sort for subtask >= 3).")
        else:
            print("Reordered cases by input+output size (ascending); stress cases last.")
    return audit_size_distribution(tcs, description)


def _regenerate_for_size(script_path: str, out_path: str, description: str,
                         audit: dict, round_no: int) -> bool:
    """Re-prompt the LLM to fix the generator's size ladder, re-run, and keep the
    result only if it is valid. The current suite is backed up first and restored
    on any failure, so a bad round never destroys a usable suite. Returns True when
    a new suite was produced, False when we degraded to the previous one."""
    import shutil

    backup = out_path + ".sizebak"
    had_backup = False
    try:
        shutil.copyfile(out_path, backup)
        had_backup = True
    except OSError:
        backup = None

    def _degrade(reason: str) -> bool:
        print(f"Size-fix round {round_no}: {reason} — keeping previous suite.")
        if had_backup:
            try:
                shutil.copyfile(backup, out_path)
            except OSError:
                pass
        _cleanup(backup)
        return False

    with open(script_path, "r", encoding="utf-8") as f:
        current_script = f.read()
    system_prompt, user_prompt = get_size_fix_prompt(current_script, description, audit)
    print(f"--- Size-diversity round {round_no}: re-prompting LLM to regenerate for size targets ---")
    try:
        content, usage = call_llm(system_prompt, user_prompt, purpose="testcases_size_fix")
        content = _sanitize_generated_script(content)
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(content)
        update_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            "testcase_generation_size_fix",
            model=usage.get("model", "unknown"),
            purpose="testcases",
            step_id="generate_testcases",
            cost=usage.get("cost", 0.0),
        )
    except Exception as e:
        return _degrade(f"LLM call failed ({e})")

    result = _run_generator(script_path)
    if result.returncode != 0:
        return _degrade(f"regenerated script crashed:\n{result.stderr.strip()[-600:]}")

    _move_testcases_to_outputs()
    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        return _degrade("regenerated script produced no testcases.json")

    _cleanup(backup)
    return True


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser(description="Generate LeetCode-grade test cases (v4)")
    parser.add_argument("--count", type=int, default=None,
                        help=f"Target case count (minimum {MIN_TESTCASES}; default scales by difficulty x type)")
    parser.add_argument("--distribution", default=DEFAULT_DISTRIBUTION_PRESET,
                        choices=["assessment", "contest"],
                        help="Subtask weight split mode. Default: assessment.")
    parser.add_argument("--type", default=None,
                        help="Override detected problem type (array/string/tree/graph/dp/sliding_window/math/greedy).")
    args = parser.parse_args()

    description_path = os.path.join("Outputs", "generated_description.md")
    output_script_path = os.path.join("Outputs", "testcases_generator_script.py")

    # 1. Description
    if not os.path.exists(description_path):
        print(f"Error: {description_path} not found.")
        sys.exit(1)
    with open(description_path, "r") as f:
        description = f.read()

    # 2. Optimal solution
    optimal_path = os.path.join("Outputs", "generatedFullCode", "PYTHON.py")
    if not os.path.exists(optimal_path):
        print(f"Error: {optimal_path} not found.")
        sys.exit(1)
    with open(optimal_path, "r") as f:
        optimal_solution = f.read()
    if not optimal_solution.strip():
        print("Error: No python_code found in generatedFullCode/PYTHON.py")
        sys.exit(1)

    # 2b. Brute-force solution (optional oracle).
    #     Looked up in a few conventional locations; absence is allowed but warned.
    brute_candidates = [
        os.path.join("Outputs", "generatedFullCode", "BRUTE_FORCE.py"),
        os.path.join("Outputs", "generatedFullCode", "BRUTE.py"),
        os.path.join("Outputs", "generated_brute_force.py"),
    ]
    brute_solution = None
    brute_path = next((p for p in brute_candidates if os.path.exists(p)), None)
    if brute_path:
        with open(brute_path, "r") as f:
            brute_solution = f.read()
        if brute_solution.strip():
            print(f"Found brute-force oracle: {brute_path} (dual-oracle validation ENABLED).")
        else:
            brute_solution = None
            print(f"Warning: {brute_path} is empty — running in single-oracle mode.")
    else:
        print(
            "Warning: no brute-force solution found "
            f"(looked for {', '.join(os.path.basename(p) for p in brute_candidates)}). "
            "Running in SINGLE-ORACLE mode — outputs are unverified beyond self-consistency. "
            "Add a brute force for full LeetCode-grade validation."
        )

    # 3. Difficulty (owner-set is FINAL, else LLM-generated file) + weightage.
    total_score = 100
    difficulty, difficulty_source = resolve_pipeline_difficulty()
    owner_score_raw = os.environ.get("PIPELINE_OWNER_SCORE", "").strip()
    owner_score = None
    if owner_score_raw:
        try:
            parsed = int(owner_score_raw)
            if parsed >= 1:
                owner_score = parsed
        except ValueError:
            owner_score = None

    if owner_score is not None:
        total_score = owner_score
        print(f"Using owner-set score (final). Total weightage: {total_score}")
    elif difficulty:
        total_score = {"easy": 20, "medium": 25, "hard": 30}.get(difficulty, 100)
        source_label = {
            "owner": "owner-set",
            "llm": "LLM-generated",
            "default": "default",
        }.get(difficulty_source, difficulty_source)
        print(f"Using {source_label} difficulty: {difficulty}. Total weightage: {total_score}")
    else:
        print(
            "Warning: no owner difficulty and generated_difficulty.txt not found. "
            "Using default total weightage: 100"
        )

    routing = apply_testcases_routing(difficulty)
    effective = difficulty or routing["tier"]
    source_label = {
        "owner": "owner",
        "llm": "llm",
        "default": "default→medium",
    }.get(difficulty_source, difficulty_source)
    print(
        f"Testcase LLM routing: difficulty={effective} (source={source_label}) "
        f"primary={routing['model']}@{routing['effort']} "
        f"fallbacks=[{routing['fallbacks_display']}]"
    )

    # 4. Count + type
    num_testcases = args.count
    if num_testcases is not None:
        num_testcases = max(num_testcases, MIN_TESTCASES)
        print(f"Target test case count: {num_testcases} (minimum {MIN_TESTCASES})")
    else:
        print(f"No explicit count; target scales by difficulty x type (minimum {MIN_TESTCASES}).")

    problem_type = (args.type or detect_problem_type(description)).strip().lower()
    print(f"Problem type (for count scaling): {problem_type}")
    print(f"Subtask weight mode: {args.distribution} (split by problem-chosen subtask count {MIN_SUBTASKS}-{MAX_SUBTASKS}).")

    # 4c. Function signature — decides the I/O representation. The naming step
    #     writes description_signature.json for function-based problems; its
    #     presence (with a function_name) marks the problem as function-based and
    #     supplies the parameter names. Absent => treat as a STDIN/STDOUT problem.
    is_function = False
    signature_params = None
    signature_path = os.path.join("Outputs", "description_signature.json")
    if os.path.exists(signature_path):
        try:
            with open(signature_path, "r") as f:
                signature = json.load(f)
            if isinstance(signature, dict) and str(signature.get("function_name") or "").strip():
                is_function = True
                params = signature.get("parameters") or []
                if isinstance(params, list):
                    signature_params = [str(p).strip() for p in params if str(p).strip()]
        except Exception as exc:
            print(f"Warning: could not read {signature_path} ({exc}); "
                  "defaulting to STDIN/STDOUT I/O format.")
    print(f"I/O format: {'function (named-variable-assignment input)' if is_function else 'STDIN/STDOUT'}"
          + (f"; params={signature_params}" if signature_params else ""))

    # 5. Prompt
    system_prompt, user_prompt = get_testcases_prompt(
        description,
        optimal_solution,
        total_score,
        brute_force_code=brute_solution,
        num_testcases=num_testcases,
        distribution_preset=args.distribution,
        difficulty=difficulty,
        problem_type=problem_type,
        is_function=is_function,
        signature_params=signature_params,
    )

    # 6. LLM -> script
    print("Calling LLM to generate test case generator script...")
    try:
        content, usage = call_llm(system_prompt, user_prompt, purpose="testcases")
        print("LLM call completed.")
        content = _sanitize_generated_script(content)
        with open(output_script_path, "w") as f:
            f.write(content)
        print(f"Successfully saved test case generator script to: {output_script_path}")

        update_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            "testcase_generation",
            model=usage.get("model", "unknown"),
            purpose="testcases",
            step_id="generate_testcases",
            cost=usage.get("cost", 0.0),
        )

        # 7. Run (with one LLM-fix retry on failure)
        print(f"Running {output_script_path}...")
        result = _run_generator(output_script_path)
        if result.returncode != 0:
            first_error = result.stderr.strip()
            print(f"Error running generator script:\n{first_error}")
            _retry_fix_script(output_script_path, first_error)

        # 8. Verify output exists and is non-empty
        out_path = os.path.join("Outputs", "testcases.json")
        if os.path.exists("testcases.json"):
            os.rename("testcases.json", out_path)
            print("Moved testcases.json to Outputs folder.")
        if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
            print("Error: generator ran but produced no testcases.json (empty or missing). Aborting.")
            sys.exit(1)
        print("Successfully generated testcases.json")

        # 9. Reorder + reformat + size-diversity feedback loop.
        #    A suite that is all-small fails the B3 coverage-shape gate and makes
        #    mutation testing vacuous. When the realized size mix misses targets we
        #    re-prompt the LLM to regenerate the script with a proper size ladder
        #    (bounded by TESTCASE_SIZE_FIX_ROUNDS; degrades safely on any failure).
        try:
            audit = _reformat_and_audit(out_path, description)
            _print_size_audit(audit, "Realized size distribution")
            rounds = _size_fix_rounds()
            attempt = 0
            while not audit["ok"] and attempt < rounds:
                attempt += 1
                deficient = ", ".join(f"size_{d['bucket']}" for d in audit["deficient"]) or "none"
                excessive = ", ".join(f"size_{d['bucket']}" for d in audit["excessive"]) or "none"
                print(f"Size distribution off-target (deficient: {deficient}; excessive: {excessive}). "
                      f"Regeneration attempt {attempt}/{rounds}.")
                if not _regenerate_for_size(output_script_path, out_path, description, audit, attempt):
                    break
                audit = _reformat_and_audit(out_path, description)
                _print_size_audit(audit, f"After size-fix round {attempt}")
            if audit["ok"]:
                print("Size distribution within tolerance of targets.")
            else:
                print("WARNING: size distribution still off-target after regeneration. "
                      "The coverage-shape gate (B3) may flag this and mutation testing "
                      "may stay weak — large/edge buckets need constraint-scaled inputs.")
        except Exception as e:
            print(f"Warning: could not reformat/audit testcases.json: {e}")

    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)


if __name__ == "__main__":
    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root_dir)
    main()
