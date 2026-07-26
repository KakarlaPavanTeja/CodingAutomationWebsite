"""Annotation phase: turn a generated testcases.json into the annotated case
pool that `testcase_selection.select_suite` consumes, then write back the
selected suite.

Three jobs, all deterministic given their inputs:
  1. load_cases   — adapt each stored test case into a case record
                    (id/input/output/subtask/scenario/is_edge/size_metric/max_n).
  2. annotate_kills — run every wrong solution over the pool; a case "kills" a
                      wrong solution when its output differs from the grounded
                      stored output (the reference's answer).
  3. annotate_tle — time the brute force on large-regime cases; a timeout is a
                    verified TLE (outcome criterion #4).

Subprocess execution is injected (batch_runner / one_runner) so the logic is
unit-testable with fakes — no real solutions needed in tests. The orchestrator
`run_annotation` wires the real benchmark_suite runners.

Reuses existing helpers rather than reinventing:
  testcase_helpers.parse_primary_n / parse_constraint_max_n / tier_from_testcase
  testcase_selection.bucket_size / select_suite / format_funnel
"""

from __future__ import annotations

import json
import os

from testcase_selection import bucket_size, select_suite, format_funnel


# --------------------------------------------------------------------------- #
# Output normalization — MUST match benchmark_suite.normalize so a kill here
# means a kill there: strip trailing whitespace per line, then trailing blanks.
# --------------------------------------------------------------------------- #
def _norm_out(text) -> str:
    if text is None:
        return ""
    return "\n".join(line.rstrip() for line in str(text).splitlines()).rstrip()


# --------------------------------------------------------------------------- #
# 1. Load + adapt stored cases into case records
# --------------------------------------------------------------------------- #
_STRUCTURAL_TAGS = {"example", "adversarial", "wrong_soln_harden", "stress"}


def _tags(tc) -> list:
    tags = tc.get("tags") or []
    return [str(t) for t in tags if isinstance(t, str)]


def _subtask_of(tc) -> str:
    from testcase_helpers import tier_from_testcase
    tier = tier_from_testcase(tc)
    return f"S{tier}" if tier else "S1"


def _scenario_of(tags: list) -> str:
    if "example" in tags:
        return "example"
    for t in tags:
        if t.startswith("subtask_") or t.startswith("size_"):
            continue
        if t in _STRUCTURAL_TAGS:
            continue
        return t
    return "default"


def _is_edge_of(tags: list) -> bool:
    # Legacy: size_edge cases and the public examples are always-keep literals —
    # exactly the "must include unconditionally" semantics of an EDGE case.
    return ("size_edge" in tags) or ("example" in tags)


def load_cases(testcases_json_path: str, description: str = "") -> tuple[list, int]:
    """Read testcases.json (list- or dict-wrapped) into case records.

    Returns (cases, max_n). Each case record carries the raw stored dict under
    `_raw` so the selected suite can be written back with tags/weightage intact.
    """
    from testcase_helpers import parse_primary_n, parse_constraint_max_n

    with open(testcases_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        root = data[0]
    elif isinstance(data, dict):
        root = data
    else:
        root = {}
    raw_cases = root.get("test_cases", []) or []

    # Root-level declared size model (new generator). max_n from the declaration wins
    # over parsing the description; kind/space_mode are stamped on each case so
    # determine_size_model prefers them over inference.
    declared = root.get("size_model") if isinstance(root.get("size_model"), dict) else {}
    declared_kind = declared.get("kind")
    declared_max = declared.get("max_n")
    declared_space = root.get("space_mode")
    max_n = (declared_max if isinstance(declared_max, int) and declared_max > 0
             else parse_constraint_max_n(description) or 0)
    cases = []
    for idx, tc in enumerate(raw_cases):
        tags = _tags(tc)
        inp = tc.get("input", "") or ""
        # Prefer a model-declared size_metric (new generator); else derive it.
        size_metric = tc.get("size_metric")
        if not isinstance(size_metric, int):
            size_metric = parse_primary_n(inp) or 0
        order = tc.get("order")
        cid = f"c{int(order):04d}" if isinstance(order, int) else f"c{idx:04d}"
        cases.append({
            "id": cid,
            "input": inp,
            "output": tc.get("output", "") or "",
            "subtask": tc.get("subtask") or _subtask_of(tc),
            "scenario": tc.get("scenario") or _scenario_of(tags),
            "is_edge": bool(tc.get("is_edge")) or _is_edge_of(tags),
            "is_tle": bool(tc.get("is_tle")),
            "size_metric": int(size_metric),
            "max_n": int(max_n),
            "kills": set(),
            "size_kind": declared_kind,
            "space_mode": declared_space,
            "_raw": tc,
        })
    return cases, int(max_n)


def determine_size_model(cases: list, max_n: int) -> tuple[str, str]:
    """Infer (size_kind, space_mode) for legacy suites.

    A model-declared size_model on the cases wins. Otherwise: no usable size
    dimension (no MAX_N, or no case exposes a primary n > 1) -> "none" so
    selection buckets flat. Legacy suites are always "sampled" (a generator that
    enumerated its whole input space must say so explicitly)."""
    for c in cases:
        raw = c.get("_raw") or {}
        kind = c.get("size_kind") or raw.get("size_kind")
        space = c.get("space_mode") or raw.get("space_mode")
        if kind or space:
            return (kind or "count", space or "sampled")
    has_dim = max_n and max_n > 2 and any(c["size_metric"] > 1 for c in cases)
    return ("count" if has_dim else "none", "sampled")


# --------------------------------------------------------------------------- #
# 2. Kill annotation — inject batch_runner(code, inputs) -> [(out, status), ...]
# --------------------------------------------------------------------------- #
def annotate_kills(cases: list, wrong_solutions, batch_runner) -> set:
    """Run each wrong solution over the pool; record which cases catch it.

    wrong_solutions: iterable of (name, code). A case kills `name` when the
    wrong solution's output differs from the grounded stored output (or it
    errors/times out). Mutates c["kills"]; returns the set of wrong ids."""
    inputs = [c["input"] for c in cases]
    expected = [_norm_out(c["output"]) for c in cases]
    wrong_ids = set()
    for name, code in wrong_solutions:
        wrong_ids.add(name)
        results = batch_runner(code, inputs)
        for c, exp, res in zip(cases, expected, results):
            out, status = res
            got = _norm_out(out)
            if status != "ok" or got != exp:
                c["kills"].add(name)
    return wrong_ids


# --------------------------------------------------------------------------- #
# 3. TLE annotation — inject one_runner(code, stdin) -> (out, status)
# --------------------------------------------------------------------------- #
def annotate_tle(cases: list, brute_code, one_runner, max_n: int,
                 size_kind: str = "count") -> int:
    """Time the brute force on large-bucket cases; a timeout is a verified TLE.

    Conditional (spec §5): only meaningful when a large regime exists. Returns
    the number of verified-TLE cases (0 when there is no brute or no large
    regime — reported as N/A upstream, never a failure)."""
    if not brute_code or size_kind == "none":
        return 0
    n = 0
    for c in cases:
        if bucket_size(c["size_metric"], max_n) != "large":
            continue
        _out, status = one_runner(brute_code, c["input"])
        if status == "timeout":
            c["is_tle"] = True
            n += 1
    return n


# --------------------------------------------------------------------------- #
# Write back — rebuild testcases.json from the selected records, shape preserved
# --------------------------------------------------------------------------- #
def write_selected(testcases_json_path: str, selected: list) -> None:
    """Overwrite testcases.json keeping only the selected cases, in order.

    The stored dict (`_raw`) is reused verbatim so tags/weightage/output survive;
    `order` is renumbered 1..N over the selected suite."""
    with open(testcases_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    new_cases = []
    for i, c in enumerate(selected, start=1):
        raw = dict(c.get("_raw") or {})
        raw["order"] = i
        new_cases.append(raw)

    if isinstance(data, list) and data and isinstance(data[0], dict):
        data[0]["test_cases"] = new_cases
    elif isinstance(data, dict):
        data["test_cases"] = new_cases
    else:
        data = {"test_cases": new_cases}

    with open(testcases_json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


# --------------------------------------------------------------------------- #
# Orchestrator — wires the real benchmark_suite runners
# --------------------------------------------------------------------------- #
def _read(path: str) -> str | None:
    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    return None


def _discover_wrong_solutions(wrong_dir: str):
    import glob
    out = []
    for p in sorted(glob.glob(os.path.join(wrong_dir, "*.py"))):
        code = _read(p)
        if code and code.strip():
            out.append((os.path.basename(p), code))
    return out


def run_annotation(outputs_dir: str = "Outputs", cap: int = None, floor: int = None):
    """Full annotation over the on-disk pipeline outputs, then select + write.

    Returns the selection report. Uses benchmark_suite's real runners; the pure
    annotate_* functions above are what the unit tests exercise with fakes."""
    from benchmark_suite import (
        run_solutions_batch,
        run_solution,
        BENCHMARK_RUN_TIMEOUT,
    )

    tc_path = os.path.join(outputs_dir, "testcases.json")
    desc = _read(os.path.join(outputs_dir, "generated_description.md")) or ""
    reference = _read(os.path.join(outputs_dir, "generatedFullCode", "PYTHON.py"))
    brute = None
    for name in ("BRUTE_FORCE.py", "BRUTE.py"):
        brute = brute or _read(os.path.join(outputs_dir, "generatedFullCode", name))
    brute = brute or _read(os.path.join(outputs_dir, "generated_brute_force.py"))
    wrong = _discover_wrong_solutions(os.path.join(outputs_dir, "wrong_solutions"))

    def log(msg):
        print(msg, flush=True)

    log("=== SELECT TEST CASES (dedup → annotate → select ≤" f"{cap or 150}) ===")

    cases, max_n = load_cases(tc_path, desc)
    if not cases:
        raise SystemExit("annotation: testcases.json has no cases")
    size_kind, space_mode = determine_size_model(cases, max_n)
    log(f"[1/4] Loaded {len(cases)} candidate case(s)  ·  "
        f"size_model={size_kind} (max_n={max_n})  ·  space={space_mode}")
    log(f"      oracles: reference={'present' if reference else 'MISSING'}  ·  "
        f"brute-force={'present' if brute else 'absent'}  ·  "
        f"wrong-solutions={len(wrong)}")

    def batch_runner(code, inputs):
        return run_solutions_batch(code, inputs, BENCHMARK_RUN_TIMEOUT)

    # TLE is measured against the PROBLEM's time limit, not an arbitrary bound. Default
    # to 4s — the Python judge limit this platform uses; override per problem/platform
    # with TESTCASE_TLE_LIMIT_SEC. A brute that exceeds this on a large case = verified TLE.
    _TLE_DEFAULT_SEC = 4.0
    _tle_env = os.environ.get("TESTCASE_TLE_LIMIT_SEC", "").strip()
    try:
        tle_limit = float(_tle_env) if _tle_env else _TLE_DEFAULT_SEC
    except ValueError:
        tle_limit = _TLE_DEFAULT_SEC
    tle_limit = max(0.5, tle_limit)

    def one_runner(code, stdin):
        return run_solution(code, stdin, tle_limit)

    if wrong:
        log(f"[2/4] Scoring kills: running {len(wrong)} wrong solution(s) over "
            f"{len(cases)} case(s)…")
    else:
        log("[2/4] Scoring kills: SKIPPED (no wrong_solutions/*.py found)")
    wrong_ids = annotate_kills(cases, wrong, batch_runner)

    if brute and size_kind != "none":
        log(f"[3/4] Verifying brute-force TLE on large-regime case(s) "
            f"(limit {tle_limit:g}s; a timeout = verified TLE)…")
    else:
        why = "no brute force" if not brute else "no size dimension"
        log(f"[3/4] Brute-force TLE: N/A ({why})")
    tle_n = annotate_tle(cases, brute, one_runner, max_n, size_kind)

    kwargs = {"size_kind": size_kind, "space_mode": space_mode}
    if cap is not None:
        kwargs["cap"] = cap
    if floor is not None:
        kwargs["floor"] = floor
    selected, report = select_suite(cases, wrong_ids, max_n, **kwargs)
    report["tle_verified"] = tle_n
    report["reference_present"] = bool(reference)

    write_selected(tc_path, selected)

    dropped = report["generated"] - report["unique"]
    log(f"[4/4] Selected {report['selected']} of {report['unique']} unique "
        f"({dropped} exact-input duplicate(s) removed):")
    log("      " + format_funnel(report))
    # Human-readable verdict lines so the log states plainly what was achieved.
    log(f"      · edges kept          {report['edges']}")
    log(f"      · verified brute TLE  {tle_n}"
        + ("" if (brute and size_kind != "none") else "  (N/A)"))
    log(f"      · slot coverage       {report['slots_filled']}/{report['slots_total']}")
    log(f"      · wrong sols caught   {report['kills_covered']}/{report['kills_total']}"
        + (f"  ⚠ uncatchable: {', '.join(report['uncatchable'])}" if report.get("uncatchable") else ""))
    if report.get("exhaustive_complete"):
        log(f"      ✓ exhaustive: shipped the complete input space "
            f"({report['selected']} case(s))")
    elif report.get("below_floor"):
        log(f"      ⚠ BELOW FLOOR: only {report['selected']} case(s) — the generator "
            f"pool was too small; consider raising the candidate count.")
    log(f"Wrote {report['selected']} case(s) → {tc_path}")
    return report


if __name__ == "__main__":
    import argparse

    root = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    ap = argparse.ArgumentParser(description="Annotate + select the final testcase suite")
    ap.add_argument("--cap", type=int, default=None)
    ap.add_argument("--floor", type=int, default=None)
    args = ap.parse_args()
    run_annotation(cap=args.cap, floor=args.floor)
