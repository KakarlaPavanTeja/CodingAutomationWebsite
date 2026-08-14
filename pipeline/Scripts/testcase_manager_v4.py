from __future__ import annotations

import json
import os
import shutil
import sys
import subprocess
import argparse
import random

# Ensure the Scripts directory is in the path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.testcasesprompt_v4 import (
    MAX_CASES_PER_SUBTASK,
    MAX_SUBTASKS,
    MIN_SUBTASKS,
    MIN_TESTCASES,
    subtask_tag,
    get_testcases_prompt,
    get_size_fix_prompt,
)
from llm_client import apply_testcases_routing, call_llm, resolve_pipeline_difficulty
from usage_tracker import update_usage
from testcase_helpers import (
    audit_io_shape,
    audit_size_distribution,
    detect_problem_type,
    format_compliance,
    format_io_shape,
    has_subtask_tags,
    reorder_testcases_json_root,
    repair_suite_json_root,
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
    # A LONE trailing fence (no opening one — the model emitted raw Python then
    # signed off with ```) is a SyntaxError on the last line, so strip it
    # unconditionally, not only when an opening fence was found.
    text = text.rstrip()
    if text.endswith("```"):
        text = text[:-3]
    return _asciify_punctuation(text.strip())


# Typographic characters a model slips into SOURCE (not just comments): an en-dash
# inside an expression is `SyntaxError: invalid character '–' (U+2013)`, which cost
# a full repair round trip today. Deterministically fixable, so fix it here rather
# than spend an LLM call on it.
_PUNCTUATION_FIXES = {
    "–": "-", "—": "-", "−": "-",        # en dash, em dash, minus sign
    "‘": "'", "’": "'",                       # curly single quotes
    "“": '"', "”": '"',                       # curly double quotes
    "…": "...", " ": " ", "→": "->",     # ellipsis, nbsp, arrow
    "≤": "<=", "≥": ">=", "×": "*",      # comparison / times signs
}


def _asciify_punctuation(source: str) -> str:
    for bad, good in _PUNCTUATION_FIXES.items():
        source = source.replace(bad, good)
    return source


def _syntax_error_of(source: str) -> str | None:
    """A formatted SyntaxError for `source`, or None when it parses.

    Running a script that cannot parse, just to read the traceback back off stderr,
    burns a subprocess and hands the repair model a stack trace instead of a
    location. 5 of 12 repairs today were pure syntax (unterminated string literal,
    mismatched brace, non-ASCII character), so parse first and report precisely.
    """
    import ast
    try:
        ast.parse(source)
        return None
    except SyntaxError as e:
        where = f"line {e.lineno}" + (f", offset {e.offset}" if e.offset else "")
        snippet = (e.text or "").rstrip()
        return (f"SyntaxError: {e.msg} ({where})"
                + (f"\n    {snippet}" if snippet else ""))


# Reorder helpers live in testcase_helpers (has_subtask_tags,
# reorder_testcases_json_root) — this module used to carry a byte-identical
# second copy that both had to be kept in sync.


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
        # float() like _grounding_timeout_sec: int("600.5") raises, and silently
        # falling back to 600 hides the misconfiguration.
        try:
            return max(1, int(float(raw)))
        except ValueError:
            print(f"Warning: TESTCASE_SCRIPT_TIMEOUT_SEC={raw!r} is not a number — using 600s.")
    return 600


def _ensure_harness(script_path: str) -> None:
    """Copy the known-good IO harness next to the generated script so its
    `from tc_harness import run_solution` import resolves (python puts the
    script's own directory on sys.path)."""
    src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tc_harness.py")
    dst = os.path.join(os.path.dirname(os.path.abspath(script_path)), "tc_harness.py")
    if os.path.exists(src) and src != dst:
        shutil.copyfile(src, dst)


def _run_generator(script_path: str):
    timeout_sec = _script_timeout_sec()
    _ensure_harness(script_path)
    # Pre-flight: every path that writes a generated script (primary, retry,
    # grounding-fix, size-fix) runs it through here, so one parse check covers all
    # four. A non-parsing script gets a precise location instead of a traceback.
    with open(script_path, "r", encoding="utf-8") as f:
        syntax_err = _syntax_error_of(f.read())
    if syntax_err:
        print(f"Generator script does not parse — skipping execution.\n{syntax_err}")
        return subprocess.CompletedProcess(
            args=[script_path], returncode=1, stdout="", stderr=syntax_err,
        )
    try:
        return subprocess.run(
            [_python_executable(), script_path],
            capture_output=True, text=True, timeout=timeout_sec,
        )
    except subprocess.TimeoutExpired:
        # Report like the syntax-error path above instead of exiting: the
        # size-fix and grounding-repair callers back up the last good suite and
        # restore it on a failed regeneration. sys.exit(1) here killed the
        # process before that restore ran, losing a valid suite to a hung script.
        msg = f"Test case generator script timed out after {timeout_sec} seconds."
        print(f"Error: {msg}")
        return subprocess.CompletedProcess(
            args=[script_path], returncode=1, stdout="", stderr=msg,
        )


# The primary call's system prompt (~6.4k tokens: I/O format, size ladder, metadata
# spec, output hygiene). Every REPAIR call used to ship a ~294-token stub instead, so a
# repair was free to drift off the contract while fixing an unrelated crash. Stashed at
# build time and prepended to every repair prompt.
_PRIMARY_SYSTEM_PROMPT = ""


def _repair_system_prompt(instructions: str) -> str:
    """A repair system prompt that still carries the full generation contract."""
    if not _PRIMARY_SYSTEM_PROMPT:
        return instructions
    return (
        "The ORIGINAL CONTRACT you must keep obeying while repairing follows. Every rule "
        "in it still applies to the script you return — the I/O format, the size ladder, "
        "the per-case metadata, and the output hygiene rules.\n\n"
        f"{_PRIMARY_SYSTEM_PROMPT}\n\n"
        "=== REPAIR TASK ===\n"
        f"{instructions}"
    )


def _retry_fix_script(script_path: str, first_error: str) -> None:
    """Ask the LLM to fix a script that crashed, save, and re-run. Exits on failure."""
    print("\n--- Retrying: calling LLM to fix the generator script ---")
    with open(script_path, "r") as f:
        failed_script = f.read()

    retry_system = _repair_system_prompt(
        "You are a Python expert. The user gave you a test case generator script that failed. "
        "Fix the script so it runs without errors and produces the same output format and the "
        "same dual-oracle / scoring behavior. Return ONLY the corrected Python script, no explanations. "
        "If the failure is a duplicate-input or insufficient-count check (e.g. "
        "'AssertionError: Duplicate input generated for scenario ...'), REMOVE that fatal check: "
        "skip duplicates and continue, accept fewer cases for a scenario, and still write "
        "testcases.json — only an optimal-vs-brute oracle mismatch may abort the script. "
        "If the failure involves stdin/stdout capture in ANY form (readonly .buffer, StringIO "
        "without .buffer, unrestored streams), DELETE the script's hand-rolled IO capture entirely "
        "and use the provided harness instead: `from tc_harness import run_solution` — "
        "`run_solution(input_str, SOLUTION_CODE_STRING)` execs the solution source with stdin fed "
        "from input_str and returns its stdout as a str (tc_harness.py sits next to the script). "
        "Never assign to sys.stdin/sys.stdout or their .buffer attributes yourself. "
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
# Grounding: the generated suite is only valid if the REFERENCE SOLUTION can
# actually read each `input` from stdin and print the stored `output`. That is
# exactly how benchmark/harden run it, so we validate against the real solution
# here and repair once — catching input-format drift before it fails downstream.
# --------------------------------------------------------------------------- #
def _grounding_timeout_sec() -> float:
    raw = os.environ.get("TESTCASE_GROUNDING_TIMEOUT_SEC", "").strip()
    if raw:
        try:
            return max(1.0, float(raw))
        except ValueError:
            pass
    return 10.0


def _normalize_output(text: str) -> str:
    """Strip trailing whitespace per line, then trailing blank lines.

    Must match benchmark_suite.normalize so a suite that passes grounding also
    passes the benchmark's own comparison (and vice-versa)."""
    if text is None:
        return ""
    return "\n".join(line.rstrip() for line in text.splitlines()).rstrip()


def _run_reference_on_input(optimal_path: str, stdin_str: str, timeout: float):
    """Pipe `stdin_str` to the reference solution. Returns (stdout, status).

    status: ok | timeout | error — same contract benchmark_suite.run_solution uses."""
    try:
        proc = subprocess.run(
            [_python_executable(), optimal_path],
            input=stdin_str,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return "", "timeout"
    if proc.returncode != 0:
        return (proc.stdout or "") + (proc.stderr or ""), "error"
    return proc.stdout or "", "ok"


def _load_testcases_from(out_path: str) -> list[dict]:
    with open(out_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0].get("test_cases", []) or []
    if isinstance(data, dict):
        return data.get("test_cases", []) or []
    return []


UNCONVERTIBLE = "<no candidate stdin layout reproduced the stated output>"


def _resolve_named_var_example(optimal_path: str, block: str, expected: str, timeout: float):
    """Convert one display-form example block into the raw stdin the reference reads.

    The block alone is ambiguous (did it declare the size line? does the solution read
    it?), so try each candidate layout and keep the first whose stdout matches the stated
    expected output under token comparison — the description states the function's RETURN
    value (`[1, 2]`, `false`) while the solution PRINTS it (`1 2`, `false`), so an exact
    compare would reject every candidate. Returns (stdin, reference_stdout, detail); the
    frozen stdout is the reference's own bytes, not the description's display form.
    """
    from benchmark_suite import display_value_tokens, named_var_stdin_candidates

    want = display_value_tokens(expected)
    tried: list[str] = []
    for cand in named_var_stdin_candidates(block):
        got, status = _run_reference_on_input(optimal_path, cand, timeout)
        if status != "ok":
            tried.append(f"{cand!r} -> <{status}>")
            continue
        got = _normalize_output(got)
        if display_value_tokens(got) == want:
            return cand, got, None
        tried.append(f"{cand!r} -> {got[:60]!r}")
    return None, None, "; ".join(tried)


def verify_io_contract(description: str, optimal_path: str, outputs_dir: str = "Outputs") -> dict:
    """CHECKPOINT: freeze the I/O contract from the description's own Examples, verified
    against the reference solution, BEFORE any testcase is generated.

    The root cause of every I/O failure on 2026-07-29 is that no artifact OWNS the I/O
    contract — the description, the normalized solution, the per-language driver and the
    testcases each re-derive it, so they can silently disagree. "T primes" shipped
    `[8]` / `["NO"]` and scored 0/150 in all three languages; "Infinite Coins" shipped
    `N = 2763`. Both were only visible three steps downstream.

    So: take Examples 1 and 2 from the statement, serialize them as raw stdin, run the
    reference solution, and compare its stdout to the stated expected output. Two
    subprocess runs, at the cheapest point in the pipeline. A mismatch here is a real
    defect in the description or the solution, and it is a two-minute fix at this point.

    Function-type descriptions show their Examples as named-variable assignments
    (`N = 2763` / `C = 0`) rather than raw stdin, which is why this used to report
    "skipped" for every function problem. Those blocks are now CONVERTED: each candidate
    stdin layout is piped to the reference and the one that reproduces the stated answer
    wins, so the contract covers both description forms.

    Writes `io_contract.json` so downstream steps can quote a VERIFIED concrete pair
    instead of prose describing a format. Returns the contract dict.
    """
    from benchmark_suite import extract_example_io, extract_named_var_example_io

    contract = {"verified": False, "pairs": [], "mismatches": [], "reason": ""}
    try:
        pairs = extract_example_io(description) or []
        named = extract_named_var_example_io(description) or []
    except Exception as e:
        contract["reason"] = f"could not parse Examples from the description ({e})"
        pairs, named = [], []
    if not pairs and not named:
        contract["reason"] = contract["reason"] or "the description states no parseable Examples"
        return contract

    timeout = _grounding_timeout_sec()
    for idx, (inp, out) in enumerate(pairs[:2], start=1):
        stdin_str = inp if inp.endswith("\n") else inp + "\n"
        want = _normalize_output(out)
        got, status = _run_reference_on_input(optimal_path, stdin_str, timeout)
        entry = {"example": idx, "stdin": stdin_str, "expected": want}
        if status != "ok":
            entry.update({"got": f"<{status}>", "detail": _normalize_output(got)[:300]})
            contract["mismatches"].append(entry)
        elif _normalize_output(got) != want:
            entry["got"] = _normalize_output(got)[:300]
            contract["mismatches"].append(entry)
        else:
            entry["stdout"] = want          # the verified pair, byte for byte
            contract["pairs"].append(entry)

    # Display-form Examples: derive the stdin, then freeze what the reference prints.
    for block, out in named[: max(0, 2 - len(pairs))]:
        idx = len(contract["pairs"]) + len(contract["mismatches"]) + 1
        want = _normalize_output(out)
        stdin_str, stdout, detail = _resolve_named_var_example(
            optimal_path, block, out, timeout)
        if stdin_str is None:
            contract["mismatches"].append({
                "example": idx, "stdin": _normalize_output(block), "expected": want,
                "got": UNCONVERTIBLE, "detail": (detail or "")[:300]})
        else:
            contract["pairs"].append({
                "example": idx, "stdin": stdin_str, "stdout": stdout,
                "expected": want, "converted_from": "named-variable block"})

    contract["verified"] = bool(contract["pairs"]) and not contract["mismatches"]
    try:
        os.makedirs(outputs_dir, exist_ok=True)
        with open(os.path.join(outputs_dir, "io_contract.json"), "w", encoding="utf-8") as f:
            json.dump(contract, f, indent=4, ensure_ascii=False)
    except OSError as e:
        print(f"Warning: could not write io_contract.json — {e}")
    return contract


def format_io_contract(contract: dict) -> str:
    """Human report for the generate_testcases log."""
    if contract.get("verified"):
        pairs = contract["pairs"]
        converted = sum(1 for p in pairs if p.get("converted_from"))
        note = f" ({converted} converted from the named-variable display form)" if converted else ""
        lines = [f"I/O CONTRACT verified against the reference solution "
                 f"({len(pairs)} example(s)){note}:"]
        for p in pairs:
            lines.append(f"    example {p['example']}: stdin={p['stdin']!r} "
                         f"stdout={p['stdout']!r}")
        return "\n".join(lines)
    if contract.get("mismatches"):
        mism = contract["mismatches"]
        if all(m.get("got") == UNCONVERTIBLE for m in mism):
            # Distinct failure: the reference may be fine, we just could not work out the
            # stdin layout its parser wants from the display-form block.
            lines = ["I/O CONTRACT NOT VERIFIED — could not derive the raw stdin the "
                     "reference solution reads from the description's named-variable "
                     "Examples. Check the Input Format against the solution's parser:"]
            for m in mism:
                lines.append(f"    example {m['example']}: block={m['stdin']!r} "
                             f"expected={m['expected']!r} tried={m.get('detail')!r}")
            return "\n".join(lines)
        lines = ["I/O CONTRACT NOT VERIFIED — the reference solution does not reproduce "
                 "the description's own Examples. Testcases built on this will not match "
                 "the platform driver:"]
        for m in mism:
            lines.append(f"    example {m['example']}: stdin={m['stdin']!r} "
                         f"expected={m['expected']!r} got={m.get('got')!r}")
        return "\n".join(lines)
    return f"I/O CONTRACT skipped — {contract.get('reason') or 'no examples available'}."


def _ground_against_reference(out_path: str, optimal_path: str) -> list[dict]:
    """Run the reference solution on every case's `input` and return the cases it
    fails to reproduce (crash/timeout, or stdout != stored `output`). An empty list
    means the whole suite is executable by the real solution."""
    cases = _load_testcases_from(out_path)
    timeout = _grounding_timeout_sec()
    failures: list[dict] = []
    for tc in cases:
        inp = tc.get("input", "") or ""
        expected = _normalize_output(tc.get("output", ""))
        got, status = _run_reference_on_input(optimal_path, inp, timeout)
        if status != "ok":
            failures.append({"order": tc.get("order"), "input": inp,
                             "expected": expected, "got": f"<{status}>",
                             "detail": _normalize_output(got)[:300]})
        elif _normalize_output(got) != expected:
            failures.append({"order": tc.get("order"), "input": inp,
                             "expected": expected, "got": _normalize_output(got)[:300],
                             "detail": ""})
    return failures


def _format_grounding_failures(failures: list[dict], limit: int = 12) -> str:
    lines = []
    for f in failures[:limit]:
        lines.append(
            f"- case order={f.get('order')}:\n"
            f"    input   : {f.get('input')!r}\n"
            f"    expected: {f.get('expected')!r}\n"
            f"    got     : {f.get('got')!r}"
            + (f"  ({f['detail']!r})" if f.get("detail") else "")
        )
    extra = len(failures) - limit
    if extra > 0:
        lines.append(f"- ... and {extra} more failing case(s).")
    return "\n".join(lines)


def _repair_from_grounding(script_path: str, out_path: str, optimal_solution: str,
                           failures: list[dict]) -> bool:
    """One LLM repair round: tell the model the reference solution could NOT read the
    generated inputs, show the failing cases + the solution, and regenerate the script.
    Returns True only if the regenerated script ran and produced a fresh testcases.json."""
    import shutil

    with open(script_path, "r", encoding="utf-8") as f:
        current_script = f.read()

    backup = out_path + ".groundbak"
    had_backup = False
    try:
        shutil.copyfile(out_path, backup)
        had_backup = True
    except OSError:
        backup = None

    def _degrade(reason: str) -> bool:
        print(f"Grounding repair: {reason} — keeping previous suite.")
        if had_backup:
            try:
                shutil.copyfile(backup, out_path)
            except OSError:
                pass
        _cleanup(backup)
        return False

    retry_system = _repair_system_prompt(
        "You are a Python expert fixing a test-case generator script. The generated `input` "
        "strings are in the WRONG FORMAT: when piped to the reference solution on STANDARD INPUT, "
        "the solution crashes or prints a different answer than the stored `output`. The reference "
        "solution's stdin parser is the SOURCE OF TRUTH — study exactly how it reads sys.stdin and "
        "regenerate every `input` in that EXACT raw stdin layout (size/count line, then space-separated "
        "data line(s); a bracketed level-order line for tree/linked-list inputs). Do NOT use `name = value` "
        "assignments or Python literals the solution does not parse. Set each `output` to what the reference "
        "solution PRINTS to stdout for that input. Keep the same JSON shape, tags, weightage and scoring "
        "behavior. "
        "OUTPUT HYGIENE (CRITICAL): your entire response is written verbatim to a .py file and executed. "
        "First character MUST be valid Python (import/#/from); no preamble, no sign-off, no markdown fences."
    )
    retry_user = (
        "The REFERENCE SOLUTION (the source of truth for the input format) is:\n\n"
        f"```python\n{optimal_solution}\n```\n\n"
        "Feeding the generated inputs to this solution on stdin produced these failures:\n\n"
        f"{_format_grounding_failures(failures)}\n\n"
        "Here is the current generator script to fix:\n\n"
        f"```python\n{current_script}\n```\n\n"
        "Return ONLY the corrected generator script."
    )
    try:
        content, usage = call_llm(retry_system, retry_user, purpose="testcases_grounding_fix")
        content = _sanitize_generated_script(content)
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(content)
        update_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            "testcase_generation_grounding_fix",
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
    """Max LLM-regeneration rounds for size diversity (default 0 = disabled).

    Each round is one extra LLM call + script run (`testcase_generation_size_fix`),
    which fired on nearly every suite and dominated testcase cost, so it is OFF by
    default. Re-enable per-run with TESTCASE_SIZE_FIX_ROUNDS=1 (or higher).
    """
    raw = os.environ.get("TESTCASE_SIZE_FIX_ROUNDS", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 0


def _print_size_audit(audit: dict, prefix: str = "Size distribution") -> None:
    realized = audit.get("realized", {})
    order = ("edge", "small", "medium", "large")
    parts = [f"{b} {realized.get(b, 0.0)}%" for b in order]
    print(f"{prefix}: " + ", ".join(parts) + f"  (n={audit.get('total', 0)})")


def _reformat_and_audit(out_path: str, description: str, io_contract=None) -> dict:
    """Load the suite, sync size + subtask tags, reorder, save, and return a size audit."""
    with open(out_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Repair the mechanical contract FIRST (dupes, missing keys, weights, order) so the
    # generator never has to assert these — and record what it got wrong.
    compliance = repair_suite_json_root(data)
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
    # Force the public example cases (order 1 & 2) to match description Examples 1 & 2
    # exactly and tag them `example`. Mutates the case dicts in place (they are the same
    # objects inside `data`), so the changes persist when `data` is written below.
    examples_fixed = sync_example_testcases(tcs, description, io_contract) if tcs else 0
    # Reorder AFTER subtask tags exist so the subtask-aware sort applies.
    did_reorder = reorder_testcases_json_root(data)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    # Shape check on the TEXT. Grounding cannot catch this class: if the reference
    # solution of the moment also parses the literal form, a literal suite grounds
    # clean and then scores 0/150 against the real driver (T primes, 2026-07-29).
    io_shape = format_io_shape(audit_io_shape(tcs, description)) if tcs else ""
    if io_shape:
        print(f"WARNING: {io_shape}")
    violations = format_compliance(compliance)
    if violations:
        # Named, not silent: this line is the evidence for which prompt rules to keep.
        print(f"Contract auto-repaired (model did not comply): {violations}")
    else:
        print("Contract compliance: clean (no mechanical repairs needed).")
    if tags_fixed:
        print(f"Corrected size_* tags on {tags_fixed} case(s) from derived input sizes.")
    if subtasks_fixed:
        print(f"Assigned subtask tags on {subtasks_fixed} case(s) (generator emitted none/invalid).")
    if examples_fixed:
        print(f"Synced {examples_fixed} public example case(s) from description Examples 1 & 2.")
    if did_reorder:
        if has_subtask_tags(tcs):
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
    system_prompt = _repair_system_prompt(system_prompt)
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
    from Prompts.testcasesprompt_v4 import POOL_TARGET_MIN, POOL_TARGET_MAX, CASE_CAP
    num_testcases = args.count
    if num_testcases is not None:
        num_testcases = max(num_testcases, MIN_TESTCASES)
        print(f"Target test case count: {num_testcases} (minimum {MIN_TESTCASES})")
    else:
        print(f"No explicit count; target scales by difficulty x type (minimum {MIN_TESTCASES}).")
    print(f"Over-generate mode: aiming for a ~{POOL_TARGET_MIN}-{POOL_TARGET_MAX} candidate "
          f"POOL — the select_testcases step later dedups and trims to {CASE_CAP}.")

    problem_type = (args.type or detect_problem_type(description)).strip().lower()
    print(f"Problem type (for count scaling): {problem_type}")

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
    print(f"I/O format: {'function (raw stdin the solution parses)' if is_function else 'STDIN/STDOUT'}"
          + (f"; params={signature_params}" if signature_params else ""))

    # 4b. CHECKPOINT — freeze and verify the I/O contract before generating anything.
    #     Two subprocess runs; catches a description/solution disagreement here rather
    #     than as a 0/150 execute_tests result three steps later.
    io_contract = verify_io_contract(description, optimal_path)
    print(format_io_contract(io_contract))

    # 5. Prompt
    system_prompt, user_prompt = get_testcases_prompt(
        description,
        optimal_solution,
        total_score,
        brute_force_code=brute_solution,
        num_testcases=num_testcases,
        difficulty=difficulty,
        problem_type=problem_type,
        is_function=is_function,
        signature_params=signature_params,
        io_contract=io_contract,
    )
    # Repair calls (crash-retry, grounding-fix, size-fix) reuse this so they keep the
    # same contract instead of shipping a bare "fix this script" instruction.
    global _PRIMARY_SYSTEM_PROMPT
    _PRIMARY_SYSTEM_PROMPT = system_prompt

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
            audit = _reformat_and_audit(out_path, description, io_contract)
            _print_size_audit(audit, "Realized size distribution")
            # A pool far above target means the script enumerated its input space
            # instead of sampling it (e.g. `for N in range(1, MAX_N + 1)`). Harmless
            # for correctness — select_testcases caps the suite — but the kill and
            # mutation phases then run over thousands of cases, so name it here
            # instead of leaving it to be discovered in the select log.
            pool_n = audit.get("total", 0)
            if pool_n > 3 * POOL_TARGET_MAX:
                print(f"WARNING: generator produced {pool_n} cases for a "
                      f"~{POOL_TARGET_MIN}-{POOL_TARGET_MAX} target pool — it likely "
                      f"enumerated the input space rather than sampling it. "
                      f"select_testcases will trim to {CASE_CAP}.")
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
                audit = _reformat_and_audit(out_path, description, io_contract)
                _print_size_audit(audit, f"After size-fix round {attempt}")
            if audit["ok"]:
                print("Size distribution within tolerance of targets.")
            else:
                print("WARNING: size distribution still off-target after regeneration. "
                      "The coverage-shape gate (B3) may flag this and mutation testing "
                      "may stay weak — large/edge buckets need constraint-scaled inputs.")
        except Exception as e:
            print(f"Warning: could not reformat/audit testcases.json: {e}")

        # 10. Grounding — the suite is only valid if the REFERENCE SOLUTION can read
        #     every `input` on stdin and print the stored `output` (that is exactly how
        #     benchmark_testcases / harden_testcases run it). Repair once on failure, then
        #     fail loudly rather than shipping a suite the solution can't execute.
        if os.environ.get("TESTCASE_SKIP_GROUNDING", "").strip() in ("1", "true", "yes"):
            print("Grounding skipped (TESTCASE_SKIP_GROUNDING set).")
        else:
            failures = _ground_against_reference(out_path, optimal_path)
            if failures:
                print(
                    f"Grounding: reference solution could not reproduce {len(failures)} "
                    f"case(s) — input format drift. Attempting one repair:\n"
                    f"{_format_grounding_failures(failures)}"
                )
                repaired = _repair_from_grounding(
                    output_script_path, out_path, optimal_solution, failures
                )
                if repaired:
                    _reformat_and_audit(out_path, description, io_contract)
                    failures = _ground_against_reference(out_path, optimal_path)
                if failures:
                    print(
                        f"ERROR: {len(failures)} case(s) still fail against the reference "
                        "solution after repair. The generated inputs do not match the "
                        "solution's stdin format; refusing to ship a broken suite.\n"
                        f"{_format_grounding_failures(failures)}"
                    )
                    sys.exit(1)
                print("Grounding passed after repair: reference solution reproduces all cases.")
            else:
                print("Grounding passed: reference solution reproduces every case's output.")

    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)


if __name__ == "__main__":
    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root_dir)
    main()
