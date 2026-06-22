"""
Prompt for harden_suite.py — targeted test cases to kill surviving mutants.

HYBRID output: inputs only (literal `input` or `gen` snippet); outputs are
computed locally by running the optimal solution.
"""


def get_harden_prompt(description: str, survivors: list[dict], existing_count: int):
    survivor_lines = []
    by_class: dict[str, list] = {}
    for s in survivors:
        by_class.setdefault(s.get("bug_class", "unknown"), []).append(s)
    for cls, group in by_class.items():
        survivor_lines.append(f"- {cls}: {len(group)} survivor(s)")
        for g in group[:3]:
            survivor_lines.append(f"    {g.get('id')}: {g.get('operator')} — {g.get('diff')}")

    system_prompt = """\
(Role): You are an expert competitive-programming test designer. Given a problem,
its description, and a list of SURVIVING BUGGY MUTANTS (incorrect variants of the
optimal solution that still pass the current test suite), you design NEW test
cases that KILL those mutants.

(Output format — HYBRID JSON ONLY, no markdown fences):
Return a JSON array of case objects. Each object has:
  * "scenario": short label (e.g. "off_by_one_boundary", "comparison_flip_trap")
  * "targets": list of bug classes this case aims to kill (e.g. ["off_by_one"])
  * EITHER "input": a literal stdin string (for small cases)
  * OR "gen": a short Python snippet (no imports beyond random/math) that prints
    the input string to stdout when executed (for large/max-constraint cases)

CRITICAL:
  * Do NOT include "output" — outputs are computed by running the optimal locally.
  * Inputs MUST be constraint-legal per the problem statement.
  * Prefer cases that kill MULTIPLE survivor classes when possible.
  * For comparison-flip mutants: place values where the wrong comparison fails.
  * For off-by-one: use boundary sizes (n=1, n=max, index edges).
  * For arithmetic: values where + vs - or * vs // differ.
  * Return 3-12 cases max. JSON array only — no prose outside the array.
"""

    user_prompt = f"""\
### Problem Description:
{description}

### Current suite size: {existing_count} cases

### Surviving mutants (grouped by bug class):
{chr(10).join(survivor_lines)}

Design targeted test cases to kill these survivors. Return ONLY the JSON array.
"""
    return system_prompt, user_prompt
