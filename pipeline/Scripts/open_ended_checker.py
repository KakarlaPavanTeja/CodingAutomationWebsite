"""Load an open-ended problem's checker out of the reference source, and apply it.

Everything that needs a verdict — B2, grounding, the optimal-vs-brute cross-check,
`validate_solutions`, non-function enumeration — runs BEFORE `split_code`, so none of them
has a driver to ask. They all ask this module instead, and they all get the same answer the
driver will give at grading time.
"""

import contextlib
import importlib.util
import io
import os
import sys
import uuid

from problem_flags import CHECKER_NAMES


def load_checker(source_path):
    """Import `source_path` and return it if it exposes the checker; else None.

    Never raises: a reference that will not import is simply "no checker", and the caller
    falls back to exact-text comparison — which is strictly the safer failure direction.

    The reference keeps its stdin-reading driver, and nothing requires that driver to sit
    behind an `if __name__ == "__main__"` guard, so importing it can run `sys.stdin.read()`
    and PRINT. stdin is swapped for an empty stream first: unguarded, that read would hang
    the whole pipeline on a terminal or eat the caller's input. stdout is swallowed for the
    same reason — several steps load the checker, and each would otherwise drop the
    reference's own answer into the middle of that step's log.
    """
    if not source_path or not os.path.exists(source_path):
        return None
    original_stdin = sys.stdin
    try:
        name = f"_oe_checker_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(name, source_path)
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        sys.stdin = io.StringIO("")
        with contextlib.redirect_stdout(io.StringIO()):
            spec.loader.exec_module(module)
    except Exception:
        return None
    finally:
        sys.stdin = original_stdin
    if all(callable(getattr(module, n, None)) for n in CHECKER_NAMES):
        return module
    return None


def checker_for(outputs_dir="Outputs"):
    """The problem's checker, or None when it was authored with a single right answer.

    Gated on the author-time flag rather than on whether the import happens to expose the
    names: `load_checker` EXECUTES the reference as a module, and there is no reason to do
    that for a problem that has one answer. Every consumer (kill scoring, the optimal-vs-
    brute sweep, B4, validate_solutions) wants exactly this, so the gate lives here once.
    """
    from problem_flags import load_open_ended

    if not load_open_ended(outputs_dir):
        return None
    return load_checker(os.path.join(outputs_dir, "generatedFullCode", "PYTHON.py"))


def accepts(checker, stdin_text, candidate_stdout):
    """True only when the checker explicitly accepts. A checker that raises REJECTS —
    silently accepting on error would mark every wrong answer correct."""
    if checker is None:
        return False
    try:
        return bool(checker.is_valid_answer(stdin_text, candidate_stdout))
    except Exception:
        return False


def effective_output(checker, stdin_text, got, stored):
    """What the driver's Output Area would print for `got`.

    Valid  -> the reference's answer, which IS the stored output, so it matches and passes.
    Invalid-> the candidate's OWN output, so it mismatches and fails, and whoever reads the
              failure sees what was actually produced. The driver never prints a verdict:
              a verdict hides the one thing needed to debug.
    """
    return stored if accepts(checker, stdin_text, got) else got
