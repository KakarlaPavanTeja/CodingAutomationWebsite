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


# --------------------------------------------------------------------------- #
# THE I/O FORMAT. One definition, enforced statically.
# --------------------------------------------------------------------------- #
# stdin is RAW TOKENS — whitespace- and newline-separated values, exactly what the
# platform driver writes to the process. It is NEVER `name = value` assignments.
#
# Function-based descriptions RENDER their examples as assignments (`numCourses = 6`)
# because that reads better for a human. That rendering is a display convenience and
# never the wire format. A reference that parses it is broken in the one way nothing
# downstream can see: on 2026-08-18 a normalized reference split its input on "=", the
# I/O contract asked a model to match that parser, the model proposed the assignment
# form, the reference reproduced the stated answer, and the contract VERIFIED. Grounding
# passed. The checker grounded clean on all 120 cases. Every execution-based check agreed
# with every other one, and the suite would have scored zero on the platform — because all
# three were consistent about a format the driver never sends.
#
# Execution cannot catch this: a self-consistent lie executes perfectly. So it is a static
# gate on the source, plus a blocking text audit on the finished suite.
_ASSIGNMENT_SPLIT_RE = re.compile(r"""\.split\(\s*["']=["']""")


def stdin_parsing_defects(source):
    """Defects in how a reference solution READS stdin. Empty list means well-formed.

    Deliberately narrow: it looks for a split on "=", because that is the single
    signature of a reference that has mistaken the description's display form for the
    wire format, and it has no legitimate use in reading raw tokens.
    """
    text = source or ""
    if not text.strip():
        return []
    defects = []
    if _ASSIGNMENT_SPLIT_RE.search(text):
        defects.append(
            "the reference parses its input by splitting on '=', so it reads the "
            "description's `name = value` DISPLAY form rather than raw stdin. The platform "
            "driver writes raw whitespace-separated tokens; read those with "
            "sys.stdin.read().split() or .splitlines()"
        )
    return defects
