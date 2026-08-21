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
# THE CHECKER IN THE OTHER THREE LANGUAGES.
# --------------------------------------------------------------------------- #
# The reference is always Python, so `checker_defects` above parses it with `ast`. C++,
# Java and Node.js get their checker by TRANSLATION (conversionPrompt) and it is then
# relocated into the driver (splittingPrompt). Neither step can be gated with `ast`, so the
# contract is pinned here as the exact declaration each prompt mandates, and both the
# conversion step and the split gate read this one table. Change a declaration in a prompt
# and you must change it here, or the gate stops matching what you asked for.
CHECKER_DECLS = {
    "Python": {
        "reference_answer": r"def\s+reference_answer\s*\(",
        "is_valid_answer": r"def\s+is_valid_answer\s*\(",
    },
    "C++": {
        "referenceAnswer": r"string\s+referenceAnswer\s*\(",
        "isValidAnswer": r"bool\s+isValidAnswer\s*\(",
    },
    "Java": {
        "referenceAnswer": r"static\s+String\s+referenceAnswer\s*\(",
        "isValidAnswer": r"static\s+boolean\s+isValidAnswer\s*\(",
    },
    "Node.js": {
        "referenceAnswer": r"function\s+referenceAnswer\s*\(",
        "isValidAnswer": r"function\s+isValidAnswer\s*\(",
    },
}

# The driver's measured window, per language: the checker must run AFTER it closes or the
# student's reported runtime includes the grader's work. Same template lines the splitting
# prompt hands the model, so a template rename breaks the gate loudly here.
CHECKER_TIMING_WINDOW = {
    "Python": ("start_time_ns", "end_time_ns"),
    "C++": ("start = high_resolution_clock", "stop = high_resolution_clock"),
    "Java": ("start_time = System.nanoTime", "end_time = System.nanoTime"),
    "Node.js": ("startTime = process.hrtime", "endTime = process.hrtime"),
}


def translated_checker_defects(language, source):
    """Defects in a TRANSLATED checker. Empty list means both functions are declared.

    Presence only. Whether the ported logic still accepts the same set of answers is not a
    static question — `validate_solutions` answers it by running the suite, and every
    testcase's stored answer came from the Python `reference_answer`, so a translation that
    drifted shows up there as a failing case.
    """
    decls = CHECKER_DECLS.get(language)
    if not decls:
        return []
    text = source or ""
    return [f"{name} is missing — the {language} translation dropped the checker"
            for name, pattern in decls.items() if not re.search(pattern, text)]


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


# --------------------------------------------------------------------------- #
# THE ENTRY-POINT SIGNATURE. Preserved through the split, enforced statically.
# --------------------------------------------------------------------------- #
# The split step rewrites one working program into default/solution/driver/debugger
# code, and it is free-form enough that the model sometimes RE-DECLARES the entry
# point instead of moving it: on 2026-08-21 a Java split turned
# `solve(int N, int[] arr, int V)` into `solve(int[] arr, int v)` — parameter dropped,
# another re-cased — while Python and C++ kept all three. Nothing caught it, because
# the split writes the DRIVER too: the driver called the same wrong signature, so it
# compiled and every testcase passed. What shipped was a stub whose signature
# disagreed with the description and with the other languages.
#
# So the gate compares the split's signature against the signature it was GIVEN,
# rather than against the description: a preservation check needs no new contract and
# cannot fire on a problem whose reference already differs from its description.

# Commas inside <>, (), [] and {} separate template/generic arguments, not parameters.
def _split_params(param_text):
    parts, depth, current = [], 0, ""
    for ch in param_text:
        if ch in "<([{":
            depth += 1
        elif ch in ">)]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p.strip() for p in parts if p.strip()]


_IDENT_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")


def _param_name(part, language):
    """The parameter's NAME out of one declaration part."""
    # Drop a default value (`n = 0`, `arr = []`) and any Python annotation.
    part = part.split("=")[0]
    if language == "Python":
        part = part.split(":")[0]
    names = _IDENT_RE.findall(part)
    if not names:
        return ""
    # Python/JS declare the bare name; C++/Java put the type first, name last.
    return names[0] if language in ("Python", "Node.js") else names[-1]


def entry_point_params(language, source, function_name):
    """Parameter NAMES of `function_name`'s declaration, or None when not declared.

    The declaration is the FIRST occurrence: a recursive call to the same function can
    only appear inside a body that has already been opened.
    """
    if not (source or "").strip() or not function_name:
        return None
    if language == "Python":
        m = re.search(r"def\s+" + re.escape(function_name) + r"\s*\(", source)
    else:
        m = re.search(r"\b" + re.escape(function_name) + r"\s*\(", source)
    if not m:
        return None

    depth, start = 0, m.end() - 1
    for i in range(start, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                inner = source[start + 1:i]
                break
    else:
        return None

    names = [_param_name(p, language) for p in _split_params(inner)]
    # `self` / `cls` are the receiver, not a parameter of the problem's signature.
    return [n for n in names if n and n not in ("self", "cls")]


def signature_defects(language, function_name, source, split_data):
    """Parts of a split that re-declared the entry point. Empty list means preserved.

    Silent when the source's own signature cannot be read — there is then nothing to
    preserve, and a guess here would fail a split that is fine.
    """
    expected = entry_point_params(language, source, function_name)
    if expected is None:
        return []

    defects = []
    for key in ("solution_code", "default_code"):
        found = entry_point_params(language, (split_data or {}).get(key) or "", function_name)
        if found is None:
            defects.append(f"{key} declares no {function_name}(...) — the split renamed "
                           f"the entry point")
        elif found != expected:
            defects.append(
                f"{key} re-declared the signature: {function_name}"
                f"({', '.join(expected)}) became {function_name}({', '.join(found)})"
            )
    return defects
