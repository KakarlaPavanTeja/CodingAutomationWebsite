"""Author-time problem flags, written once by the description step.

`open_ended` says the problem legitimately admits more than one correct answer. It
replaces `is_open_ended_problem`, a prose regex that matched the phrasing a description
MUST use when it DOES pin an answer down ("if there are multiple ... return the smallest
first index") and so switched real checks off on the descriptions that followed the rules
best. Nothing downstream may re-derive this from text: read the flag.
"""

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
