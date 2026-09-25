"""
Revision Notes generator — runs after Generate Editorial (Editorial tab).

Turns Outputs/editorial.md into Outputs/revision_notes.json: the data behind the
handwritten sticky-notes revision images (rendered by the web app, see
src/lib/revision-notes/). Approach pages hold one note per editorial solution;
the "cheat corner" page holds complexity at a glance, a dry run, pattern cues,
edge cases and pitfalls.

FAITHFUL TO THE EDITORIAL — by construction, not by prompt:
  - Exactly one note per editorial solution, in editorial order. A reply that
    skips, merges, reorders or invents a solution is a structural error.
  - Technique name, TC and SC are copied FROM THE EDITORIAL by this script,
    never written by the LLM:
      name    ← the solution heading ("## Solution 2: Two Pointers")
      tc / sc ← the backticked value on the "Time/Space Complexity" line.
  - Instead of pseudocode each note has 2–5 numbered CODE STEPS: short
    revision cues, ≤ 70 characters each, written from that solution's editorial
    pseudocode (handed to the LLM with comments and braces stripped by
    compact_pseudocode). Every code name in a step (`seen_subsets`,
    `awarded[i]`, `push_back()`) must appear in THAT solution's editorial
    pseudocode, and the independent reviewer model confirms the steps cover
    every step that affects the result. Failures get a focused per-solution
    rewrite (fix_steps).
  - Labels (Brute / Better / Optimal) are assigned from position and TC.
  - Any code-like name in the prose (`ans.back()`, `a[i]`, `left_ptr`) must
    exist in the editorial's pseudocode or code; unknown names trigger the
    retry with the offending names listed.

Any problem triggers ONE retry with the problems fed back. After the retry only
structural problems fail the step; soft issues (lengths, unknown names, dry-run
doubts) are logged as warnings (the reviewer can edit every field).

Token usage + cost are recorded like every other LLM step.
"""

import json
import os
import re

from editorial_manager import load_file, resolve_short_title
from llm_client import call_llm
from usage_tracker import update_usage as track_usage
from Prompts.revisionNotesPrompt import (
    REVISION_NOTES_PROMPT,
    STEPS_FAITHFUL_PROMPT,
    STEPS_PROMPT,
    build_steps_faithful_message,
    build_steps_message,
    build_user_message,
)

STEP_ID = "generate_revision_notes"
OUTPUT_NAME = "revision_notes.json"
SCHEMA_VERSION = 2
# Hard ceiling on notes (the renderer puts up to 3 per page). Editorials are
# expected to stay well under it; beyond it the extra solutions are dropped.
MAX_APPROACHES = 8

# Character limits per LLM-written field. Keep in sync with the prompt.
LIMITS = {
    "title": 70,
    "oneLiner": 140,
    "example": 110,
    "intuition": 170,
    "takeaway": 110,
    "step": 70,
    "whyBetter": 150,
    "constraintsHint": 110,
    "tag": 24,
    "listItem": 100,
    "dryRunCell": 28,
    "dryRunResult": 60,
}
MAX_TAGS = 4
# (field, min items, max items) for the cheat-corner bullet lists.
LIST_FIELDS = (("recognize", 1, 3), ("edgeCases", 2, 5), ("pitfalls", 2, 4))
DRY_RUN_MAX_ROWS = 8
DRY_RUN_COLUMNS = (2, 5)

TOP_FIELDS = ("title", "oneLiner", "example")
LLM_APPROACH_FIELDS = ("intuition", "takeaway")

# The numbered code steps drawn on each sticky note.
# They are revision CUES, not a program: short, verb-first, key names only.
# (The prompt asks the brute force to prefer 2–4; a hard lower cap for it kept
# fighting the correctness check on real editorials, so the limit is shared.)
STEPS_MIN = 2
STEPS_MAX = 5

# Descriptive dry-run column names that are not variables.
DRY_RUN_COLUMN_WORDS = {
    "step", "steps", "action", "compare", "comparison", "check", "note", "output",
    "result", "value", "state", "iteration", "iter", "push", "pop", "add", "remove",
    "move", "window", "current", "curr", "cur", "answer", "call", "stack", "queue",
}
# Names that may appear in prose without being editorial variables.
PROSE_NAME_ALLOWLIST = {
    "max", "min", "abs", "len", "size", "length", "sort", "sorted", "swap", "push",
    "pop", "append", "insert", "remove", "erase", "back", "front", "top", "empty",
    "count", "find", "sum", "reverse", "floor", "ceil", "sqrt", "log", "pow", "O",
}


# ---------------------------------------------------------------------------
# Editorial parsing
# ---------------------------------------------------------------------------

_MULTI_LANG_RE = re.compile(r"<MultiLanguageCodeBlock\b[^>]*>[\s\S]*?</MultiLanguageCodeBlock>")
_FENCE_RE = re.compile(r"```([A-Za-z0-9+#._-]*)[ \t]*\n([\s\S]*?)```")
_IDENT_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")


def strip_code_blocks(editorial: str) -> str:
    """Drop the 4-language code blocks: they dominate the token count and the
    LLM never needs them (the pseudocode below carries the same names)."""
    return _MULTI_LANG_RE.sub("[code omitted]", editorial)


def _subsection(body: str, title: str) -> str:
    m = re.search(rf"(?mi)^###[ \t]+{title}\s*$", body)
    if not m:
        return ""
    rest = body[m.end():]
    nxt = re.search(r"(?m)^###[ \t]+", rest)
    return rest[: nxt.start()] if nxt else rest


def _raw_pseudocode(section: str) -> str:
    """The ```pseudocode fence of a Pseudocode subsection (or its first fence)."""
    fences = list(_FENCE_RE.finditer(section))
    for f in fences:
        if f.group(1).lower() == "pseudocode":
            return f.group(2)
    return fences[0].group(2) if fences else ""


def compact_pseudocode(raw: str) -> str:
    """The editorial's pseudocode, compacted for a sticky note WITHOUT changing
    any code: drop comment-only lines, blank lines, brace-only lines and the
    annotation tags (<edge case>); strip inline /* comments */ and a trailing
    "{"; turn "} else {" into "else"; re-indent 4 → 2 spaces. Every line kept
    has exactly the editorial's tokens."""
    text = re.sub(r"/\*[\s\S]*?\*/", "", raw)  # block and inline comments
    text = re.sub(r"<(?:[a-z]+(?: [a-z]+)*)>", "", text)  # <edge case>, <base case>
    lines = []
    for line in text.split("\n"):
        line = re.sub(r"//.*$", "", line).rstrip()
        stripped = line.strip()
        if not stripped or re.fullmatch(r"[{}]+;?", stripped):
            continue
        indent = len(line) - len(line.lstrip(" "))
        body = re.sub(r"^\}\s*", "", stripped)  # "} else {" -> "else {"
        body = re.sub(r"\s*\{$", "", body)  # trailing "{"
        if not body:
            continue
        lines.append((indent, body))
    if not lines:
        return ""
    positive = sorted({i for i, _ in lines if i > 0})
    unit = positive[0] if positive else 4
    base = min(i for i, _ in lines)
    return "\n".join("  " * round((i - base) / unit) + b for i, b in lines)


def _complexity_value(section: str, kind: str) -> str:
    """The backticked value on the "Time/Space Complexity" line, e.g. `O(N)`."""
    for line in section.split("\n"):
        if re.search(rf"{kind}\s+Complexity", line, re.I):
            m = re.search(r"`([^`]+)`", line)
            if m:
                return m.group(1).strip()
            found = re.search(r"O\([^\n]*\)", line)
            if found:
                return found.group(0).strip("*").strip()
    return ""


def split_solutions(editorial: str) -> list[dict]:
    """One entry per `## ...` solution heading, in order, with everything this
    script copies from the editorial:
    {"index", "name", "complexity", "pseudocode", "identifiers", "tc", "sc"}.
    `pseudocode` is the compacted editorial pseudocode: the source the steps
    are written from, and `identifiers` the names the steps may use."""
    solutions = []
    matches = list(re.finditer(r"(?m)^##[ \t]+(.+?)\s*$", editorial))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(editorial)
        body = editorial[m.end():end]
        name = re.sub(r"^Solution\s+\d+\s*:\s*", "", m.group(1)).strip()
        complexity = _subsection(body, "Complexity Analysis")
        pseudocode = compact_pseudocode(_raw_pseudocode(_subsection(body, "Pseudocode")))
        solutions.append({
            "index": i + 1,
            "name": name,
            "complexity": complexity,
            "pseudocode": pseudocode,
            # Names the code steps may use: exactly this solution's.
            "identifiers": set(_IDENT_RE.findall(pseudocode)),
            "tc": _complexity_value(complexity, "Time"),
            "sc": _complexity_value(complexity, "Space"),
        })
    return solutions


def editorial_identifiers(editorial: str) -> set[str]:
    """Every identifier used in the editorial's pseudocode and code blocks."""
    names: set[str] = set()
    for f in _FENCE_RE.finditer(editorial):
        names.update(_IDENT_RE.findall(re.sub(r"/\*[\s\S]*?\*/|//.*|#.*", "", f.group(2))))
    return names


def _normalize_expr(expr: str) -> str:
    s = expr.lower()
    for a, b in (
        ("\\left", ""), ("\\right", ""), ("\\cdot", "*"), ("\\times", "*"),
        ("·", "*"), ("×", "*"), ("\\log", "log"), ("\\sqrt", "sqrt"), ("√", "sqrt"),
        ("log_2", "log"), ("log₂", "log"), ("log2", "log"), ("lg", "log"),
    ):
        s = s.replace(a, b)
    return re.sub(r"[\s`$\\{}]", "", s)


def extract_big_o(text: str) -> list[str]:
    """Every O(...) / Θ(...) expression in `text`, normalized, parentheses balanced."""
    found = []
    for m in re.finditer(r"(?<![A-Za-z])[OΘ]\s*\(", text):
        depth, j = 0, m.end() - 1
        while j < len(text):
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    found.append(_normalize_expr("O" + text[m.end() - 1 : j + 1]))
                    break
            j += 1
    return found


def assign_labels(tcs: list[str]) -> list[str]:
    """Brute / Better / Optimal from position and TC: the last solution and any
    with the same TC are Optimal, the first (if not optimal) is Brute, the rest
    Better. Repeated labels are numbered ("Better 1", "Better 2")."""
    n = len(tcs)
    if n == 1:
        return ["Optimal"]
    best = _normalize_expr(tcs[-1]) if tcs[-1] else None
    labels = []
    for i, tc in enumerate(tcs):
        if i == n - 1 or (best and tc and _normalize_expr(tc) == best):
            labels.append("Optimal")
        elif i == 0:
            labels.append("Brute")
        else:
            labels.append("Better")
    for name in ("Better", "Optimal"):
        if labels.count(name) > 1:
            k = 0
            for i, lab in enumerate(labels):
                if lab == name:
                    k += 1
                    labels[i] = f"{name} {k}"
    return labels


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def parse_llm_json(text: str):
    """Parse the model's reply; tolerates a ```json fence or leading prose."""
    if not text:
        raise ValueError("empty reply")
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    candidate = fenced.group(1) if fenced else text
    start, end = candidate.find("{"), candidate.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object found in reply")
    return json.loads(candidate[start : end + 1])


def _clean(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def code_names_in_prose(text: str) -> set[str]:
    """Code-like names in prose: `name(`, `name[`, `name.member`, snake_case
    and camelCase words. Plain English words are not returned."""
    found = set()
    for m in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)(?=\(|\[|\.[A-Za-z_])", text):
        found.add(m.group(1))
    for m in re.finditer(r"\.([A-Za-z_][A-Za-z0-9_]*)\(", text):  # .back(), .push(
        found.add(m.group(1))
    for word in _IDENT_RE.findall(text):
        if "_" in word.strip("_") or re.search(r"[a-z][A-Z]", word):
            found.add(word)
    return found


def _check_names(where: str, text: str, identifiers: set[str], soft: list[str]) -> None:
    if not identifiers or not text:
        return
    unknown = sorted(
        n for n in code_names_in_prose(text)
        if n not in identifiers and n not in PROSE_NAME_ALLOWLIST
    )
    if unknown:
        soft.append(
            f"{where} uses {', '.join(unknown)} — not a name from the editorial's code; "
            "use the editorial's exact variable/function names"
        )


def clean_steps(raw) -> list[str]:
    """The LLM's steps as a clean list (tolerates one newline-separated string)."""
    if isinstance(raw, str):
        raw = raw.split("\n")
    if not isinstance(raw, list):
        return []
    steps = []
    for item in raw:
        text = str(item).strip() if isinstance(item, (str, int, float)) else ""
        text = re.sub(r"^(?:\d+[.)]|[-*•])\s*", "", text).strip()  # no own numbering/bullets
        if text:
            steps.append(text)
    return steps


def steps_problems(steps: list[str], sol: dict | None, limit: int = STEPS_MAX) -> list[str]:
    """Why a note's code steps are not acceptable for `sol` (empty = fine):
    count, length, and code names that are not in that solution's editorial
    pseudocode."""
    if not steps:
        return ["missing 'steps'"]
    problems = []
    if len(steps) > limit:
        problems.append(f"{len(steps)} steps (limit {limit}) — keep only the key ones, at most {limit}")
    elif len(steps) < STEPS_MIN:
        problems.append(f"only {len(steps)} step(s) — use {STEPS_MIN} to {limit}")
    long_steps = [k + 1 for k, st in enumerate(steps) if len(st) > LIMITS["step"]]
    if long_steps:
        problems.append(
            f"step(s) {', '.join(map(str, long_steps))} over {LIMITS['step']} characters — make each a short cue "
            "(verb first, key variables only, no loop mechanics)"
        )
    if sol and sol.get("identifiers"):
        unknown = sorted({
            n for st in steps for n in code_names_in_prose(st)
            if n not in sol["identifiers"] and n not in PROSE_NAME_ALLOWLIST
        })
        if unknown:
            problems.append(
                f"steps use {', '.join(unknown)} — not in the editorial's pseudocode for this solution; "
                f"use only its names ({', '.join(sorted(sol['identifiers']))})"
            )
    return problems


def validate_notes(
    data,
    solutions: list[dict],
    identifiers: set[str] | None = None,
):
    """Returns (notes, structural_errors, soft_issues).

    `notes` is the cleaned object to write (None when structurally invalid).
    Structural errors make the output unusable; soft issues are fixable by a
    retry or by the reviewer. Name/TC/SC are filled from `solutions`; code
    steps that still have problems are fixed afterwards by fix_steps."""
    errors: list[str] = []
    soft: list[str] = []
    identifiers = identifiers or set()

    if not isinstance(data, dict):
        return None, ["top level is not a JSON object"], soft

    notes = {"version": SCHEMA_VERSION}
    for field in TOP_FIELDS:
        value = _clean(data.get(field))
        if not value:
            errors.append(f"missing '{field}'")
        elif len(value) > LIMITS[field]:
            soft.append(f"'{field}' is {len(value)} chars (limit {LIMITS[field]})")
        notes[field] = value

    raw_approaches = data.get("approaches")
    if not isinstance(raw_approaches, list) or not raw_approaches:
        errors.append("'approaches' must be a non-empty list")
        return None, errors, soft

    expected = min(len(solutions), MAX_APPROACHES) if solutions else None
    if expected is not None and len(raw_approaches) != expected:
        errors.append(
            f"'approaches' has {len(raw_approaches)} entries but the editorial has {len(solutions)} "
            f"solutions — return exactly one entry per editorial solution, in order "
            f"(solutionIndex 1..{expected})"
        )
    raw_approaches = raw_approaches[: expected or MAX_APPROACHES]

    by_index = {s["index"]: s for s in solutions}
    approaches = []
    for pos, raw in enumerate(raw_approaches, start=1):
        where = f"approach {pos}"
        if not isinstance(raw, dict):
            errors.append(f"{where} is not an object")
            continue
        idx = raw.get("solutionIndex")
        if isinstance(idx, bool) or not isinstance(idx, int):
            errors.append(f"{where}: 'solutionIndex' must be an integer")
            idx = None
        elif solutions and idx != pos:
            errors.append(
                f"{where}: solutionIndex is {idx} but must be {pos} — one entry per editorial "
                "solution, in the editorial's order"
            )
        item = {"solutionIndex": idx if isinstance(idx, int) and not isinstance(idx, bool) else None}

        for field in LLM_APPROACH_FIELDS:
            value = _clean(raw.get(field))
            if not value:
                errors.append(f"{where}: missing '{field}'")
            elif len(value) > LIMITS[field]:
                soft.append(f"{where}: '{field}' is {len(value)} chars (limit {LIMITS[field]})")
            _check_names(f"{where} '{field}'", value, identifiers, soft)
            item[field] = value

        why = _clean(raw.get("whyBetter"))
        if pos == 1:
            why = ""  # nothing before the first approach to beat
        elif not why:
            soft.append(f"{where}: missing 'whyBetter' (why it beats approach {pos - 1})")
        elif len(why) > LIMITS["whyBetter"]:
            soft.append(f"{where}: 'whyBetter' is {len(why)} chars (limit {LIMITS['whyBetter']})")
        _check_names(f"{where} 'whyBetter'", why, identifiers, soft)
        item["whyBetter"] = why

        sol = by_index.get(pos) if solutions else None
        item["steps"] = clean_steps(raw.get("steps"))
        for problem in steps_problems(item["steps"], sol):
            soft.append(f"{where}: {problem}")

        # Name / TC / SC: copied from the editorial. The LLM's values are only
        # a fallback when the editorial section could not be parsed.
        for field in ("name", "tc", "sc"):
            from_editorial = sol.get(field, "") if sol else ""
            llm_value = raw.get(field) if isinstance(raw.get(field), str) else ""
            item[field] = from_editorial or llm_value.strip()
            if sol and not from_editorial:
                soft.append(f"{where}: could not read '{field}' from the editorial; using the model's")
            if not item[field]:
                errors.append(f"{where}: missing '{field}' (not in the editorial either)")
        approaches.append(item)

    for item, label in zip(approaches, assign_labels([a["tc"] for a in approaches])):
        item["label"] = label

    notes["approaches"] = approaches
    _validate_cheatsheet(data, notes, identifiers, soft)
    return (None if errors else notes), errors, soft


def _normalize_answer(text: str) -> str:
    return re.sub(r"[\s`\"']", "", text).lower()


def _example_output(example: str) -> str:
    """The right-hand side of "input → output", or '' when there is no arrow."""
    for arrow in ("→", "->", "=>"):
        if arrow in example:
            return example.rsplit(arrow, 1)[1].strip()
    return ""


def _validate_cheatsheet(data: dict, notes: dict, identifiers: set[str], soft: list[str]) -> None:
    """Cheat-corner fields. All optional to the renderer, so every problem here
    is soft: a bad field is cleaned or dropped, never fails the step."""
    tags = data.get("tags")
    clean_tags = []
    if isinstance(tags, list):
        clean_tags = [t.strip() for t in tags if isinstance(t, str) and t.strip()]
    if not clean_tags:
        soft.append("missing 'tags'")
    if len(clean_tags) > MAX_TAGS:
        soft.append(f"{len(clean_tags)} tags given (limit {MAX_TAGS}); extras dropped")
    for t in clean_tags[:MAX_TAGS]:
        if len(t) > LIMITS["tag"]:
            soft.append(f"tag {t!r} is {len(t)} chars (limit {LIMITS['tag']})")
    notes["tags"] = clean_tags[:MAX_TAGS]

    hint = _clean(data.get("constraintsHint"))
    if len(hint) > LIMITS["constraintsHint"]:
        soft.append(f"'constraintsHint' is {len(hint)} chars (limit {LIMITS['constraintsHint']})")
    notes["constraintsHint"] = hint

    for field, lo, hi in LIST_FIELDS:
        raw = data.get(field)
        items = [x.strip() for x in raw if isinstance(x, str) and x.strip()] if isinstance(raw, list) else []
        if len(items) < lo:
            soft.append(f"'{field}' has {len(items)} item(s) (want at least {lo})")
        if len(items) > hi:
            soft.append(f"'{field}' has {len(items)} items (limit {hi}); extras dropped")
            items = items[:hi]
        for x in items:
            if len(x) > LIMITS["listItem"]:
                soft.append(f"a '{field}' item is {len(x)} chars (limit {LIMITS['listItem']})")
            _check_names(f"'{field}' item", x, identifiers, soft)
        notes[field] = items

    notes["dryRun"] = _validate_dry_run(data.get("dryRun"), notes, identifiers, soft)


def _validate_dry_run(raw, notes: dict, identifiers: set[str], soft: list[str]):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        soft.append("'dryRun' is not an object; dropped")
        return None
    columns = raw.get("columns")
    rows = raw.get("rows")
    lo, hi = DRY_RUN_COLUMNS
    if not isinstance(columns, list) or not all(isinstance(c, str) and c.strip() for c in columns):
        soft.append("'dryRun.columns' must be a list of names; dry run dropped")
        return None
    columns = [c.strip() for c in columns]
    if not lo <= len(columns) <= hi:
        soft.append(f"'dryRun' has {len(columns)} columns (want {lo}–{hi}); dry run dropped")
        return None
    if not isinstance(rows, list) or not rows:
        soft.append("'dryRun.rows' is empty; dry run dropped")
        return None
    clean_rows = []
    for i, row in enumerate(rows, start=1):
        if not isinstance(row, list) or len(row) != len(columns):
            soft.append(f"dryRun row {i} does not have {len(columns)} cells; dry run dropped")
            return None
        clean_rows.append([str(c).strip() if isinstance(c, (str, int, float)) else "" for c in row])
    if len(clean_rows) > DRY_RUN_MAX_ROWS:
        soft.append(f"'dryRun' has {len(clean_rows)} rows (limit {DRY_RUN_MAX_ROWS}); extras dropped")
        clean_rows = clean_rows[:DRY_RUN_MAX_ROWS]
    long_cells = sum(1 for r in clean_rows for c in r if len(c) > LIMITS["dryRunCell"])
    if long_cells:
        soft.append(f"{long_cells} dry-run cell(s) over {LIMITS['dryRunCell']} chars")

    # Columns name the editorial's variables (or plain words like "action").
    if identifiers:
        bad = sorted({
            w for c in columns for w in _IDENT_RE.findall(c)
            if w not in identifiers and w.lower() not in DRY_RUN_COLUMN_WORDS
        })
        if bad:
            soft.append(
                f"dryRun columns use {', '.join(bad)} — name columns after the editorial's variables"
            )

    approach = _clean(raw.get("approach"))
    labels = [a["label"] for a in notes.get("approaches", [])]
    if labels and approach not in labels:
        approach = labels[-1]  # the dry run traces the optimal (last) solution

    inp = _clean(raw.get("input"))
    result = _clean(raw.get("result"))
    if len(result) > LIMITS["dryRunResult"]:
        soft.append(f"'dryRun.result' is {len(result)} chars (limit {LIMITS['dryRunResult']})")
    # Only comparable when the trace uses the example's own input.
    expected = _example_output(notes.get("example", ""))
    example_input = notes.get("example", "")
    if result and expected and inp and _normalize_answer(inp) in _normalize_answer(example_input):
        if _normalize_answer(result) != _normalize_answer(expected):
            soft.append(f"dry run result {result!r} does not match the example output {expected!r}")
    return {"approach": approach, "input": inp, "columns": columns, "rows": clean_rows, "result": result}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _steps_call(sol: dict, previous: list[str], problems: list[str], limit: int = STEPS_MAX) -> list[str]:
    """Focused rewrite of ONE solution's code steps."""
    content, usage = call_llm(
        STEPS_PROMPT,
        build_steps_message(sol["name"], sol["pseudocode"], previous, problems, limit),
        purpose="revision_notes",
    )
    track_usage(
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        "revision_notes_steps",
        model=usage.get("model", "unknown"),
        purpose="revision_notes",
        step_id=STEP_ID,
        cost=usage.get("cost", 0.0),
    )
    text = (content or "").strip()
    try:
        data = json.loads(text[text.find("[") : text.rfind("]") + 1]) if "[" in text else None
    except json.JSONDecodeError:
        data = None
    return clean_steps(data if isinstance(data, list) else text)


def check_steps_faithful(sol: dict, steps: list[str]) -> list[str] | None:
    """Ask the independent reviewer model whether `steps` describe every step
    of the editorial's pseudocode that affects the result, correctly and in
    order. Returns what is missing or wrong ([] = faithful), or None when the
    check could not run."""
    try:
        content, usage = call_llm(
            STEPS_FAITHFUL_PROMPT,
            build_steps_faithful_message(sol["name"], sol["pseudocode"], steps),
            purpose="revision_audit",
        )
        track_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            "revision_notes_steps_check",
            model=usage.get("model", "unknown"),
            purpose="revision_audit",
            step_id=STEP_ID,
            cost=usage.get("cost", 0.0),
        )
        data = parse_llm_json(content)
    except Exception as exc:  # the full safety review still covers it
        print(f"  steps check could not run: {exc}")
        return None
    if data.get("faithful") is True:
        return []
    missing = [str(m).strip() for m in data.get("missing") or [] if str(m).strip()]
    return missing or ["the steps do not describe what the editorial's code does"]


STEPS_ATTEMPTS = 3


def fix_steps(notes: dict, solutions: list[dict], feedback: dict[int, list[str]] | None = None) -> None:
    """Make every note's code steps short AND faithful, in place. Per note:
      1. deterministic checks (steps_problems: count, length, editorial names)
         plus any safety-review `feedback` for that note (1-based);
      2. if those pass, the independent reviewer model confirms the steps cover
         every result-affecting step of the editorial's pseudocode;
      3. any problem → a focused rewrite with the problems, then 1–2 again;
         up to STEPS_ATTEMPTS tries;
      4. still failing → the attempt with the fewest problems is kept and the
         safety check reports it."""
    feedback = feedback or {}
    by_index = {s["index"]: s for s in solutions}
    limit = STEPS_MAX
    for pos, a in enumerate(notes.get("approaches") or [], start=1):
        sol = by_index.get(pos)
        if not sol or not sol.get("pseudocode"):
            continue

        def judge(steps: list[str], extra: list[str]) -> list[str]:
            problems = steps_problems(steps, sol, limit) + extra
            if problems:
                return problems
            missing = check_steps_faithful(sol, steps)
            return missing or []  # None (check unavailable) → accept; the full review still runs

        current = list(a.get("steps") or [])
        problems = judge(current, feedback.get(pos, []))
        if not problems:
            print(f"Note {pos} steps ({sol['name']}): {len(current)} steps, editorial names, "
                  "match the editorial's code ✓")
            continue
        print(f"Fixing note {pos}'s steps ({sol['name']}): " + "; ".join(p.split(" — ")[0] for p in problems))

        def rank(steps: list[str], problems: list[str]) -> tuple[int, int]:
            # Severity: names outside the editorial (3) > missing / too few
            # steps (2) > anything else — a reviewer doubt, too long (1).
            def weight(p: str) -> int:
                if p.startswith("steps use "):
                    return 3
                if p.startswith(("missing 'steps'", "only ")):
                    return 2
                return 1
            return (sum(weight(p) for p in problems), len(problems))

        best, best_rank = current, rank(current, problems)
        for attempt in range(STEPS_ATTEMPTS):
            try:
                candidate = _steps_call(sol, current, problems, limit)
            except Exception as exc:  # never let this block the notes
                print(f"  rewrite call failed: {exc}")
                break
            problems = judge(candidate, [])
            if rank(candidate, problems) < best_rank:
                best, best_rank = candidate, rank(candidate, problems)
            if not problems:
                break
            print(f"  attempt {attempt + 1}: " + "; ".join(p.split(" — ")[0] for p in problems))
            current = candidate
        if best_rank == (0, 0):
            print(f"  note {pos}: {len(best)} steps, editorial names, match the editorial's code ✓")
        else:
            print(f"⚠️  note {pos}: kept the best steps ({best_rank[1]} problem(s) left — the safety check will report them)")
        a["steps"] = best


def _steps_feedback(issues: list[dict]) -> dict[int, list[str]]:
    """Safety-review findings on approaches[k].steps (or a single step), by 1-based note."""
    out: dict[int, list[str]] = {}
    for issue in issues:
        m = re.fullmatch(r"approaches\[(\d+)\]\.steps(?:\[\d+\])?", issue.get("path", ""))
        if m:
            text = issue["problem"] + (f" Fix: {issue['fix']}" if issue.get("fix") else "")
            out.setdefault(int(m.group(1)) + 1, []).append(text)
    return out


def _call(user_message: str) -> str:
    content, usage = call_llm(REVISION_NOTES_PROMPT, user_message, purpose="revision_notes")
    track_usage(
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        "revision_notes",
        model=usage.get("model", "unknown"),
        purpose="revision_notes",
        step_id=STEP_ID,
        cost=usage.get("cost", 0.0),
    )
    print(f"LLM reply received (model={usage.get('model', 'unknown')}, "
          f"cost=${usage.get('cost', 0.0):.6f}).")
    return content


def _attempt(user_message: str, solutions: list[dict], identifiers: set[str]):
    reply = _call(user_message)
    try:
        data = parse_llm_json(reply)
    except (ValueError, json.JSONDecodeError) as exc:
        return reply, None, [f"reply is not valid JSON ({exc})"], []
    notes, errors, soft = validate_notes(data, solutions, identifiers)
    return reply, notes, errors, soft


def generate_revision_notes() -> int:
    print("============================================================")
    print("REVISION NOTES GENERATOR (editorial → sticky-notes image data)")
    print("============================================================")

    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    outputs_dir = os.path.join(base_dir, "Outputs")

    editorial = load_file(os.path.join(outputs_dir, "editorial.md"))
    if not editorial.strip():
        print("Error: Missing 'Outputs/editorial.md'. Run Generate Editorial first.")
        return 1

    statement = load_file(os.path.join(outputs_dir, "generated_description.md"))
    if not statement:
        statement = load_file(os.path.join(base_dir, "Inputs", "problem.md"))

    title = resolve_short_title(outputs_dir)
    if not title:
        h1 = re.search(r"(?m)^#[ \t]+(.+?)\s*$", editorial)
        title = h1.group(1).strip() if h1 else ""

    solutions = split_solutions(editorial)
    identifiers = editorial_identifiers(editorial)
    if len(solutions) > MAX_APPROACHES:
        print(f"⚠️  Editorial has {len(solutions)} solutions; only the first {MAX_APPROACHES} get notes.")
    print(f"Editorial has {len(solutions)} solution(s):")
    for s in solutions:
        missing = [f for f in ("pseudocode", "tc", "sc") if not s[f]]
        print(f"  {s['index']}. {s['name']}  (TC {s['tc'] or '?'}, SC {s['sc'] or '?'}"
              + (f"; could not read {', '.join(missing)}" if missing else "") + ")")

    user_message = build_user_message(
        title, statement, strip_code_blocks(editorial),
        [(s["name"], s["pseudocode"]) for s in solutions[:MAX_APPROACHES]],
    )

    print("\nSummarising the editorial into revision notes...")
    # A clean first reply is used as is; otherwise one retry with the problems.
    reply, notes, errors, soft = _attempt(user_message, solutions, identifiers)

    if errors or soft:
        problems = errors + soft
        print("First attempt needs fixes:")
        for p in problems:
            print(f"  - {p}")
        print("Retrying once with the problems fed back...")
        retry_message = (
            f"{user_message}\n\nYOUR PREVIOUS REPLY:\n{reply}\n\n"
            "It had these problems — fix ALL of them and return the corrected JSON object only:\n"
            + "\n".join(f"- {p}" for p in problems)
        )
        _, notes, errors, soft = _attempt(retry_message, solutions, identifiers)

    if errors or notes is None:
        print("Error: revision notes are still invalid after the retry:")
        for p in errors or ["unknown validation failure"]:
            print(f"  - {p}")
        return 1

    for p in soft:
        print(f"⚠️  {p} (kept — edit the field on the Editorial tab if it matters)")

    if title:
        notes["title"] = title

    # Every note's code steps: editorial names only, and confirmed by the
    # independent reviewer to cover the editorial's code (focused rewrite if not).
    fix_steps(notes, solutions)

    # Safety check: deterministic re-verification + independent LLM review.
    # Errors get ONE automatic repair round; the final report is saved with
    # the notes either way (the web app shows "needs review" when it fails).
    import revision_notes_audit as audit_mod

    stripped = strip_code_blocks(editorial)
    print("\nRunning the safety check...")
    audit = audit_mod.run_audit(notes, solutions, identifiers, title, statement, stripped, STEP_ID)
    audit_mod.print_audit(audit)
    if audit["status"] == "needs_review":
        problems = audit_mod.problems_for_repair(audit["checks"], audit["issues"])
        print("\nRepairing the notes with the safety check's findings...")
        repair_message = (
            f"{user_message}\n\nYOUR PREVIOUS REPLY (as saved):\n"
            f"{json.dumps(notes, ensure_ascii=False, indent=2)}\n\n"
            "An independent safety review found these problems. Fix ALL of them — keep everything "
            "else exactly as it is, and keep every note's steps as 2–5 short cues (≤ 70 characters) using only "
            "the editorial's names — and return the corrected JSON object only:\n"
            + "\n".join(f"- {p}" for p in problems)
        )
        _, repaired, rerrors, rsoft = _attempt(repair_message, solutions, identifiers)
        if repaired is not None and not rerrors:
            if title:
                repaired["title"] = title
            # Steps already passed their own checks: keep them, so the repair
            # cannot regress them. Only notes the review flagged are reworked,
            # starting from the checked version, with the finding as feedback.
            flagged = _steps_feedback(audit["issues"])
            for old, new in zip(notes["approaches"], repaired["approaches"]):
                new["steps"] = old["steps"]
            fix_steps(repaired, solutions, flagged)
            for p in rsoft:
                print(f"⚠️  {p}")
            print("\nRe-checking the repaired notes...")
            second = audit_mod.run_audit(repaired, solutions, identifiers, title, statement, stripped, STEP_ID, repairs=1)
            audit_mod.print_audit(second)
            # Keep the repair unless it made things worse.
            rank = {"passed": 0, "passed_with_warnings": 1, "needs_review": 2}
            if rank[second["status"]] <= rank[audit["status"]]:
                notes, audit = repaired, second
            else:
                print("The repair did not improve the notes; keeping the original.")
        else:
            print("The repair reply was invalid; keeping the original notes:")
            for p in rerrors:
                print(f"  - {p}")
    notes["audit"] = audit

    output_path = os.path.join(outputs_dir, OUTPUT_NAME)
    os.makedirs(outputs_dir, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)
        f.write("\n")

    labels = ", ".join(f"{a['label']} ({a['name']})" for a in notes["approaches"])
    print(f"\n✅ SUCCESS! Revision notes saved to {output_path}: {labels}")
    print(f"   Safety check: {notes['audit']['status'].replace('_', ' ')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(generate_revision_notes())
