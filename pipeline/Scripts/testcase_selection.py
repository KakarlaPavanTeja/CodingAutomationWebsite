"""Deterministic, LLM-free testcase selection core.

Turns an annotated candidate pool (list of case dicts) into the final suite:
dedup exact inputs, bucket by model-declared size, then guarantee + fill-to-cap
selection. Pure functions only — no subprocess, network, clock, or randomness.

Case record (the contract with the annotation phase):
    id: str            stable unique id (e.g. "c0007")
    input: str         raw stdin the solution parses
    output: str        expected output (from reference solution)
    size_metric: int   model-declared numeric size (n / len / rows*cols / ...)
    max_n: int         problem-level MAX_N
    subtask: str       e.g. "S1".."S8"
    scenario: str      e.g. "answer_at_end", "duplicates"
    is_edge: bool      came from the generator's EDGE_CASES section
    is_tle: bool       brute force verified-timed-out on this case
    kills: set[str]    ids of wrong solutions this case catches
"""

import hashlib
from collections import Counter

# Bucket thresholds as proportions of MAX_N. edge is degenerate (<=1);
# small up to SMALL_FRAC; large from LARGE_FRAC; medium is the gap.
SMALL_FRAC = 0.2
LARGE_FRAC = 0.5

# Selection bounds (callers may override from env).
CASE_CAP = 150
CASE_FLOOR = 25


def bucket_size(size_metric: int, max_n: int) -> str:
    """Bucket a case by its model-declared size_metric against MAX_N."""
    n = max(0, int(size_metric))
    m = max(1, int(max_n))
    if n <= 1:
        return "edge"
    if n >= LARGE_FRAC * m:
        return "large"
    if n <= SMALL_FRAC * m:
        return "small"
    return "medium"


def normalize_input(raw: str) -> str:
    """Normalize input for dedup: strip trailing whitespace per line, drop
    trailing blank lines, unify newlines. Internal structure is preserved so
    genuinely different layouts stay distinct."""
    lines = str(raw).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines = [ln.rstrip() for ln in lines]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def dedup_by_input(cases):
    """Drop cases whose normalized input already appeared. Keep first occurrence
    in order. Returns (unique_cases, dropped_count)."""
    seen = set()
    unique = []
    dropped = 0
    for c in cases:
        h = hashlib.sha1(normalize_input(c["input"]).encode("utf-8")).hexdigest()
        if h in seen:
            dropped += 1
            continue
        seen.add(h)
        unique.append(c)
    return unique, dropped


def _slot(c):
    return (c["subtask"], c["bucket"], c["scenario"])


def _add(sel, seen_ids, c):
    if c["id"] not in seen_ids:
        seen_ids.add(c["id"])
        sel.append(c)


def guarantee_pass(cases, wrong_ids):
    """Must-haves: all edges, all TLE cases, one case per slot, then greedy
    set-cover so every wrong solution is killed. Deterministic (id-ordered)."""
    wrong_ids = set(wrong_ids)
    ordered = sorted(cases, key=lambda c: c["id"])
    sel, seen = [], set()

    for c in ordered:                       # 1. all edges
        if c.get("is_edge"):
            _add(sel, seen, c)
    for c in ordered:                       # 2. all TLE
        if c.get("is_tle"):
            _add(sel, seen, c)

    slots_needed = {_slot(c) for c in ordered}      # 3. slot coverage
    covered = {_slot(c) for c in sel}
    for slot in sorted(slots_needed - covered):
        cands = [c for c in ordered if _slot(c) == slot]
        best = sorted(cands, key=lambda c: (-len(c["kills"]), -c["size_metric"], c["id"]))[0]
        _add(sel, seen, best)
        covered.add(slot)

    killed = set().union(*[c["kills"] for c in sel]) if sel else set()   # 4. kill cover
    remaining = [c for c in ordered if c["id"] not in seen]
    while wrong_ids - killed:
        need = wrong_ids - killed
        ranked = sorted(remaining,
                        key=lambda c: (-len(c["kills"] & need), -c["size_metric"], c["id"]))
        if not ranked or not (ranked[0]["kills"] & need):
            break
        pick = ranked[0]
        _add(sel, seen, pick)
        killed |= pick["kills"]
        remaining = [c for c in remaining if c["id"] != pick["id"]]

    report = {
        "slots_total": len(slots_needed),
        "slots_filled": len({_slot(c) for c in sel}),
        "edges": sum(1 for c in sel if c.get("is_edge")),
        "tle": sum(1 for c in sel if c.get("is_tle")),
        "kills_total": len(wrong_ids),
        "kills_covered": len(wrong_ids & killed),
        "uncatchable": sorted(wrong_ids - killed),
    }
    return sel, report


def _fill_pass(selected, seen, remaining, cap):
    """Grow to cap by: marginal-kills -> least-represented slot -> size spread."""
    killed = set().union(*[c["kills"] for c in selected]) if selected else set()
    slot_counts = Counter(_slot(c) for c in selected)
    sizes_by_slot = {}
    for c in selected:
        sizes_by_slot.setdefault(_slot(c), []).append(c["size_metric"])

    while len(selected) < cap and remaining:
        def rank(c):
            new_kills = len(c["kills"] - killed)
            slot = _slot(c)
            sizes = sizes_by_slot.get(slot, [])
            spread = min((abs(c["size_metric"] - s) for s in sizes), default=c["max_n"])
            return (-new_kills, slot_counts.get(slot, 0), -spread, c["id"])
        remaining.sort(key=rank)
        pick = remaining.pop(0)
        _add(selected, seen, pick)
        killed |= pick["kills"]
        slot_counts[_slot(pick)] += 1
        sizes_by_slot.setdefault(_slot(pick), []).append(pick["size_metric"])
    return selected


def select_suite(cases, wrong_ids, max_n, cap=CASE_CAP, floor=CASE_FLOOR,
                 size_kind="count", space_mode="sampled"):
    """Full pipeline: bucket -> dedup -> guarantee pass -> fill to cap.

    size_kind: "count"|"value"|"grid"|"multi" use size_metric bucketing;
        "none" (no size dimension) puts every case in a single "flat" bucket so
        coverage is driven by subtask x scenario only.
    space_mode: "sampled" (huge input space, target the cap) or "exhaustive"
        (small input space enumerated in full — a below-cap count is COMPLETE,
        never a shortfall).

    Returns (selected_cases, report)."""
    generated = len(cases)
    for c in cases:
        c["bucket"] = "flat" if size_kind == "none" else bucket_size(c["size_metric"], max_n)
        c["kills"] = set(c.get("kills") or set())
    unique, _dropped = dedup_by_input(cases)
    selected, report = guarantee_pass(unique, wrong_ids)
    seen = {c["id"] for c in selected}
    remaining = [c for c in unique if c["id"] not in seen]
    selected = _fill_pass(selected, seen, remaining, cap)
    exhaustive = space_mode == "exhaustive"
    report.update({
        "generated": generated,
        "unique": len(unique),
        "selected": len(selected),
        "size_kind": size_kind,
        "space_mode": space_mode,
        "exhaustive_complete": exhaustive,
        # A short SAMPLED suite is a shortfall; an exhaustive one is complete.
        "below_floor": (not exhaustive) and (len(selected) < floor),
    })
    return selected, report


def format_funnel(report):
    """One-line human funnel for the select_testcases step log."""
    line = " → ".join([
        f"generated {report['generated']}",
        f"unique {report['unique']}",
        f"selected {report['selected']} "
        f"(edges {report['edges']}, tle {report['tle']}, "
        f"slots {report['slots_filled']}/{report['slots_total']}, "
        f"kills {report['kills_covered']}/{report['kills_total']})",
    ])
    flags = []
    if report.get("uncatchable"):
        flags.append("uncatchable: " + ", ".join(report["uncatchable"]))
    if report.get("exhaustive_complete"):
        flags.append(f"exhaustive: complete {report['selected']}/{report['unique']}")
    if report.get("below_floor"):
        flags.append("BELOW FLOOR")
    if flags:
        line += "  [" + "; ".join(flags) + "]"
    return line
