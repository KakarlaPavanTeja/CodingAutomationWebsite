"""Annotation phase: measure the generated testcases.json — never trim it.

The suite ships exactly as generated (the derive step already deduped, tagged,
ordered and weighted it). This step is pure measurement: it scores kills, verifies
TLE, and reports. Nothing here writes back to disk.

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
  testcase_selection.bucket_size
"""

from __future__ import annotations

import json
import os
import time

from testcase_selection import bucket_size


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


def _scenario_for(tc, tags: list) -> str:
    """The scenario key for a case — an `example` TAG OUTRANKS the declared name.

    Everything that treats public examples specially matches `scenario == "example"`
    exactly. Generators routinely declare a per-case name instead ("example_1",
    "example_2"), and taking that verbatim made every such match miss. The `example`
    tag is the reliable signal (`_is_edge_of` already trusts it), so normalize on it
    first and only then fall back to whatever the generator declared.
    """
    if "example" in tags:
        return "example"
    return tc.get("scenario") or _scenario_of(tags)


def _is_edge_of(tags: list) -> bool:
    # Public examples only. `size_edge` is deliberately NOT an edge signal: it is a
    # DISTRIBUTION label (B3 targets ~20% of the suite), not a keep-me marker.
    # Treating it as one let a mis-derived size tag mark 10531/10531 cases must-keep
    # and ship the entire generated pool. The generator's explicit `is_edge` field
    # is the edge signal.
    return "example" in tags


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
            "scenario": _scenario_for(tc, tags),
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
def annotate_kills(cases: list, wrong_solutions, batch_runner, log=None) -> set:
    """Run each wrong solution over the pool; record which cases catch it.

    wrong_solutions: iterable of (name, code). A case kills `name` when the
    wrong solution's output differs from the grounded stored output (or it
    errors/times out). Mutates c["kills"]; returns the set of wrong ids.
    `log` (optional callable) emits a per-solution progress line so the compiler
    poll output is attributable to a specific wrong solution."""
    wrong_solutions = list(wrong_solutions)
    inputs = [c["input"] for c in cases]
    expected = [_norm_out(c["output"]) for c in cases]
    wrong_ids = set()
    for i, (name, code) in enumerate(wrong_solutions, 1):
        wrong_ids.add(name)
        if log:
            log(f"  → wrong {i}/{len(wrong_solutions)}: {name} — running {len(cases)} case(s) in parallel…")
        t0 = time.time()
        results = batch_runner(code, inputs)
        dt = time.time() - t0
        caught = 0
        for c, exp, res in zip(cases, expected, results):
            out, status = res
            got = _norm_out(out)
            if status != "ok" or got != exp:
                c["kills"].add(name)
                caught += 1
        if log:
            verdict = "caught" if caught else "NOT CAUGHT (no case discriminates it)"
            log(f"     {name}: {verdict} by {caught}/{len(cases)} case(s)  ({dt:.1f}s)")
    return wrong_ids


# --------------------------------------------------------------------------- #
# 3. TLE annotation — inject tle_batch_runner(code, inputs) -> [(out, status), ...]
# --------------------------------------------------------------------------- #
def annotate_tle(cases: list, brute_code, tle_batch_runner, max_n: int,
                 size_kind: str = "count", log=None) -> int:
    """Time the brute force on large-bucket cases; a timeout is a verified TLE.

    All large cases run in ONE parallel batch (`tle_batch_runner(code, inputs)`
    -> [(out, status), ...] at the TLE limit). Conditional (spec §5): only
    meaningful when a large regime exists. Returns the number of verified-TLE
    cases (0 when there is no brute or no large regime — N/A, never a failure)."""
    if not brute_code or size_kind == "none":
        return 0
    large = [c for c in cases if bucket_size(c["size_metric"], max_n) == "large"]
    if not large:
        if log:
            log("  → no large-regime case(s) — TLE N/A")
        return 0
    if log:
        log(f"  → timing brute force on {len(large)} large-regime case(s) in one parallel batch…")
    t0 = time.time()
    results = tle_batch_runner(brute_code, [c["input"] for c in large])
    dt = time.time() - t0
    n = 0
    for c, res in zip(large, results):
        _out, status = res
        if status == "timeout":
            c["is_tle"] = True
            n += 1
    if log:
        log(f"     {n}/{len(large)} large case(s) exceeded the limit → verified TLE  ({dt:.1f}s)")
    return n


# --------------------------------------------------------------------------- #
# 4. Dead-case count — the selector's diagnostic signal, without its authority
# --------------------------------------------------------------------------- #
def count_dead_cases(cases: list) -> int:
    """Cases that killed no wrong solution. Informational — nothing acts on it.

    With no selector, a suite of 200 cases all walking the same easy path still ships.
    This number is what makes that visible in the log.
    """
    return sum(1 for c in cases if not (c.get("kills") or set()))


def ship_order(raw_cases: list) -> list:
    """The order the suite SHIPS in: examples first, then ascending input size.

    The deleted selector returned cases in selection-PRIORITY order (examples, verified
    TLE, kill cover, slot coverage, edges, then the greedy fill) and renumbered `order`
    over it. That is an argument about which cases to keep, not about how the suite
    should read: it put the LARGEST stress cases at position 3, clumped the edges at the
    end, and interleaved every subtask tier.

    So sort by payload size ascending: the suite reads small -> large, which is also the
    order a submission should be graded in. Examples are pinned to the front because
    `prepare_platform_json` marks visibility positionally (`is_hidden = order > 2`), so
    a size sort that demoted an example would hide it from the problem statement.
    """
    from testcase_helpers import testcase_payload_byte_size

    examples, rest = [], []
    for tc in raw_cases:
        is_example = "example" in (tc.get("tags") or []) or tc.get("scenario") == "example"
        (examples if is_example else rest).append(tc)
    # Payload bytes ONLY — a graded run must walk small inputs before big ones, so the
    # first failure a submission hits is a case a human can read. Tier was the primary
    # key here, which only tracks size when `sync_subtask_tags` assigned the tiers (it
    # orders them by size bucket then payload); a generator that emits its OWN semantic
    # subtask_<n> tags made the shipped suite jump from a 200KB tier-1 stress case to a
    # 12-byte tier-2 one. Nothing downstream needs the tiers contiguous — B3 checks their
    # COUNTS, and the platform JSON only reads `order` for `is_hidden` — so sort on the
    # size the requirement is actually about.
    rest.sort(key=testcase_payload_byte_size)
    return examples + rest


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


def run_annotation(outputs_dir: str = "Outputs") -> dict:
    """Measure the on-disk suite: score kills, verify TLE, report. Writes nothing.

    The suite ships exactly as generated — there is no trimming and no write-back, so
    a re-run is idempotent and needs no raw-pool snapshot. Returns the report dict.
    Uses benchmark_suite's real runners; the pure annotate_* functions above are what
    the unit tests exercise with fakes."""
    from benchmark_suite import (
        run_solutions_batch,
        BENCHMARK_RUN_TIMEOUT,
    )

    # Quiet the compiler's per-poll chatter ("poll N/480 -> PROCESSING"); our own
    # framed per-batch lines carry the progress. Only when the compiler is in use.
    if os.environ.get("BENCHMARK_USE_COMPILER", "").strip().lower() in ("1", "true", "yes"):
        try:
            import execution_manager_v3 as _emv3
            _emv3.QUIET = True
        except Exception:
            pass

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

    log("=== VALIDATE TEST CASES (no trimming — the generated suite ships) ===")

    cases, max_n = load_cases(tc_path, desc)
    if not cases:
        raise SystemExit("annotation: testcases.json has no cases")
    size_kind, space_mode = determine_size_model(cases, max_n)
    log(f"[1/3] Loaded {len(cases)} case(s)  ·  "
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

    def tle_batch_runner(code, inputs):
        # Brute force timed against the problem limit; a per-input timeout = TLE.
        return run_solutions_batch(code, inputs, tle_limit)

    if wrong:
        log(f"[2/3] Scoring kills: running {len(wrong)} wrong solution(s) over "
            f"{len(cases)} case(s)…")
    else:
        log("[2/3] Scoring kills: SKIPPED (no wrong_solutions/*.py found)")
    wrong_ids = annotate_kills(cases, wrong, batch_runner, log=log)

    killed = set().union(*[c["kills"] for c in cases]) if cases else set()
    uncatchable = sorted(wrong_ids - killed)
    dead = count_dead_cases(cases)
    log(f"      · wrong sols caught   {len(wrong_ids & killed)}/{len(wrong_ids)}"
        + (f"  ⚠ uncatchable: {', '.join(uncatchable)}" if uncatchable else ""))
    # Not a failure on its own: a case can be correct and still discriminate nothing.
    # It is the one number that says whether the suite is broad or merely long.
    log(f"      · killed nothing      {dead}/{len(cases)} case(s)")

    if brute and size_kind != "none":
        log(f"[3/3] Brute-force TLE on large-regime case(s) "
            f"(limit {tle_limit:g}s; a timeout = verified TLE)…")
    else:
        why = "no brute force" if not brute else "no size dimension"
        log(f"[3/3] Brute-force TLE: N/A ({why})")
    tle_n = annotate_tle(cases, brute, tle_batch_runner, max_n, size_kind, log=log)
    log(f"      · verified brute TLE  {tle_n}"
        + ("" if (brute and size_kind != "none") else "  (N/A)"))

    report = {
        "total": len(cases),
        "kills_covered": len(wrong_ids & killed),
        "kills_total": len(wrong_ids),
        "uncatchable": uncatchable,
        "dead_cases": dead,
        "tle_verified": tle_n,
    }

    # Merged benchmark: report-only mutation/coverage/fuzz on the shipped suite.
    # B2 (wrong-approach gate) reuses the kill data we just computed — `uncatchable`
    # is exactly the set of wrong solutions the final suite fails to catch — so we
    # never re-run the wrong solutions. Informational only: a benchmark failure must
    # not fail this step, whose real deliverable is the annotation report.
    from benchmark_suite import b2_verdict
    b2 = b2_verdict(
        report["kills_total"],
        [{"file": f, "reused_from_annotation": True} for f in uncatchable],
        cases,
        desc,
    )
    # Abstention otherwise only surfaces inside print_report, which runs in a try/except
    # — and B2 is the only blocking gate, so "it did not judge" belongs in the summary.
    if b2.get("cannot_judge"):
        log(f"      · B2 gate CANNOT JUDGE — {b2.get('reason')}. Not a pass: "
            f"this suite ships with no blocking quality gate.")

    try:
        from benchmark_suite import run_benchmark, print_report, DEFAULT_MIN_KILL
        brute_path = None
        for name in ("BRUTE_FORCE.py", "BRUTE.py"):
            p = os.path.join(outputs_dir, "generatedFullCode", name)
            if os.path.exists(p):
                brute_path = p
                break
        if not brute_path:
            p = os.path.join(outputs_dir, "generated_brute_force.py")
            brute_path = p if os.path.exists(p) else None
        log("")
        log("=== BENCHMARK (report-only; injects bugs to measure suite strength) ===")
        bench = run_benchmark(
            optimal_path=os.path.join(outputs_dir, "generatedFullCode", "PYTHON.py"),
            testcases_path=tc_path,
            description_path=os.path.join(outputs_dir, "generated_description.md"),
            brute_path=brute_path,
            precomputed_b2=b2,
        )
        print_report(bench, DEFAULT_MIN_KILL, report_only=True)
    except Exception as e:
        log(f"⚠ benchmark (informational) skipped — {type(e).__name__}: {e}")

    # B2 is the only blocking quality gate left (the selector is gone), so it blocks
    # here — outside the try, so a benchmark crash cannot swallow the verdict.
    if b2.get("hard_fail"):
        if b2.get("missing"):
            log("ERROR: no wrong_solutions/*.py found. B2 is the only blocking quality "
                "gate; with nothing to discriminate, the suite is unvalidated. "
                "Run Generate Wrong Solutions, then re-run this step.")
        else:
            names = ", ".join(f["file"] for f in b2.get("failures") or [])
            log(f"ERROR: known-wrong solution(s) pass every test case ({names}). "
                "The suite does not discriminate them. Refusing to ship. "
                "Add cases that expose the wrong approach, or re-run Generate Test Cases.")
        raise SystemExit(1)

    return report


if __name__ == "__main__":
    import argparse

    root = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    ap = argparse.ArgumentParser(description="Annotate + benchmark the testcase suite")
    ap.parse_args()
    run_annotation()
