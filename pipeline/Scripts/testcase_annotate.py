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
import time

from testcase_selection import (
    CASE_CAP,
    CASE_FLOOR,
    bucket_size,
    fill_target,
    format_funnel,
    select_suite,
)


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
    """The scenario key used for slot coverage — an `example` TAG OUTRANKS the declared name.

    `guarantee_pass` force-keeps public examples by matching `scenario == "example"`
    exactly. Generators routinely declare a per-case name instead ("example_1",
    "example_2"), and taking that verbatim made the force-keep miss: both examples fell
    through to the bounded edge pass, which a full cap then dropped, and the shipped
    suite opened on a stress case instead of the description's Examples 1 & 2.
    The `example` tag is the reliable signal (`_is_edge_of` already trusts it), so
    normalize on it first and only then fall back to whatever the generator declared.
    """
    if "example" in tags:
        return "example"
    return tc.get("scenario") or _scenario_of(tags)


def _is_edge_of(tags: list) -> bool:
    # Public examples only. `size_edge` is deliberately NOT an edge signal: it is a
    # DISTRIBUTION label (B3 targets ~20% of the suite), not a keep-me marker.
    # Treating it as one let a mis-derived size tag mark 10531/10531 cases must-keep
    # and ship the entire generated pool. The generator's explicit `is_edge` field
    # is the edge signal; the cap in guarantee_pass bounds it either way.
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
# Write back — rebuild testcases.json from the selected records, shape preserved
# --------------------------------------------------------------------------- #
def write_selected(testcases_json_path: str, selected: list,
                   suite_complete: bool = False) -> None:
    """Overwrite testcases.json keeping only the selected cases, in order.

    The stored dict (`_raw`) is reused verbatim so tags/weightage/output survive;
    `order` is renumbered 1..N over the selected suite.

    `suite_complete` records that a below-floor suite is the WHOLE available input
    space, not a shortfall. Selection is the only step that sees the candidate pool,
    so downstream count gates (benchmark B3) cannot work this out for themselves.
    """
    with open(testcases_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    new_cases = []
    for i, c in enumerate(selected, start=1):
        raw = dict(c.get("_raw") or {})
        raw["order"] = i
        new_cases.append(raw)

    # Stamp `selected` so a re-run of select can tell this file is a trimmed suite
    # (and should reload the raw pool) rather than a fresh generator pool.
    stamp = {"test_cases": new_cases, "selected": True,
             "suite_complete": bool(suite_complete)}
    if isinstance(data, list) and data and isinstance(data[0], dict):
        data[0].update(stamp)
    elif isinstance(data, dict):
        data.update(stamp)
    else:
        data = dict(stamp)

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


def _resolve_difficulty(outputs_dir: str):
    """(difficulty, source) using the pipeline's own precedence.

    Delegates to llm_client so this step can never route on a different difficulty
    than the rest of the pipeline. That module pulls in the LLM SDK, which selection
    otherwise has no use for — so an import failure degrades to the same
    owner-env > generated_difficulty.txt precedence rather than killing the step over
    a lookup whose only job is choosing a suite size.
    """
    try:
        from llm_client import resolve_pipeline_difficulty
        return resolve_pipeline_difficulty(outputs_dir)
    except Exception:
        owner = os.environ.get("PIPELINE_OWNER_DIFFICULTY", "").strip().lower()
        if owner:
            return owner, "owner"
        generated = (_read(os.path.join(outputs_dir, "generated_difficulty.txt")) or "")
        generated = generated.strip().lower()
        return (generated, "llm") if generated else (None, "default")


def _discover_wrong_solutions(wrong_dir: str):
    import glob
    out = []
    for p in sorted(glob.glob(os.path.join(wrong_dir, "*.py"))):
        code = _read(p)
        if code and code.strip():
            out.append((os.path.basename(p), code))
    return out


def run_annotation(outputs_dir: str = "Outputs", cap: int = None, floor: int = None,
                   difficulty: str = None, count: int = None):
    """Full annotation over the on-disk pipeline outputs, then select + write.

    Returns the selection report. Uses benchmark_suite's real runners; the pure
    annotate_* functions above are what the unit tests exercise with fakes."""
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

    # Difficulty picks the fill target inside [floor, cap]. Reuses the pipeline's own
    # precedence (owner override > generated_difficulty.txt > medium) so this step can
    # never disagree with the difficulty the rest of the pipeline routed on.
    diff_source = "explicit"
    if not difficulty:
        difficulty, diff_source = _resolve_difficulty(outputs_dir)

    # An explicit user count is authoritative: the owner asked for exactly N cases, so
    # it collapses the [floor, cap] window onto N and `fill_target` lands on it. Without
    # this the suite would still be sized by difficulty and the owner's number would only
    # ever have influenced the GENERATOR's pool, never the shipped suite.
    count_override = bool(count and count > 0)
    if count_override:
        cap = floor = count

    eff_cap = cap or CASE_CAP
    eff_floor = floor if floor is not None else CASE_FLOOR
    target = fill_target(difficulty, eff_cap, eff_floor)
    log(f"=== SELECT TEST CASES (dedup → annotate → select ≤{eff_cap}) ===")
    log(f"      bounds: floor {eff_floor} · target {target} · cap {eff_cap}  "
        + (f"(owner-requested count={count})" if count_override
           else f"(difficulty={difficulty or 'medium'} via {diff_source})"))

    # Raw-pool preservation: select overwrites testcases.json with the trimmed suite,
    # so snapshot the generator's FULL pool once (testcases_pool.json) and always select
    # from it. A re-run then reconsiders every generated case, not a prior selection.
    import shutil
    pool_path = os.path.join(outputs_dir, "testcases_pool.json")
    already_selected = False
    try:
        with open(tc_path, "r", encoding="utf-8") as f:
            _root = json.load(f)
        _r = _root[0] if isinstance(_root, list) and _root else _root
        already_selected = bool(isinstance(_r, dict) and _r.get("selected"))
    except Exception:
        already_selected = False
    if already_selected and os.path.exists(pool_path):
        load_path = pool_path                       # re-run → select from the full pool
    else:
        if os.path.exists(tc_path):
            shutil.copyfile(tc_path, pool_path)      # first select → snapshot the raw pool
        load_path = tc_path

    cases, max_n = load_cases(load_path, desc)
    if not cases:
        raise SystemExit("annotation: testcases.json has no cases")
    size_kind, space_mode = determine_size_model(cases, max_n)
    src = "raw pool (re-select)" if load_path == pool_path else "freshly generated pool"
    log(f"[1/4] Loaded {len(cases)} candidate case(s) from {src}  ·  "
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
        log(f"[2/4] Scoring kills: running {len(wrong)} wrong solution(s) over "
            f"{len(cases)} case(s)…")
    else:
        log("[2/4] Scoring kills: SKIPPED (no wrong_solutions/*.py found)")
    wrong_ids = annotate_kills(cases, wrong, batch_runner, log=log)

    if brute and size_kind != "none":
        log(f"[3/4] Verifying brute-force TLE on large-regime case(s) "
            f"(limit {tle_limit:g}s; a timeout = verified TLE)…")
    else:
        why = "no brute force" if not brute else "no size dimension"
        log(f"[3/4] Brute-force TLE: N/A ({why})")
    tle_n = annotate_tle(cases, brute, tle_batch_runner, max_n, size_kind, log=log)

    kwargs = {"size_kind": size_kind, "space_mode": space_mode,
              "difficulty": difficulty}
    if cap is not None:
        kwargs["cap"] = cap
    if floor is not None:
        kwargs["floor"] = floor
    selected, report = select_suite(cases, wrong_ids, max_n, **kwargs)
    report["tle_verified"] = tle_n
    report["reference_present"] = bool(reference)

    write_selected(tc_path, selected,
                   suite_complete=bool(report.get("exhaustive_complete")
                                       or report.get("small_space")))

    dropped = report["generated"] - report["unique"]
    log(f"[4/4] Selected {report['selected']} of {report['unique']} unique "
        f"({dropped} exact-input duplicate(s) removed):")
    log("      " + format_funnel(report))
    # Human-readable verdict lines so the log states plainly what was achieved.
    log(f"      · edges kept          {report['edges']}"
        + (f" of {report['edges_total']}  (cap {eff_cap} reached)"
           if report.get("edges_total", 0) > report["edges"] else ""))
    log(f"      · verified brute TLE  {tle_n}"
        + ("" if (brute and size_kind != "none") else "  (N/A)"))
    log(f"      · slot coverage       {report['slots_filled']}/{report['slots_total']}")
    log(f"      · wrong sols caught   {report['kills_covered']}/{report['kills_total']}"
        + (f"  ⚠ uncatchable: {', '.join(report['uncatchable'])}" if report.get("uncatchable") else ""))
    if report.get("exhaustive_complete"):
        log(f"      ✓ exhaustive: shipped the complete input space "
            f"({report['selected']} case(s))")
    elif report.get("small_space"):
        # Stated, not warned about: expected when the problem's legal input space is
        # genuinely tiny (8-10 distinct inputs IS the whole suite). The same line covers
        # a merely thin pool, so it names the number to look at instead of guessing why.
        log(f"      · pool of {report['unique']} is under the floor of {eff_floor} — "
            f"shipped all {report['selected']} case(s); accepted as complete. Expected "
            f"for a small input space; if the space is large, raise the generator count.")
    elif report.get("below_floor"):
        log(f"      ⚠ BELOW FLOOR: {report['selected']} case(s) from a pool of "
            f"{report['unique']} — floor is {eff_floor}; check the cap/floor settings.")
    log(f"Wrote {report['selected']} case(s) → {tc_path}")

    # Merged benchmark: report-only mutation/coverage/fuzz on the SELECTED suite.
    # B2 (wrong-approach gate) reuses the kill data we just computed — `uncatchable`
    # is exactly the set of wrong solutions the final suite fails to catch — so we
    # never re-run the wrong solutions. Informational only: a benchmark failure must
    # not fail selection, which is the step's real deliverable.
    try:
        from benchmark_suite import run_benchmark, print_report, DEFAULT_MIN_KILL
        uncatchable = report.get("uncatchable") or []
        b2 = {
            "skipped": report.get("kills_total", 0) == 0,
            "wrong_files": report.get("kills_total", 0),
            "failures": [{"file": f, "reused_from_select": True} for f in uncatchable],
            "hard_fail": len(uncatchable) > 0,
        }
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

    return report


if __name__ == "__main__":
    import argparse

    root = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    ap = argparse.ArgumentParser(description="Annotate + select the final testcase suite")
    ap.add_argument("--cap", type=int, default=None)
    ap.add_argument("--floor", type=int, default=None)
    ap.add_argument("--difficulty", default=None,
                    help="easy|medium|hard — picks the fill target; "
                         "default resolves owner > generated_difficulty.txt > medium")
    ap.add_argument("--count", type=int, default=None,
                    help="Owner-requested suite size. Overrides --cap/--floor and the "
                         "difficulty-scaled target: the suite is exactly this many cases "
                         "(fewer only if the deduped pool holds fewer)")
    args = ap.parse_args()
    run_annotation(cap=args.cap, floor=args.floor, difficulty=args.difficulty,
                   count=args.count)
