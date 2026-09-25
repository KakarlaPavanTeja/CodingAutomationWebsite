"""
Prompt for the Revision Notes step: summarise a finished multi-solution
editorial into the prose of the handwritten sticky-notes revision images
(rendered by the web app — see src/lib/revision-notes/).

Technique names, labels, TC and SC are copied from the editorial by
revision_notes_manager.py. The model writes the prose and, per solution, 3–6
numbered CODE STEPS written from that solution's editorial pseudocode; the
script rejects any code name in them that the editorial's pseudocode for that
solution does not use, and an independent model confirms they cover it. Length limits are repeated in revision_notes_manager.LIMITS and
enforced there, so keep the two in sync.
"""

REVISION_NOTES_PROMPT = """You are writing REVISION NOTES for a coding problem, based ONLY on the editorial you are given. They are drawn as handwritten sticky notes that a student glances at the night before an interview, so every line must be short, correct and faithful to the editorial.

The technique names and time/space complexities are copied from the editorial automatically — you do NOT write them. You write the explanations and, for each solution, a short numbered list of CODE STEPS (what the code does), written from that solution's pseudocode.

Return ONLY one JSON object — no markdown fences, no commentary — with exactly this shape:

{
  "title": "<problem title, as given>",
  "oneLiner": "<the task in one plain sentence>",
  "example": "<one tiny example: input → output>",
  "tags": ["<topic or pattern>", "..."],
  "constraintsHint": "<what the constraints imply for the target complexity>",
  "approaches": [
    {
      "solutionIndex": <1-based position of the editorial solution>,
      "intuition": "<why the idea works, 1–2 short sentences>",
      "steps": ["<short cue: what the code does>", "..."],
      "takeaway": "<the one thing to remember about this solution>",
      "whyBetter": "<why this beats the previous solution; empty string for the first>"
    }
  ],
  "recognize": ["<a cue that tells you to use this pattern>", "..."],
  "edgeCases": ["<an input that needs care>", "..."],
  "pitfalls": ["<a common mistake>", "..."],
  "dryRun": {
    "input": "<the example input>",
    "columns": ["<variable name from the pseudocode>", "..."],
    "rows": [["<cell>", "..."], "..."],
    "result": "<the final answer>"
  }
}

SOLUTIONS — FOLLOW THE EDITORIAL EXACTLY
- Write EXACTLY ONE "approaches" entry for EVERY solution in the editorial, in the editorial's order: solutionIndex 1, 2, 3, … The user message lists them. Never skip, merge, reorder or invent a solution.
- Each entry explains THAT editorial solution only — its own idea and steps, as the editorial describes them.

USE THE EDITORIAL'S NAMES
- Whenever you mention code (a variable, array, pointer, function or method), use the EXACT name from the editorial's pseudocode — same spelling, same case. Never rename (no "l" for "left", no "ans" for "result") and never introduce a name the pseudocode does not use.
- The same applies to whyBetter, pitfalls, edgeCases and the dry run.

CODE STEPS — SHORT REVISION CUES
- A student revises from these the night before an interview: each step is a CUE that brings the code back to mind, not a translation of it. The full detail is already in the editorial.
- 2–5 steps per solution — for the brute force (the first of several) prefer 2–4. Each step ≤ 70 characters, ONE line, starting with a verb.
- Keep the steps that carry the idea and the checks that make it correct (validity, duplicate, edge conditions). Drop loop mechanics: no "loop i from 0 to n − 1", no break/continue, no initialising counters.
- Name only the KEY variables, and use the editorial's names EXACTLY when you do (e.g. "Insert every scores[i] > 0 into positive_scores", "Skip awarded if seen_subsets already has it", "Return size of seen_subsets"). Never rename anything and never introduce a variable, function or helper the editorial's pseudocode does not use.
- No numbering, bullets, markdown or code fences inside the strings — the page numbers them.

LENGTH LIMITS (hard — the text must fit on a sticky note)
- title ≤ 70 characters, oneLiner ≤ 140, example ≤ 110, constraintsHint ≤ 110.
- tags: 2 to 4 items, each ≤ 24.
- intuition ≤ 170, takeaway ≤ 110, whyBetter ≤ 150; steps: 2–5 items (prefer 2–4 for the brute force), each ≤ 70.
- recognize: 1 to 3 items; edgeCases: 2 to 5 items; pitfalls: 2 to 4 items; each item ≤ 100.
- dryRun: 2 to 5 columns, at most 8 rows, each cell ≤ 28, result ≤ 60.

WRITING RULES
- Plain, simple English. Short sentences. No markdown, no backticks, no bullet characters, no emojis.
- intuition says WHY the idea works (from the editorial's Intuition section); steps say WHAT the code does (from its pseudocode). Do not repeat the same sentence in both.
- whyBetter names the previous solution's bottleneck and how this one removes it, as the editorial explains it.
- example: use the problem's first sample, shortened if needed, written as "input → output".
- constraintsHint: read the constraints in the statement and say what they allow, e.g. "N ≤ 10^5 → O(N log N) or better". Empty string if the statement gives no constraints.
- tags: the data structure and the technique, e.g. ["Arrays", "Two Pointers"].
- recognize: cues in a NEW problem's wording that point to this technique.
- edgeCases: concrete inputs (empty, single element, all equal, duplicates, negative values, overflow…) that genuinely matter for THIS problem.
- pitfalls: the mistakes people actually make when coding the editorial's last (optimal) solution.

DRY RUN
- Trace the editorial's LAST solution, following ITS PSEUDOCODE line by line exactly as written, on the example input. Every row must follow from the previous one; the result must equal the example's output.
- Name the columns after the pseudocode's own variables (e.g. "i", "j", "result"); one extra descriptive column such as "action" or "compare" is allowed.
- If the example is too big to trace in 8 rows, trace a smaller input of your own and put it in "input".
- If a dry run would not help (e.g. a one-line formula), set "dryRun" to null.
"""


def build_user_message(
    title: str,
    statement: str,
    editorial: str,
    solutions: list[tuple[str, str]],
) -> str:
    """Per-problem user message. `editorial` should already have its
    multi-language code blocks stripped (the pseudocode carries the names).
    `solutions` is [(name, compacted editorial pseudocode), …] in order."""
    parts = []
    if title:
        parts.append(f"PROBLEM TITLE:\n{title}")
    if statement:
        parts.append(f"PROBLEM STATEMENT:\n{statement.strip()}")
    if solutions:
        listing = "\n".join(f"{i}. {name}" for i, (name, _) in enumerate(solutions, start=1))
        parts.append(
            f"THE EDITORIAL HAS {len(solutions)} SOLUTION(S) — write exactly one "
            f"\"approaches\" entry for each, in this order:\n{listing}"
        )
        for i, (name, code) in enumerate(solutions, start=1):
            if code:
                parts.append(
                    f"EDITORIAL PSEUDOCODE — solution {i} ({name}), comments removed. "
                    f"Write its code steps (short cues) from THIS, using only its names:\n{code}"
                )
    parts.append(f"EDITORIAL:\n{editorial.strip()}")
    parts.append("Return the JSON object now.")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Focused rewrite of ONE solution's code steps (revision_notes_manager.fix_steps)
# ---------------------------------------------------------------------------

STEPS_PROMPT = """You write the CODE STEPS for ONE solution of a coding editorial, for a revision sticky note. A student reads them the night before an interview, so each step is a short CUE that brings the code back to mind — not a translation of the code.

Rules:
- At most the step limit you are given (2–5), each ≤ 70 characters, ONE line, starting with a verb.
- Keep the steps that carry the idea and every check that makes it correct (validity, duplicate, edge conditions). Drop loop mechanics: no "loop i from 0 to n − 1", no break/continue, no initialising counters.
- Name only the KEY variables, using the editorial pseudocode's names EXACTLY (e.g. "Skip awarded if seen_subsets already has it"). Never rename anything and never invent a variable, function or helper.
- No numbering, bullets or markdown inside the steps.

Return ONLY a JSON array of strings, e.g. ["...", "..."]."""


def build_steps_message(
    name: str, editorial_code: str, previous: list[str], problems: list[str], limit: int = 5
) -> str:
    parts = [
        f"SOLUTION: {name}",
        f"STEP LIMIT: at most {limit} steps",
        f"EDITORIAL PSEUDOCODE (comments removed) — write the steps from this:\n{editorial_code}",
    ]
    if previous:
        parts.append("YOUR PREVIOUS STEPS:\n" + "\n".join(f"{i}. {st}" for i, st in enumerate(previous, start=1)))
    if problems:
        parts.append("PROBLEMS TO FIX:\n" + "\n".join(f"- {p}" for p in problems))
    parts.append("Return the JSON array now.")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Independent check of ONE solution's steps (revision_notes_manager.check_steps_faithful)
# ---------------------------------------------------------------------------

STEPS_FAITHFUL_PROMPT = """You check the CODE STEPS on a revision sticky note against the ORIGINAL editorial pseudocode they were written from. The steps are deliberately short cues for revision, not a full translation.

They are FAITHFUL when:
- read in order, they capture the solution's key steps — what it builds or iterates over, the decision that makes it work, and what it returns;
- every check that makes the solution correct is there (e.g. a validity check, a duplicate check, a zero/empty edge condition);
- nothing they say is wrong or misleading, and they use the pseudocode's names.

Leaving out loop mechanics (index ranges, break/continue, counter initialisation) and minor bookkeeping is fine and expected.

They are NOT faithful if a key step or a correctness check is missing, or anything stated is wrong.

Return ONLY one JSON object, no markdown fences:
{"faithful": true | false, "missing": ["<each missing key step/check or wrong statement, citing the pseudocode line>", "..."]}"""


def build_steps_faithful_message(name: str, editorial_code: str, steps: list[str]) -> str:
    listing = "\n".join(f"{i}. {st}" for i, st in enumerate(steps, start=1))
    return (
        f"SOLUTION: {name}\n\n"
        f"ORIGINAL EDITORIAL PSEUDOCODE:\n{editorial_code}\n\n"
        f"CODE STEPS ON THE NOTE:\n{listing}\n\n"
        "Return the JSON object now."
    )
