from __future__ import annotations

import json
import re
import os
import shutil
import sys
import subprocess
import argparse

# Ensure the Scripts directory is in the path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.testcasesprompt_v4 import (
    COUNT_BAND_BY_DIFFICULTY,
    MIN_TESTCASES,
    get_testcases_prompt,
)
from llm_client import apply_testcases_routing, call_llm, resolve_pipeline_difficulty
from usage_tracker import update_usage
from open_ended_checker import accepts, load_checker
from problem_flags import load_open_ended
from testcase_helpers import (
    audit_io_shape,
    format_io_shape,
    multi_answer_defects,
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


# Ordering is derived, not repaired: `derive_and_normalize` renumbers `order` after the
# subtask groups are ranked by demand, so the suite ships in ascending-demand order.


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


_IO_LAYOUT_SYSTEM = (
    "You convert a problem statement's worked Example into the RAW STDIN a solver's "
    "program reads. "
    "The statement's declared I/O FORMAT is the shape you must produce — it is what the "
    "student is told the input looks like, so the graded stdin has to match it: the same "
    "lines, in the same order, with the same separators. Take the VALUES from the "
    "Example (which may be shown as `name = value` display assignments) and the SHAPE "
    "from the I/O format. "
    "Where the declared format is silent or ambiguous, the reference solution's own "
    "stdin parser decides — read how it consumes stdin (usually a size/count line, then "
    "space-separated data line(s); a bracketed level-order line for tree/linked-list "
    "inputs). "
    "Return ONLY the stdin text. No explanation, no markdown fences, no `name = value` "
    "assignments. End with a trailing newline."
)


def _named_section(description: str, title: str) -> str:
    """The body of a `**Title**` / `## Title` section of the description, or "".

    The description format marks sections with bold titles on their own line; the
    section ends at the next such title. Used to hand the conversion model the layout
    the statement PROMISES rather than letting it infer one from the parser alone."""
    lines = (description or "").splitlines()
    want = title.strip().lower()
    head = re.compile(r"^\s*(?:\*\*\s*(?P<b>[^*]+?)\s*\*\*|#{1,6}\s*(?P<h>.+?))\s*:?\s*$")
    out, collecting = [], False
    for ln in lines:
        m = head.match(ln)
        name = ((m.group("b") or m.group("h")) if m else "") or ""
        if m and name.strip().lower() == want:
            collecting = True
            continue
        if collecting and m:
            break
        if collecting:
            out.append(ln)
    return "\n".join(out).strip()


def _declared_io_format(description: str) -> str:
    """The Input/Output Format sections, formatted for the conversion prompt."""
    parts = []
    for title in ("Input Format", "Output Format"):
        body = _named_section(description, title)
        if body:
            parts.append(f"{title}:\n{body}")
    return "\n\n".join(parts)


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        nl = t.find("\n")
        t = t[nl + 1:] if nl != -1 else t[3:]
    if t.rstrip().endswith("```"):
        t = t.rstrip()[:-3]
    t = t.strip("\n")
    return t + "\n" if t else ""


def resolve_example_stdin(optimal_path, block, expected, timeout, llm=None,
                          io_format=""):
    """Convert one display-form example block into the raw stdin the reference reads.

    The statement's own **Input Format** is the layout a student is told to expect, so
    it is what the graded stdin must look like — a layout that merely happens to parse
    is not good enough. The model therefore goes FIRST, given that declared format plus
    the reference's parser, and proposes one layout; a mismatch buys exactly one
    INFORMED retry that sees its own layout, what it printed, and what was expected.

    The mechanical serializations of the block are kept as a FALLBACK. They cost
    nothing and, crucially, still resolve the contract when no API key is configured —
    without them an LLM-only conversion would leave every function-type problem
    unverified on a machine with no model access.

    Both stages are held to the same standard: a layout is accepted only when the
    reference reproduces the stated answer. Execution decides, never the proposer.

    Returns (stdin, reference_stdout, detail); stdin is None when unresolved.
    """
    from benchmark_suite import display_value_tokens, named_var_stdin_candidates

    if llm is None:
        llm = call_llm
    try:
        with open(optimal_path, "r", encoding="utf-8") as f:
            solution = f.read()
    except OSError as e:
        return None, None, f"could not read the reference solution ({e})"

    want = display_value_tokens(expected)
    tried: list[str] = []

    def _accepts(candidate):
        """(stdout, None) when the reference reproduces the stated answer, else
        (None, note). Appends the failed attempt to `tried` either way."""
        got, status = _run_reference_on_input(optimal_path, candidate, timeout)
        if status != "ok":
            tried.append(f"{candidate!r} -> <{status}>")
            return None, f"<{status}>"
        got = _normalize_output(got)
        if display_value_tokens(got) == want:
            return got, None
        tried.append(f"{candidate!r} -> {got[:60]!r}")
        return None, got

    user = (
        (f"THE STATEMENT'S DECLARED I/O FORMAT (the layout the student is shown — "
         f"reproduce it):\n{io_format}\n\n" if io_format else "")
        + f"REFERENCE SOLUTION (its stdin parser decides anything the format leaves open):"
        f"\n\n```python\n{solution}\n```\n\n"
        f"EXAMPLE from the problem statement:\n{block}\n\n"
        f"Its stated answer is: {expected}\n\n"
        f"Return the raw stdin that makes this solution print that answer."
    )
    for attempt in (1, 2):
        try:
            content, usage = llm(_IO_LAYOUT_SYSTEM, user, purpose="io_contract_layout")
        except Exception as e:
            # No API key or the provider is down: fall through to the free layouts
            # rather than failing the whole contract.
            tried.append(f"LLM call failed ({e})")
            break
        if usage:
            update_usage(
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                "io_contract_layout", model=usage.get("model", "unknown"),
                purpose="testcases", step_id="generate_testcases",
                cost=usage.get("cost", 0.0),
            )
        candidate = _strip_fences(content)
        stdout, shown = _accepts(candidate)
        if stdout is not None:
            return candidate, stdout, None
        if attempt == 1:
            user += (
                f"\n\nYour layout {candidate!r} was WRONG. The solution printed "
                f"{shown!r} but the stated answer is {expected!r}. "
                f"Re-read the parser and return a corrected stdin."
            )

    # Fallback: mechanical serializations of the block. Free, and the only path that
    # works with no model access.
    for candidate in named_var_stdin_candidates(block):
        stdout, _ = _accepts(candidate)
        if stdout is not None:
            return candidate, stdout, None

    return None, None, "; ".join(tried)


def verify_io_contract(description: str, optimal_path: str, outputs_dir: str = "Outputs",
                       llm=None) -> dict:
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
    "skipped" for every function problem. Those blocks are now CONVERTED: a small model
    is handed the statement's own **Input Format** / **Output Format** plus the reference
    solution and proposes one stdin layout, which is accepted only if the reference
    reproduces the stated answer — so the frozen contract is the layout the student was
    shown, not merely one that happens to parse. `llm` is injectable for tests;
    production uses `call_llm`.

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
    io_format = _declared_io_format(description)
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
        stdin_str, stdout, detail = resolve_example_stdin(
            optimal_path, block, out, timeout, llm=llm, io_format=io_format)
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


def enforce_io_contract(contract: dict) -> None:
    """Exit unless the contract verified. Called from main() right after the report.

    BLOCKING, where this used to be advisory: the verdict printed and generation carried
    on, so "NOT VERIFIED" scrolled past in a long log and a whole suite got built on a
    description and a reference that disagree — surfacing three steps later as 0/150 in
    execute_tests. It is the cheapest gate in the pipeline (two subprocess runs) and the
    defect it catches is a two-minute fix at this point.

    A separate function, not an inline `if`, so it can be tested without a subprocess: the
    module imports llm_client at load time, so exercising main() end to end needs the
    pipeline's own interpreter and would simply skip everywhere else.
    """
    if contract.get("verified"):
        return
    print("\nAborting: the I/O contract must be verified before any test case is "
          "generated. Every expected output would otherwise be built on a description "
          "and a reference solution that do not agree.")
    print("Fix one of the two — the report above shows which side printed what — then "
          "re-run this step.")
    sys.exit(1)


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
    means the whole suite is executable by the real solution.

    A multi-answer case has no single `output`; the equivalent check is that the
    reference's own answer is a MEMBER of the enumerated `outputs` — if it is not, the
    list is missing at least one valid answer and so is not exhaustive."""
    cases = _load_testcases_from(out_path)
    timeout = _grounding_timeout_sec()
    failures: list[dict] = []
    for tc in cases:
        inp = tc.get("input", "") or ""
        multi = bool(tc.get("multiple_possible_output"))
        allowed = ([_normalize_output(str(o)) for o in (tc.get("outputs") or [])]
                   if multi else None)
        expected = (" | ".join(allowed) if multi
                    else _normalize_output(tc.get("output", "")))
        got, status = _run_reference_on_input(optimal_path, inp, timeout)
        if status != "ok":
            failures.append({"order": tc.get("order"), "input": inp,
                             "expected": expected, "got": f"<{status}>",
                             "detail": _normalize_output(got)[:300]})
        elif multi:
            if _normalize_output(got) not in allowed:
                failures.append({"order": tc.get("order"), "input": inp,
                                 "expected": expected,
                                 "got": _normalize_output(got)[:300],
                                 "detail": "reference answer is not in `outputs`"})
        elif _normalize_output(got) != expected:
            failures.append({"order": tc.get("order"), "input": inp,
                             "expected": expected, "got": _normalize_output(got)[:300],
                             "detail": ""})
    return failures


def _ground_checker(cases: list[dict], checker) -> list[dict]:
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


def derive_and_normalize(out_path: str, description: str, io_contract=None) -> dict:
    """Compute everything the model was never asked for, deterministically.

    dedup -> example sync -> shipping order -> size tags -> subtask numbering + weights.
    Dedup and ordering live here because the selector used to do them and it is gone.

    This replaced a repair step that overrode the model's own claims (size tags, subtask
    tiers, weights). Nothing is overridden now because nothing is claimed: the model owns
    the inputs and their grouping, we own everything computable from them.
    """
    from testcase_helpers import (
        bucket_for_case, case_size_metric, dedupe_tags, derive_subtasks,
        resolve_size_context,
    )
    from testcase_selection import dedup_by_input

    with open(out_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    root = data[0] if isinstance(data, list) and data else data
    generated = len(root.get("test_cases") or [])
    cases = [tc for tc in (root.get("test_cases") or []) if isinstance(tc, dict)]

    # Filter first: dedup_by_input indexes tc["input"] directly, and an inputless case
    # is not a duplicate — it is unusable.
    cases = [tc for tc in cases if str(tc.get("input") or "").strip()]
    unique, duplicates = dedup_by_input(cases)

    kind, max_n = resolve_size_context(root, description, unique)

    # Order, then sync the public examples, and only THEN bucket. `sync_example_testcases`
    # selects cases by `order`, so order must exist first — but it also REWRITES the input
    # of cases 1-2, so bucketing before it would tag those cases from inputs that no longer
    # exist (a synced n=3 example keeping the `size_edge` of the n=1 case it replaced).
    for idx, tc in enumerate(unique, start=1):
        tc["order"] = idx

    examples_fixed = sync_example_testcases(unique, description, io_contract) if unique else 0

    # `is_edge` is the model's claim about the input it originally wrote. The sync just
    # REPLACED that input, so the claim no longer describes anything — and bucket_for_case
    # honours `is_edge` over the measured size, which would keep a synced n=3 example in
    # the `edge` bucket forever. Drop the stale claim and let the new input decide.
    for tc in unique:
        if "example" in (tc.get("tags") or []):
            tc["is_edge"] = False

    # Now that the examples are tagged, put the suite in shipping order: examples first,
    # then ascending payload size, so a graded run walks small inputs before big ones and
    # the first failure a submission hits is a case a human can read. `write_selected`
    # used to do this; it died with the selector.
    from testcase_annotate import ship_order

    unique = ship_order(unique)
    for idx, tc in enumerate(unique, start=1):
        tc["order"] = idx

    buckets: dict = {}
    for tc in unique:
        bucket = bucket_for_case(tc, max_n, kind)
        if bucket:
            # None means the problem has no size dimension — leave the tags alone
            # rather than stamping a `size_None` the B3 gate cannot read.
            buckets[bucket] = buckets.get(bucket, 0) + 1
            tc["tags"] = dedupe_tags(
                [t for t in (tc.get("tags") or []) if not str(t).startswith("size_")]
                + [f"size_{bucket}"]
            )
        # Recomputed unconditionally, not just when absent: a synced example's stored
        # size_metric describes the input it had BEFORE the sync replaced it.
        tc["size_metric"] = case_size_metric(tc, kind, max_n) or 0

    subtask_names = derive_subtasks(unique, kind, max_n)

    root["test_cases"] = unique
    root["subtask_names"] = subtask_names
    if str(root.get("space_mode") or "").strip().lower() == "exhaustive":
        root["suite_complete"] = True
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

    # Shape check on the TEXT. Grounding cannot catch this class: if the reference
    # solution of the moment also parses the literal form, a literal suite grounds
    # clean and then scores 0/150 against the real driver (T primes, 2026-07-29).
    io_shape = format_io_shape(audit_io_shape(unique, description)) if unique else ""
    if io_shape:
        # BLOCKS. It used to warn, and on 2026-08-18 that warning was the only correct
        # signal in the room: the I/O contract verified, grounding passed and the checker
        # grounded clean on all 120 cases, because the reference, the cases and the
        # contract all agreed on the description's `name = value` display form. Every
        # execution-based check was self-consistently wrong and the suite would have scored
        # zero. `audit_io_shape` already exempts problems whose description genuinely
        # sanctions literal input, so this cannot fire on a legitimate JSON-input problem.
        print(f"ERROR: {io_shape}")
        print("      Refusing to ship: the platform driver writes raw tokens, so every "
              "case here would fail. Fix the reference's stdin parsing and re-run.")
        raise SystemExit(1)

    # `generated` is what the script emitted; kept + duplicates does NOT recover it,
    # because inputless cases are filtered out above and would vanish from the log.
    return {"generated": generated, "kept": len(unique), "duplicates": duplicates,
            "buckets": buckets, "subtask_names": subtask_names,
            "examples_synced": examples_fixed}


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser(description="Generate LeetCode-grade test cases (v4)")
    parser.add_argument("--count", type=int, default=None,
                        help=f"Exact case count (minimum {MIN_TESTCASES}; "
                             f"default is the difficulty's count band)")
    args = parser.parse_args()

    print("=== GENERATE TEST CASES ===")

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

    # 3. Difficulty (owner-set is FINAL, else LLM-generated file). It routes the model
    #    and picks the count band — it no longer buys a total score to divide up, since
    #    weights are derived per subtask group from the cases themselves.
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
        print(f"Owner-set score: {owner_score} (the platform scales the derived "
              f"per-subtask weights to it).")
    if not difficulty:
        print("Warning: no owner difficulty and generated_difficulty.txt not found.")

    routing = apply_testcases_routing(difficulty)
    effective = difficulty or routing["tier"]
    source_label = {
        "owner": "owner",
        "llm": "llm",
        "default": "default→medium",
    }.get(difficulty_source, difficulty_source)

    # 4. Count. There is no selector downstream, so what the generator emits is what
    #    ships: an owner count is an exact target, otherwise the difficulty's band.
    num_testcases = args.count
    if num_testcases is not None:
        num_testcases = max(num_testcases, MIN_TESTCASES)
        count_label = f"exactly {num_testcases}"
    else:
        lo, hi = COUNT_BAND_BY_DIFFICULTY.get(
            str(difficulty or "medium").strip().lower(),
            COUNT_BAND_BY_DIFFICULTY["medium"])
        count_label = f"{lo}-{hi} cases"

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
    print(f"      difficulty={effective} ({source_label})  ·  target {count_label}  ·  "
          f"I/O: {'function (raw stdin)' if is_function else 'STDIN/STDOUT'}"
          + (f" params={signature_params}" if signature_params else ""))
    print(f"      model={routing['model']}@{routing['effort']}  ·  "
          f"fallbacks=[{routing['fallbacks_display']}]")

    # 4b. CHECKPOINT — freeze and verify the I/O contract before generating anything.
    #     Two subprocess runs; catches a description/solution disagreement here rather
    #     than as a 0/150 execute_tests result three steps later.
    io_contract = verify_io_contract(description, optimal_path)
    print(format_io_contract(io_contract))
    enforce_io_contract(io_contract)

    # 5. Prompt
    open_ended = load_open_ended("Outputs")
    if open_ended and not is_function:
        print("      open-ended, non-function: cases must enumerate every valid answer.")
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
    # Repair calls (crash-retry, grounding-fix) reuse this so they keep the same
    # contract instead of shipping a bare "fix this script" instruction.
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

        # 9. Derive everything the model was never asked for: dedup, size tags,
        #    subtask numbering + weights, order, public examples. Deterministic, no LLM
        #    — the size-fix regeneration loop this replaced spent an LLM call per suite
        #    to argue with the model about a distribution we can just compute.
        try:
            report = derive_and_normalize(out_path, description, io_contract)
            blank = report["generated"] - report["kept"] - report["duplicates"]
            print(f"Derived: {report['generated']} generated → {report['kept']} case(s) "
                  f"ship (removed {report['duplicates']} duplicate(s)"
                  + (f", {blank} with no input" if blank else "") + ")")
            print("      size buckets   " + " · ".join(
                f"{b} {report['buckets'].get(b, 0)}"
                for b in ("edge", "small", "medium", "large")))

            # Re-read what actually shipped so the subtask table reports the file on
            # disk, not our expectation of it.
            with open(out_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            shipped_root = data[0] if isinstance(data, list) and data else data
            counts, weights = {}, {}
            for tc in shipped_root.get("test_cases") or []:
                for t in tc.get("tags") or []:
                    if str(t).startswith("subtask_"):
                        counts[t] = counts.get(t, 0) + 1
                        weights[t] = tc.get("weightage")
            names = report["subtask_names"]
            print(f"      subtasks ({len(names)}, ordered by demand):")
            for enum in sorted(names, key=lambda e: int(str(e).rsplit("_", 1)[-1])):
                print(f"        {enum:<12} {names[enum]:<28} {counts.get(enum, 0):>3} cases"
                      f"   weight {weights.get(enum)}")

            if report["examples_synced"]:
                print(f"      {report['examples_synced']} public example case(s) synced "
                      f"from the description")
            if shipped_root.get("suite_complete"):
                print(f"      space=exhaustive — the whole legal input space is "
                      f"{report['kept']} case(s); shipped complete")
            elif report["kept"] < MIN_TESTCASES:
                print(f"WARNING: only {report['kept']} case(s) shipped — below the "
                      f"{MIN_TESTCASES} floor the B3 gate enforces.")
        except Exception as e:
            print(f"Warning: could not derive/normalize testcases.json: {e}")

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
                    # The repair regenerated the suite from scratch, so it carries none
                    # of the derived fields — derive them again before re-grounding.
                    derive_and_normalize(out_path, description, io_contract)
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

            # 10b. The same suite, run the way the DRIVER will run it. Grounding above ran
            #      the reference as a program, so its stdout matches by construction; what
            #      nobody has exercised is the checker the driver actually calls. A
            #      `reference_answer` that disagrees with a stored output fails that case
            #      for every student including a perfect one — and cases 1-2 come from the
            #      description's worked examples, so that is exactly where a statement /
            #      checker disagreement hides. Not repairable by _repair_from_grounding:
            #      the defect is in the naming step's output, not in the generator script.
            if open_ended and is_function:
                checker = load_checker(optimal_path)
                if checker is None:
                    print("ERROR: this problem is flagged open_ended but the reference "
                          "exposes no reference_answer/is_valid_answer. Re-run the naming "
                          "step.")
                    sys.exit(1)
                cases = _load_testcases_from(out_path)
                checker_failures = _ground_checker(cases, checker)
                if checker_failures:
                    print("ERROR: CHECKER GROUNDING FAILED — the reference does not "
                          "reproduce its own stored outputs through the driver:")
                    print(_format_grounding_failures(checker_failures))
                    sys.exit(1)
                print(f"✓ Checker grounded on {len(cases)} case(s).")

        # 11. Multi-answer gate. A stored `outputs` list that is not exhaustive, or that
        #     omits the answer the statement itself prints, marks correct submissions
        #     wrong — which is the exact bug the open-ended design exists to remove. It
        #     is invisible at runtime, so refuse to ship instead.
        if open_ended and not is_function:
            defects = multi_answer_defects(_load_testcases_from(out_path), description)
            if defects:
                print("ERROR: the multi-answer suite is not shippable:")
                for d in defects:
                    print(f"  - {d}")
                sys.exit(1)

    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)


if __name__ == "__main__":
    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root_dir)
    main()
