"""Author-time problem flags, written once by the description step.

`open_ended` says the problem legitimately admits more than one correct answer. It
replaces `is_open_ended_problem`, a prose regex that matched the phrasing a description
MUST use when it DOES pin an answer down ("if there are multiple ... return the smallest
first index") and so switched real checks off on the descriptions that followed the rules
best. Nothing downstream may re-derive this from text: read the flag.
"""

import ast
import json
import os
import re

FLAGS_FILENAME = "problem_flags.json"

# The model appends this as an HTML comment so it is invisible in rendered markdown even
# if a strip ever regresses. `reason` is free text and runs to the end of the comment.
OPEN_ENDED_MARKER_RE = re.compile(
    r"<!--\s*OPEN_ENDED\s*:\s*(true|false)\s*(?:reason\s*=\s*(.*?))?\s*-->",
    re.IGNORECASE | re.DOTALL,
)


def split_open_ended_marker(text):
    """Return (description without any marker, open_ended, reason).

    Last marker wins — the model occasionally echoes the example marker mid-answer, and
    the decision is the one it ends on. Absent marker means NOT open-ended: a missing
    decision must never silently enable the lenient path.
    """
    body = text or ""
    matches = list(OPEN_ENDED_MARKER_RE.finditer(body))
    if not matches:
        return body.strip(), False, ""
    last = matches[-1]
    open_ended = last.group(1).strip().lower() == "true"
    reason = (last.group(2) or "").strip()
    return OPEN_ENDED_MARKER_RE.sub("", body).strip(), open_ended, reason


def save_problem_flags(open_ended, reason, outputs_dir):
    flags = {"open_ended": bool(open_ended), "reason": str(reason or "")}
    os.makedirs(outputs_dir, exist_ok=True)
    with open(os.path.join(outputs_dir, FLAGS_FILENAME), "w", encoding="utf-8") as f:
        json.dump(flags, f, indent=4, ensure_ascii=False)
    return flags


def load_open_ended(outputs_dir="Outputs"):
    """False on a missing or unreadable file — never guess open-ended."""
    try:
        with open(os.path.join(outputs_dir, FLAGS_FILENAME), encoding="utf-8") as f:
            return bool(json.load(f).get("open_ended", False))
    except (OSError, ValueError, AttributeError):
        return False


CHECKER_NAMES = ("reference_answer", "is_valid_answer")
CHECKER_ARITY = {"reference_answer": 1, "is_valid_answer": 2}


def checker_defects(source):
    """Static defects in an open-ended checker. Empty list means it is well-formed.

    Every defect here fails SILENTLY at grading time, which is why it is a static gate and
    not a runtime hope: a checker nested in `solution` is shadowed by the student's class,
    and a `reference_answer` that delegates to `solution` grades every student against
    their own answer.
    """
    try:
        tree = ast.parse(source or "")
    except SyntaxError as e:
        return [f"the source does not parse ({e})"]

    top = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    nested = {n.name for cls in tree.body if isinstance(cls, ast.ClassDef)
              for n in cls.body if isinstance(n, ast.FunctionDef)}

    defects = []
    for name in CHECKER_NAMES:
        if name in top:
            args = top[name].args
            want = CHECKER_ARITY[name]
            got = len(args.args) + len(args.posonlyargs)
            if got != want:
                defects.append(f"{name} takes {got} argument(s), expected {want}")
        elif name in nested:
            defects.append(f"{name} must be module-level, not a method of a class — the "
                           f"driver imports the STUDENT's `solution`")
        else:
            defects.append(f"{name} is missing")

    ref = top.get("reference_answer")
    if ref is not None:
        for node in ast.walk(ref):
            if isinstance(node, ast.Name) and node.id == "solution":
                defects.append("reference_answer must be self-contained — it references "
                               "`solution`, which is the STUDENT's class at grading time")
                break
    return defects
