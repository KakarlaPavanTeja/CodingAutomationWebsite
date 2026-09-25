"""
Revision Notes safety check.

Two layers, both run after generation (inside generate_revision_notes, with one
automatic repair round) and on demand by the "Verify Revision Notes" step
(this script's main — e.g. after a reviewer edited the notes):

  1. Deterministic checks — the notes re-verified against the editorial itself:
     one note per solution in order, names / TC / SC / labels match, code steps
     and prose only use the editorial's names, dry run well-formed and traces
     the last solution, required fields present, text within sticky-note
     limits. Every image page is drawn from this one checked JSON, so these
     checks also guarantee the pages agree with each other (same title, labels,
     complexities, terminology).
  2. An independent LLM review (a different model family from the generator)
     for what code cannot check: each note faithfully describes its editorial
     solution, the code steps cover what the editorial's code does, the dry run
     is re-traced step by step, and edge cases / pitfalls / constraints hint /
     example are correct.

The outcome is stored in the notes as `audit`:
    {"status": "passed" | "passed_with_warnings" | "needs_review",
     "checks": [{"id", "label", "level", "ok", "details": [...]}],
     "issues": [{"path", "severity", "problem", "fix"}],
     "model", "checkedAt", "repairs", "stale": false}
"needs_review" = an error-level check failed or the reviewer found an error.
The web app shows it on the Editorial tab and marks it stale when the notes
are edited.
"""

import json
import os
import re
from datetime import datetime, timezone

from editorial_manager import load_file, resolve_short_title
from llm_client import call_llm
from usage_tracker import update_usage as track_usage
from Prompts.revisionNotesAuditPrompt import REVISION_NOTES_AUDIT_PROMPT, build_audit_message
import revision_notes_manager as rn

VERIFY_STEP_ID = "verify_revision_notes"


# ---------------------------------------------------------------------------
# 1. Deterministic checks
# ---------------------------------------------------------------------------

def _check(cid: str, label: str, level: str, details: list[str]) -> dict:
    return {"id": cid, "label": label, "level": level, "ok": not details, "details": details}


def deterministic_checks(notes: dict, solutions: list[dict], identifiers: set[str], title: str = "") -> list[dict]:
    """Re-verify saved notes against the editorial. `level` is "error" for
    anything that makes a note wrong, "warning" for fit/style problems."""
    approaches = notes.get("approaches") or []
    checks = []

    # One note per editorial solution, in order.
    d = []
    if solutions:
        expected = min(len(solutions), rn.MAX_APPROACHES)
        if len(approaches) != expected:
            d.append(f"{len(approaches)} notes for {len(solutions)} editorial solutions")
        for pos, a in enumerate(approaches, start=1):
            if a.get("solutionIndex") != pos:
                d.append(f"note {pos} points at editorial solution {a.get('solutionIndex')}")
    checks.append(_check("solutions", "One note per editorial solution, in order", "error", d))

    by_index = {s["index"]: s for s in solutions}
    pairs = [(pos, a, by_index.get(pos)) for pos, a in enumerate(approaches, start=1)]

    d = [f"note {p}: '{a.get('name')}' ≠ editorial '{s['name']}'"
         for p, a, s in pairs if s and s["name"] and a.get("name") != s["name"]]
    checks.append(_check("names", "Technique names match the editorial", "error", d))

    d = []
    for p, a, s in pairs:
        for f in ("tc", "sc"):
            if s and s[f] and a.get(f) != s[f]:
                d.append(f"note {p}: {f.upper()} '{a.get(f)}' ≠ editorial '{s[f]}'")
    checks.append(_check("complexity", "Time and space complexity match the editorial", "error", d))

    expected_labels = rn.assign_labels([a.get("tc", "") for a in approaches]) if approaches else []
    d = [f"note {i + 1}: label '{a.get('label')}' should be '{want}'"
         for i, (a, want) in enumerate(zip(approaches, expected_labels)) if a.get("label") != want]
    checks.append(_check("labels", "Labels follow Brute → Better → Optimal", "error", d))

    d = []
    for p, a, s in pairs:
        if s and s.get("identifiers"):
            unknown = sorted({
                n for st in a.get("steps") or [] for n in rn.code_names_in_prose(st)
                if n not in s["identifiers"] and n not in rn.PROSE_NAME_ALLOWLIST
            })
            if unknown:
                d.append(f"note {p}: steps use {', '.join(unknown)}, not in the editorial's pseudocode")
    checks.append(_check("steps", "Code steps use only the editorial's names", "error", d))

    d = []
    if identifiers:
        texts = [(f"note {p} {f}", a.get(f, "")) for p, a, _ in pairs
                 for f in ("intuition", "takeaway", "whyBetter")]
        texts += [(f"{f} item", x) for f in ("recognize", "edgeCases", "pitfalls") for x in notes.get(f) or []]
        for where, text in texts:
            unknown = sorted(n for n in rn.code_names_in_prose(text)
                             if n not in identifiers and n not in rn.PROSE_NAME_ALLOWLIST)
            if unknown:
                d.append(f"{where} uses {', '.join(unknown)}")
    checks.append(_check("prose_names", "Explanations use the editorial's variable names", "warning", d))

    d = []
    if approaches and approaches[0].get("whyBetter"):
        d.append("the first note has a 'why better' text (nothing to compare with)")
    d += [f"note {p} does not say why it beats note {p - 1}" for p, a, _ in pairs if p > 1 and not a.get("whyBetter")]
    checks.append(_check("why_better", "Every later note says why it is better", "warning", d))

    d, dw = [], []
    dr = notes.get("dryRun")
    last = approaches[-1] if approaches else None
    if dr:
        if last and dr.get("approach") != last.get("label"):
            d.append(f"traces '{dr.get('approach')}', not the last solution '{last.get('label')}'")
        cols = dr.get("columns") or []
        if any(len(r) != len(cols) for r in dr.get("rows") or []):
            d.append("a row does not have one cell per column")
        last_sol = by_index.get(len(approaches)) if solutions else None
        allowed = (last_sol or {}).get("identifiers") or identifiers
        if allowed:
            bad = sorted({w for c in cols for w in rn._IDENT_RE.findall(c)
                          if w not in allowed and w.lower() not in rn.DRY_RUN_COLUMN_WORDS})
            if bad:
                dw.append(f"columns {', '.join(bad)} are not variables of the traced solution")
        expected = rn._example_output(notes.get("example", ""))
        inp = dr.get("input", "")
        if (dr.get("result") and expected and inp
                and rn._normalize_answer(inp) in rn._normalize_answer(notes.get("example", ""))
                and rn._normalize_answer(dr["result"]) != rn._normalize_answer(expected)):
            d.append(f"result '{dr['result']}' ≠ the example's output '{expected}'")
    checks.append(_check("dry_run", "Dry run traces the optimal solution and matches the example", "error", d))
    checks.append(_check("dry_run_columns", "Dry-run columns are the traced solution's variables", "warning", dw))

    d = []
    for f in rn.TOP_FIELDS:
        if not str(notes.get(f) or "").strip():
            d.append(f"'{f}' is empty")
    for p, a, _ in pairs:
        for f in ("intuition", "takeaway", "tc", "sc"):
            if not str(a.get(f) or "").strip():
                d.append(f"note {p}: '{f}' is empty")
        if not a.get("steps"):
            d.append(f"note {p}: no code steps")
    checks.append(_check("required", "No empty sections", "error", d))

    d = []
    for f in ("title", "oneLiner", "example", "constraintsHint"):
        v = str(notes.get(f) or "")
        if f in rn.LIMITS and len(v) > rn.LIMITS[f]:
            d.append(f"'{f}' is {len(v)} chars (limit {rn.LIMITS[f]})")
    for p, a, s in pairs:
        for f in ("intuition", "takeaway", "whyBetter"):
            v = a.get(f) or ""
            if len(v) > rn.LIMITS[f]:
                d.append(f"note {p} {f} is {len(v)} chars (limit {rn.LIMITS[f]})")
        steps = a.get("steps") or []
        if len(steps) > rn.STEPS_MAX:
            d.append(f"note {p} has {len(steps)} code steps (limit {rn.STEPS_MAX})")
        for k, st in enumerate(steps, start=1):
            if len(st) > rn.LIMITS["step"]:
                d.append(f"note {p} step {k} is {len(st)} chars (limit {rn.LIMITS['step']})")
    for f in ("recognize", "edgeCases", "pitfalls"):
        for x in notes.get(f) or []:
            if len(x) > rn.LIMITS["listItem"]:
                d.append(f"a '{f}' item is {len(x)} chars (limit {rn.LIMITS['listItem']})")
    if not notes.get("tags"):
        d.append("no tags")
    checks.append(_check("fit", "Text fits the sticky notes", "warning", d))

    d = []
    if title and notes.get("title") != title:
        d.append(f"title '{notes.get('title')}' ≠ the problem's title '{title}'")
    checks.append(_check("title", "Title matches the problem (same on every image)", "warning", d))

    return checks


# ---------------------------------------------------------------------------
# 2. Independent LLM review
# ---------------------------------------------------------------------------

_SEVERITIES = {"error", "warning"}


def parse_audit_reply(text: str) -> list[dict]:
    data = rn.parse_llm_json(text)
    raw = data.get("issues") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        raise ValueError("reply has no 'issues' list")
    issues = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        problem = str(it.get("problem") or "").strip()
        if not problem:
            continue
        sev = str(it.get("severity") or "warning").strip().lower()
        issues.append({
            "path": str(it.get("path") or "").strip(),
            "severity": sev if sev in _SEVERITIES else "warning",
            "problem": problem,
            "fix": str(it.get("fix") or "").strip(),
        })
    return issues


def _public_notes(notes: dict) -> dict:
    """What the reviewer judges: the notes without their previous audit."""
    return {k: v for k, v in notes.items() if k != "audit"}


def llm_review(notes: dict, statement: str, editorial_stripped: str, step_id: str):
    """Returns (issues, model). Raises on transport or parse failure."""
    message = build_audit_message(statement, editorial_stripped, json.dumps(_public_notes(notes), ensure_ascii=False, indent=2))
    content, usage = call_llm(REVISION_NOTES_AUDIT_PROMPT, message, purpose="revision_audit")
    track_usage(
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        "revision_audit",
        model=usage.get("model", "unknown"),
        purpose="revision_audit",
        step_id=step_id,
        cost=usage.get("cost", 0.0),
    )
    print(f"Safety review received (model={usage.get('model', 'unknown')}, cost=${usage.get('cost', 0.0):.6f}).")
    return parse_audit_reply(content), usage.get("model", "unknown")


# ---------------------------------------------------------------------------
# Outcome
# ---------------------------------------------------------------------------

def audit_status(checks: list[dict], issues: list[dict]) -> str:
    if any(not c["ok"] and c["level"] == "error" for c in checks) or any(i["severity"] == "error" for i in issues):
        return "needs_review"
    if any(not c["ok"] for c in checks) or issues:
        return "passed_with_warnings"
    return "passed"


def build_audit(checks: list[dict], issues: list[dict], model: str, repairs: int = 0) -> dict:
    return {
        "status": audit_status(checks, issues),
        "checks": checks,
        "issues": issues,
        "model": model,
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "repairs": repairs,
        "stale": False,
    }


def problems_for_repair(checks: list[dict], issues: list[dict]) -> list[str]:
    """Everything worth sending back to the generator, as one line each."""
    out = [f"{c['label']}: {d}" for c in checks if not c["ok"] for d in c["details"]]
    for i in issues:
        line = f"[{i['severity']}] {i['path'] or 'notes'}: {i['problem']}"
        if i["fix"]:
            line += f" → fix: {i['fix']}"
        out.append(line)
    return out


def run_audit(notes, solutions, identifiers, title, statement, editorial_stripped, step_id, repairs=0) -> dict:
    """Both layers. A failing LLM review never raises: it is recorded as an
    error issue, so the notes show "needs review" rather than "verified"."""
    checks = deterministic_checks(notes, solutions, identifiers, title)
    try:
        issues, model = llm_review(notes, statement, editorial_stripped, step_id)
    except Exception as exc:  # the safety check must not crash the step
        print(f"⚠️  Safety review could not run: {exc}")
        issues, model = [{
            "path": "",
            "severity": "error",
            "problem": f"The independent review could not run ({exc}). Re-verify before using these notes.",
            "fix": "",
        }], "unavailable"
    return build_audit(checks, issues, model, repairs)


def print_audit(audit: dict) -> None:
    passed = sum(1 for c in audit["checks"] if c["ok"])
    print(f"\nSafety check: {audit['status'].replace('_', ' ').upper()} "
          f"({passed}/{len(audit['checks'])} checks passed, {len(audit['issues'])} review issue(s))")
    for c in audit["checks"]:
        mark = "✓" if c["ok"] else ("✗" if c["level"] == "error" else "!")
        print(f"  {mark} {c['label']}")
        for d in c["details"]:
            print(f"      - {d}")
    for i in audit["issues"]:
        print(f"  [{i['severity']}] {i['path'] or 'notes'}: {i['problem']}" + (f"  (fix: {i['fix']})" if i["fix"] else ""))


# ---------------------------------------------------------------------------
# Verify step: re-check the saved notes (e.g. after a reviewer's edits)
# ---------------------------------------------------------------------------

def verify_revision_notes() -> int:
    print("============================================================")
    print("REVISION NOTES SAFETY CHECK (verify saved notes)")
    print("============================================================")
    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outputs_dir = os.path.join(base_dir, "Outputs")

    raw = load_file(os.path.join(outputs_dir, rn.OUTPUT_NAME))
    if not raw.strip():
        print(f"Error: Missing 'Outputs/{rn.OUTPUT_NAME}'. Run Generate Revision Notes first.")
        return 1
    try:
        notes = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"Error: {rn.OUTPUT_NAME} is not valid JSON ({exc}).")
        return 1

    editorial = load_file(os.path.join(outputs_dir, "editorial.md"))
    if not editorial.strip():
        print("Error: Missing 'Outputs/editorial.md' — nothing to verify against.")
        return 1
    statement = load_file(os.path.join(outputs_dir, "generated_description.md")) or load_file(
        os.path.join(base_dir, "Inputs", "problem.md"))
    title = resolve_short_title(outputs_dir)

    solutions = rn.split_solutions(editorial)
    identifiers = rn.editorial_identifiers(editorial)
    prev = notes.get("audit") if isinstance(notes.get("audit"), dict) else {}
    audit = run_audit(notes, solutions, identifiers, title, statement,
                      rn.strip_code_blocks(editorial), VERIFY_STEP_ID, repairs=int(prev.get("repairs") or 0))
    print_audit(audit)

    notes["audit"] = audit
    with open(os.path.join(outputs_dir, rn.OUTPUT_NAME), "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\n✅ Safety check saved ({audit['status']}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(verify_revision_notes())
