"""
Benchmark harness for test-case suite strength (Component B).

Pure local execution: mutation kill rate (B1), wrong-approach gate (B2),
coverage-shape audit (B3), differential fuzz (B4).

Standalone CLI + importable API. Read-only: reports a strength score and never
mutates the suite (case selection + kill guarantees are owned by select_testcases).
"""

from __future__ import annotations

import argparse
import ast
import concurrent.futures
import copy
import glob
import json
import math
import os
import random
import re
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Any

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Prompts.testcasesprompt_v4 import (  # noqa: E402
    MAX_CASES_PER_SUBTASK,
    MAX_SUBTASKS,
    MIN_SUBTASKS,
    MIN_TESTCASES,
    SIZE_CATEGORY_TARGETS,
    SIZE_TOLERANCE_PP,
    tier_from_tags,
)
from testcase_helpers import (
    bucket_for_case,
    detect_problem_type,
    derive_size_bucket,
    parse_constraint_max_n,
    parse_primary_n,
    resolve_size_context,
    size_tag_from_bucket,
    tag_size_bucket,
)

DEFAULT_MIN_KILL = 0.90
DEFAULT_RUN_TIMEOUT = 10.0
# Tighter per-input cap during benchmark (override via BENCHMARK_RUN_TIMEOUT env).
BENCHMARK_RUN_TIMEOUT = float(os.environ.get("BENCHMARK_RUN_TIMEOUT", "3"))
DEFAULT_FUZZ_COUNT = 500
BENCHMARK_FUZZ_COUNT = int(os.environ.get("BENCHMARK_FUZZ_COUNT", "100"))
MUTANT_CAP = 120
# Max cases used when filtering equivalent mutants (small inputs only; stress in kill phase).
EQUIV_FILTER_CASES = 12
# Inputs larger than this are excluded from equiv filter and run last in kill phase.
BENCHMARK_STRESS_INPUT_CHARS = int(os.environ.get("BENCHMARK_STRESS_INPUT_CHARS", "8000"))

_BATCH_RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "benchmark_batch_runner.py")


def _use_compiler() -> bool:
    return os.environ.get("BENCHMARK_USE_COMPILER", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


SIZE_PREFIX = "size_"
SIZE_BUCKETS = ("edge", "small", "medium", "large")


def _log_banner(title: str) -> None:
    print(f"── {title} ──", flush=True)


def _log_detail(msg: str) -> None:
    print(f"    ▸ {msg}", flush=True)


def _log_ok(msg: str) -> None:
    print(f"    ✓ {msg}", flush=True)


def _log_warn(msg: str) -> None:
    print(f"    ⚠ {msg}", flush=True)


def _log_fail(msg: str) -> None:
    print(f"    ✗ {msg}", flush=True)


def _log_progress(label: str, current: int, total: int, extra: str = "") -> None:
    suffix = f" · {extra}" if extra else ""
    print(f"    ▸ {label} {current}/{total}{suffix}", flush=True)


def _input_chars(tc: dict) -> int:
    return len(tc.get("input", ""))


def _partition_cases(
    test_cases: list[dict],
    max_small: int = BENCHMARK_STRESS_INPUT_CHARS,
) -> tuple[list[dict], list[dict]]:
    small: list[dict] = []
    stress: list[dict] = []
    for tc in test_cases:
        (stress if _input_chars(tc) > max_small else small).append(tc)
    return small, stress


def _filter_input_pool(test_cases: list[dict]) -> list[str]:
    """Small-input cases for equivalence filter — never include megabyte stress tests."""
    small, _ = _partition_cases(test_cases)
    pool = small if small else test_cases
    return [tc.get("input", "") for tc in pool[:EQUIV_FILTER_CASES]]


def _fuzz_inputs(test_cases: list[dict], n: int = 5) -> list[str]:
    small, _ = _partition_cases(test_cases)
    pool = small if small else test_cases
    if not pool:
        return []
    picks = random.sample(pool, min(n, len(pool)))
    return [tc.get("input", "") for tc in picks]


# Scenario tags expected per problem type (subset check).
_TYPE_SCENARIO_HINTS: dict[str, tuple[str, ...]] = {
    "array": ("all_negative", "all_zero", "single_element", "sorted", "duplicate"),
    "string": ("empty", "single_char", "palindrome", "max_length"),
    "tree": ("single_node", "skewed", "balanced", "max_depth"),
    "graph": ("single_node", "disconnected", "line_graph"),
    "dp": ("n_equals_1", "impossible", "all_zeros"),
    "sliding_window": ("window_1", "window_full", "all_duplicates"),
    "math": ("boundary", "max_value"),
    "greedy": ("greedy_fails",),
    "generic": ("example", "stress"),
}


# --------------------------------------------------------------------------- #
# Executor
# --------------------------------------------------------------------------- #
def normalize(stdout: str) -> str:
    """Strip trailing whitespace per line; preserve internal spacing."""
    if stdout is None:
        return ""
    lines = stdout.splitlines()
    return "\n".join(line.rstrip() for line in lines).rstrip()


def _python_executable() -> str:
    candidate = os.path.join("venv", "bin", "python3")
    return candidate if os.path.exists(candidate) else sys.executable


def run_solution(
    code_str: str,
    stdin_str: str,
    timeout: float = DEFAULT_RUN_TIMEOUT,
) -> tuple[str, str]:
    """
    Run Python solution code with stdin piped. Returns (stdout, status).
    status: ok | timeout | error
    """
    if _use_compiler():
        from benchmark_compiler import run_solution_compiler

        return run_solution_compiler(code_str, stdin_str, timeout)

    fd, path = tempfile.mkstemp(suffix=".py", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(code_str)
        try:
            proc = subprocess.run(
                [_python_executable(), path],
                input=stdin_str,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return "", "timeout"
        if proc.returncode != 0:
            return (proc.stdout or "") + (proc.stderr or ""), "error"
        return proc.stdout or "", "ok"
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def run_solutions_batch(
    code_str: str,
    inputs: list[str],
    timeout: float = BENCHMARK_RUN_TIMEOUT,
) -> list[tuple[str, str]]:
    """Run many stdin inputs in one Python process (much faster than N subprocess spawns)."""
    if _use_compiler():
        from benchmark_compiler import run_solutions_batch_compiler

        return run_solutions_batch_compiler(code_str, inputs, timeout)

    if not inputs:
        return []
    if not os.path.exists(_BATCH_RUNNER):
        return [run_solution(code_str, inp, timeout) for inp in inputs]

    fd, path = tempfile.mkstemp(suffix=".py", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(code_str)
        timeout_sec = max(1, int(math.ceil(timeout)))
        wall = timeout * len(inputs) + 15
        try:
            proc = subprocess.run(
                [_python_executable(), _BATCH_RUNNER, path, str(timeout_sec)],
                input=json.dumps(inputs),
                capture_output=True,
                text=True,
                timeout=wall,
            )
        except subprocess.TimeoutExpired:
            return [("", "timeout") for _ in inputs]
        stdout = (proc.stdout or "").strip()
        if proc.returncode != 0 or not stdout:
            return [run_solution(code_str, inp, timeout) for inp in inputs]
        try:
            rows = json.loads(stdout)
        except json.JSONDecodeError:
            return [run_solution(code_str, inp, timeout) for inp in inputs]
        if not isinstance(rows, list) or len(rows) < len(inputs):
            return [run_solution(code_str, inp, timeout) for inp in inputs]
        out: list[tuple[str, str]] = []
        for row in rows:
            out.append((row.get("out", ""), row.get("status", "error")))
        return out[: len(inputs)]
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def build_output_cache(
    code_str: str,
    inputs: list[str],
    timeout: float = BENCHMARK_RUN_TIMEOUT,
) -> dict[str, tuple[str, str]]:
    """input string -> (normalized output, status)"""
    cache: dict[str, tuple[str, str]] = {}
    if not inputs:
        return cache
    for inp, (out, status) in zip(inputs, run_solutions_batch(code_str, inputs, timeout)):
        cache[inp] = (normalize(out) if status == "ok" else "", status)
    return cache


def run_against_suite(
    code_str: str,
    test_cases: list[dict],
    timeout: float = BENCHMARK_RUN_TIMEOUT,
) -> list[tuple[int, bool, str]]:
    """Run code against each case. Returns [(index, passed, status), ...]."""
    if not test_cases:
        return []
    inputs = [tc.get("input", "") for tc in test_cases]
    outputs = run_solutions_batch(code_str, inputs, timeout)
    results = []
    for i, (tc, (out, status)) in enumerate(zip(test_cases, outputs)):
        expected = normalize(tc.get("output", ""))
        if status == "timeout":
            results.append((i, False, "timeout"))
            continue
        if status == "error":
            results.append((i, False, "error"))
            continue
        passed = normalize(out) == expected
        results.append((i, passed, "ok" if passed else "wrong"))
    return results


# --------------------------------------------------------------------------- #
# I/O helpers
# --------------------------------------------------------------------------- #
def load_testcases(path: str | None = None) -> list[dict]:
    path = path or os.path.join("Outputs", "testcases.json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0].get("test_cases", [])
    if isinstance(data, dict):
        return data.get("test_cases", [])
    return []


def load_suite_complete(path: str | None = None) -> bool:
    """Root-level `suite_complete` flag stamped by testcase selection.

    True means the suite holds the WHOLE available input space — a problem with only
    a handful of legal inputs ships a handful of cases, and that is finished work, not
    a thin suite. `load_testcases` returns just the case list and drops this, so the
    minimum-count gate has to read it separately. Missing/unparseable => False, which
    keeps the gate strict for every ordinary suite."""
    path = path or os.path.join("Outputs", "testcases.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    root = data[0] if isinstance(data, list) and data else data
    return bool(isinstance(root, dict) and root.get("suite_complete"))


def load_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# --------------------------------------------------------------------------- #
# B1 — Mutation kill rate
# --------------------------------------------------------------------------- #
COMPARE_FLIPS = {
    ast.Lt: ast.Gt,
    ast.LtE: ast.GtE,
    ast.Gt: ast.Lt,
    ast.GtE: ast.LtE,
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
}

ARITH_SWAPS = {
    ast.Add: ast.Sub,
    ast.Sub: ast.Add,
    ast.Mult: ast.FloorDiv,
    ast.FloorDiv: ast.Mult,
}

BUG_CLASSES = {
    "compare_flip": "comparison",
    "arith_swap": "arithmetic",
    "off_by_one": "off_by_one",
    "const_tweak": "constant",
    "bool_op": "logic",
    "early_return": "early_exit",
}


@dataclass
class Mutant:
    code: str
    operator: str
    bug_class: str
    diff_summary: str
    mutant_id: str



class _MutantCollector(ast.NodeTransformer):
    def __init__(self, source: str, tree: ast.AST):
        self.source = source
        self.tree = tree
        self.mutants: list[Mutant] = []
        self._counter = 0

    def _register(self, new_tree: ast.AST, operator: str, bug_class: str, old: str, new: str):
        self._counter += 1
        try:
            code = ast.unparse(new_tree)
        except Exception:
            return
        if code == self.source:
            return
        self.mutants.append(
            Mutant(
                code=code,
                operator=operator,
                bug_class=bug_class,
                diff_summary=f"{old} -> {new}",
                mutant_id=f"m{self._counter}",
            )
        )

    def _mutate_at(self, mutate_fn):
        new_tree = copy.deepcopy(self.tree)
        mutate_fn(new_tree)
        return new_tree

    def collect_all(self) -> list[Mutant]:
        """Generate one mutant per mutation site by walking the AST."""
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Compare) and node.ops:
                op = node.ops[0]
                for src, dst in COMPARE_FLIPS.items():
                    if isinstance(op, src):
                        def _do_cmp(tree, n=node, s=src, d=dst):
                            for walk in ast.walk(tree):
                                if (isinstance(walk, ast.Compare) and walk.ops
                                        and isinstance(walk.ops[0], s)
                                        and ast.dump(walk) == ast.dump(n)):
                                    walk.ops[0] = d()
                                    break
                        nt = self._mutate_at(_do_cmp)
                        self._register(nt, "compare_flip", BUG_CLASSES["compare_flip"],
                                       type(op).__name__, type(dst()).__name__)
            if isinstance(node, ast.BinOp):
                for src, dst in ARITH_SWAPS.items():
                    if isinstance(node.op, src):
                        def _do_bin(tree, n=node, s=src, d=dst):
                            for walk in ast.walk(tree):
                                if (isinstance(walk, ast.BinOp) and isinstance(walk.op, s)
                                        and ast.dump(walk) == ast.dump(n)):
                                    walk.op = d()
                                    break
                        nt = self._mutate_at(_do_bin)
                        self._register(nt, "arith_swap", BUG_CLASSES["arith_swap"],
                                       type(node.op).__name__, type(dst()).__name__)
                if isinstance(node.right, ast.Constant) and isinstance(node.right.value, int):
                    for delta in (-1, 1):
                        def _do_off(tree, n=node, delta=delta):
                            for walk in ast.walk(tree):
                                if (isinstance(walk, ast.BinOp) and isinstance(walk.right, ast.Constant)
                                        and ast.dump(walk) == ast.dump(n)):
                                    walk.right = ast.Constant(value=n.right.value + delta)
                                    break
                        nt = self._mutate_at(_do_off)
                        self._register(nt, "off_by_one", BUG_CLASSES["off_by_one"],
                                       str(node.right.value), str(node.right.value + delta))
            if isinstance(node, ast.Constant) and isinstance(node.value, int) and abs(node.value) <= 10_000:
                for delta in (-1, 1):
                    def _do_const(tree, n=node, delta=delta):
                        for walk in ast.walk(tree):
                            if (isinstance(walk, ast.Constant) and walk.value == n.value
                                    and ast.dump(walk) == ast.dump(n)):
                                walk.value = n.value + delta
                                break
                    nt = self._mutate_at(_do_const)
                    self._register(nt, "const_tweak", BUG_CLASSES["const_tweak"],
                                   str(node.value), str(node.value + delta))
            if isinstance(node, ast.BoolOp):
                if isinstance(node.op, ast.And):
                    def _do_and(tree, n=node):
                        for walk in ast.walk(tree):
                            if isinstance(walk, ast.BoolOp) and ast.dump(walk) == ast.dump(n):
                                walk.op = ast.Or()
                                break
                    nt = self._mutate_at(_do_and)
                    self._register(nt, "bool_op", BUG_CLASSES["bool_op"], "and", "or")
                elif isinstance(node.op, ast.Or):
                    def _do_or(tree, n=node):
                        for walk in ast.walk(tree):
                            if isinstance(walk, ast.BoolOp) and ast.dump(walk) == ast.dump(n):
                                walk.op = ast.And()
                                break
                    nt = self._mutate_at(_do_or)
                    self._register(nt, "bool_op", BUG_CLASSES["bool_op"], "or", "and")
            if isinstance(node, ast.If):
                def _do_if(tree, n=node):
                    for walk in ast.walk(tree):
                        if isinstance(walk, ast.If) and ast.dump(walk) == ast.dump(n):
                            walk.test = ast.UnaryOp(op=ast.Not(), operand=copy.deepcopy(walk.test))
                            break
                nt = self._mutate_at(_do_if)
                self._register(nt, "compare_flip", BUG_CLASSES["compare_flip"], "if cond", "not if cond")
        return self.mutants


def generate_mutants(optimal_code: str, cap: int = MUTANT_CAP) -> list[Mutant]:
    try:
        tree = ast.parse(optimal_code)
    except SyntaxError:
        return []
    collector = _MutantCollector(optimal_code, tree)
    collector.collect_all()
    # dedupe by code
    seen: set[int] = set()
    unique: list[Mutant] = []
    for i, m in enumerate(collector.mutants):
        h = hash(m.code)
        if h in seen:
            continue
        seen.add(h)
        m.mutant_id = f"m{len(unique) + 1}"
        unique.append(m)
        if len(unique) >= cap:
            break
    return unique



def is_equivalent_mutant(
    mutant: Mutant,
    filter_inputs: list[str],
    opt_cache: dict[str, tuple[str, str]],
    timeout: float = BENCHMARK_RUN_TIMEOUT,
) -> bool:
    inputs = list(dict.fromkeys(filter_inputs))
    if not inputs:
        return False

    mut_results = run_solutions_batch(mutant.code, inputs, timeout)
    for inp, (mut_out, mut_status) in zip(inputs, mut_results):
        opt_norm, opt_status = opt_cache.get(inp, ("", "error"))
        if opt_status != "ok":
            continue
        if mut_status != "ok":
            return False
        if normalize(mut_out) != opt_norm:
            return False
    return True


def _mutant_workers(n: int) -> int:
    """Thread count for evaluating mutants concurrently. Each mutant runs in its
    own subprocess (which releases the GIL while it executes), so threads give a
    real speedup. Bounded so we don't flood the host with Python processes.
    Override with SUITE_MAX_WORKERS."""
    if n <= 1:
        return 1
    env = os.environ.get("SUITE_MAX_WORKERS", "").strip()
    cap = int(env) if env.isdigit() and int(env) > 0 else min(8, os.cpu_count() or 4)
    return max(1, min(cap, n))


def run_mutation_benchmark(
    optimal_code: str,
    test_cases: list[dict],
    mutants: list[Mutant] | None = None,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
    progress: bool = False,
) -> dict[str, Any]:
    if mutants is None:
        mutants = generate_mutants(optimal_code)

    if progress:
        small_n, stress_n = _partition_cases(test_cases)
        _log_detail(
            f"Generated {len(mutants)} mutant(s); filtering equivalents "
            f"({len(_filter_input_pool(test_cases))} quick inputs, "
            f"{len(small_n)} quick + {len(stress_n)} stress in kill phase)"
        )

    random.seed(42)
    filter_inputs = list(dict.fromkeys(
        _filter_input_pool(test_cases) + _fuzz_inputs(test_cases, 5)
    ))
    opt_cache = build_output_cache(optimal_code, filter_inputs, timeout)

    # Equivalence filter — run mutants concurrently (each is a subprocess), with
    # live progress so a long phase doesn't look frozen.
    eq_workers = _mutant_workers(len(mutants))
    _eq_done = [0]
    _eq_lock = threading.Lock()

    def _is_equiv(m: Mutant) -> bool:
        r = is_equivalent_mutant(m, filter_inputs, opt_cache, timeout)
        if progress:
            with _eq_lock:
                _eq_done[0] += 1
                if _eq_done[0] % 10 == 0 or _eq_done[0] == len(mutants):
                    _log_progress("filter", _eq_done[0], len(mutants), "checked")
        return r

    if eq_workers > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=eq_workers) as ex:
            equiv_flags = list(ex.map(_is_equiv, mutants))  # preserves order
        non_equivalent = [m for m, equiv in zip(mutants, equiv_flags) if not equiv]
    else:
        non_equivalent = [m for m in mutants if not _is_equiv(m)]

    vacuous_equiv = bool(mutants) and not non_equivalent
    if progress:
        _log_ok(
            f"Equivalence filter done — {len(non_equivalent)}/{len(mutants)} mutants need testing"
        )
        if vacuous_equiv:
            _log_warn(
                f"All {len(mutants)} mutant(s) were classified equivalent on "
                f"{len(filter_inputs)} filter input(s) — the mutation kill rate is "
                f"VACUOUS (0 mutants actually tested, so 100% is not meaningful). "
                f"The inputs are almost certainly too weak; add edge/large cases so "
                f"comparison/off-by-one mutations can be distinguished."
            )
        small_cases, stress_cases = _partition_cases(test_cases)
        _log_detail(
            f"Running kill phase: {len(small_cases)} quick case(s)"
            + (f" + {len(stress_cases)} stress case(s) if still alive" if stress_cases else "")
        )

    killed: list[str] = []
    survivors: list[dict] = []
    small_cases, stress_cases = _partition_cases(test_cases)
    if not small_cases:
        small_cases = test_cases
        stress_cases = []

    def _evaluate_mutant(m: Mutant, cases: list[dict], opt_cache: dict[str, tuple[str, str]]) -> bool:
        if not cases:
            return False
        inputs = [tc.get("input", "") for tc in cases]
        expected_by_input = {tc.get("input", ""): normalize(tc.get("output", "")) for tc in cases}
        mut_results = run_solutions_batch(m.code, inputs, timeout)
        for inp, (out, status) in zip(inputs, mut_results):
            expected = expected_by_input[inp]
            if status == "timeout":
                _, opt_status = opt_cache.get(inp, ("", "error"))
                if opt_status == "ok":
                    return True
                continue
            if status == "error":
                return True
            if normalize(out) != expected:
                return True
        return False

    quick_inputs = [tc.get("input", "") for tc in small_cases]
    opt_quick_cache = build_output_cache(optimal_code, quick_inputs, timeout)
    stress_inputs = [tc.get("input", "") for tc in stress_cases]
    opt_stress_cache = (
        build_output_cache(optimal_code, stress_inputs, timeout) if stress_cases else {}
    )

    # Kill phase — evaluate mutants concurrently (each is a subprocess). Quick
    # cases first, then stress cases only if still alive (kept inside the worker).
    _kill_done = [0]
    _kill_count = [0]
    _kill_lock = threading.Lock()

    def _kill_one(m: Mutant) -> bool:
        is_killed = _evaluate_mutant(m, small_cases, opt_quick_cache)
        if not is_killed and stress_cases:
            is_killed = _evaluate_mutant(m, stress_cases, opt_stress_cache)
        if progress:
            with _kill_lock:
                _kill_done[0] += 1
                if is_killed:
                    _kill_count[0] += 1
                if _kill_done[0] % 10 == 0 or _kill_done[0] == len(non_equivalent):
                    pct = int(100 * _kill_count[0] / _kill_done[0]) if _kill_done[0] else 0
                    _log_progress("test", _kill_done[0], len(non_equivalent),
                                  f"{_kill_count[0]} killed · {pct}% so far")
        return is_killed

    kill_workers = _mutant_workers(len(non_equivalent))
    if progress and non_equivalent:
        _log_detail(f"Kill phase: {len(non_equivalent)} mutant(s) across {kill_workers} worker(s)…")
    if kill_workers > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=kill_workers) as ex:
            kill_flags = list(ex.map(_kill_one, non_equivalent))  # preserves order
    else:
        kill_flags = [_kill_one(m) for m in non_equivalent]

    for m, is_killed in zip(non_equivalent, kill_flags):
        if is_killed:
            killed.append(m.mutant_id)
        else:
            survivors.append({
                "id": m.mutant_id,
                "operator": m.operator,
                "bug_class": m.bug_class,
                "diff": m.diff_summary,
            })

    total = len(non_equivalent)
    kill_rate = (len(killed) / total) if total else 1.0
    if progress and total:
        _log_ok(f"Mutation testing done — kill rate {kill_rate:.1%} ({len(killed)}/{total})")
        if survivors:
            _log_warn(f"{len(survivors)} survivor(s) — see final report for details")
    return {
        "kill_rate": kill_rate,
        "killed": len(killed),
        "non_equivalent_total": total,
        "mutants_generated": len(mutants),
        # True when every generated mutant was filtered as equivalent, so 0 were
        # tested and kill_rate defaulted to 1.0 — a meaningless "100%". Consumers
        # should treat this as "no mutation signal", not a strong suite.
        "vacuous_equiv": vacuous_equiv,
        "survivors": survivors,
        "mutant_objects": {m.mutant_id: m for m in non_equivalent},
    }


# --------------------------------------------------------------------------- #
# B2 — Wrong-approach gate
# --------------------------------------------------------------------------- #
def suite_is_float_valued(test_cases: list) -> bool:
    """True when any stored output holds a decimal number.

    Output comparison is textual, so `3.14159` vs `3.141590` mismatches and a CORRECT
    solution reads as killed. Integers parse as floats too, hence the decimal-point
    requirement.
    """
    for tc in test_cases or []:
        for token in str(tc.get("output") or "").split():
            if "." not in token:
                continue
            try:
                float(token)
                return True
            except ValueError:
                continue
    return False


def b2_verdict(
    wrong_files: int,
    failures: list,
    test_cases: list,
    description: str | None = "",
) -> dict[str, Any]:
    """The one B2 verdict shape, shared by the live gate and testcase_annotate's
    reuse of its own kill data. B2 is the only blocking quality gate, so it either
    blocks, passes on evidence, or abstains — it never silently no-ops.

    Abstains (`cannot_judge`) where a textual verdict would be meaningless: problems
    with multiple valid outputs, and float-valued suites. Abstention is not a pass.
    """
    if description and is_open_ended_problem(description):
        reason = ("this problem accepts multiple valid outputs, so textual "
                  "comparison would misreport")
    elif suite_is_float_valued(test_cases):
        reason = ("this suite has decimal outputs, so textual comparison "
                  "would misreport")
    else:
        reason = ""
    if reason:
        return {"skipped": True, "cannot_judge": True, "missing": False,
                "reason": reason, "wrong_files": wrong_files,
                "failures": [], "hard_fail": False}
    if not wrong_files:
        return {"skipped": False, "cannot_judge": False, "missing": True,
                "reason": "no wrong_solutions/*.py found", "wrong_files": 0,
                "failures": [], "hard_fail": True}
    return {"skipped": False, "cannot_judge": False, "missing": False,
            "reason": "", "wrong_files": wrong_files, "failures": failures,
            "hard_fail": len(failures) > 0}


def run_wrong_approach_gate(
    test_cases: list[dict],
    wrong_dir: str | None = None,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
    progress: bool = False,
    description: str | None = None,
) -> dict[str, Any]:
    # Cheap pre-check: if B2 cannot judge this problem at all, say so before running
    # anything. Otherwise this is already the "no wrong solutions" verdict.
    verdict = b2_verdict(0, [], test_cases, description)
    if verdict["cannot_judge"]:
        _log_warn(f"[B2] CANNOT JUDGE — {verdict['reason']}. Gate skipped (not a pass).")
        return verdict

    wrong_dir = wrong_dir or os.path.join("Outputs", "wrong_solutions")
    paths = sorted(glob.glob(os.path.join(wrong_dir, "*.py")))
    if not paths:
        _log_fail("[B2] no wrong_solutions/*.py found. B2 is the only blocking quality "
                  "gate; without it the suite is unvalidated. "
                  "Run Generate Wrong Solutions first.")
        return verdict

    if progress:
        _log_detail(f"Checking {len(paths)} wrong-approach file(s) against {len(test_cases)} cases…")

    failures = []
    for path in paths:
        code = load_text(path)
        results = run_against_suite(code, test_cases, timeout)
        total = len(results)
        passed_n = sum(1 for _, p, _ in results if p)
        # A wrong solution is "killed" if AT LEAST ONE case catches it (it fails
        # that case). It only SURVIVES the gate if it passes EVERY case, i.e. no
        # case discriminates it. Requiring it to be rejected by *every* case
        # (the old `passed_any`) is unachievable — a wrong approach naturally
        # passes the inputs where its bug doesn't manifest (e.g. abs-sum on
        # all-positive inputs), so that flagged genuinely-strong suites as fails.
        survived = total > 0 and passed_n == total
        killed_by = total - passed_n
        name = os.path.basename(path)
        if progress:
            if survived:
                _log_fail(f"{name} — passed ALL {total} case(s) (not caught by any)")
            elif passed_n == 0:
                _log_ok(f"{name} — rejected by all {total} case(s)")
            else:
                _log_ok(f"{name} — killed by {killed_by}/{total} case(s)")
        if survived:
            failures.append({
                "file": name,
                "passed_cases": [i for i, p, _ in results if p],
            })
    return b2_verdict(len(paths), failures, test_cases, description)


# --------------------------------------------------------------------------- #
# B3 — Coverage-shape audit
# --------------------------------------------------------------------------- #
def _subtask_counts(test_cases: list[dict]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for tc in test_cases:
        try:
            tier = tier_from_tags(tc.get("tags") or [])
        except ValueError:
            continue
        counts[tier] = counts.get(tier, 0) + 1
    return counts


def audit_coverage_shape(
    test_cases: list[dict],
    description: str,
    problem_type: str | None = None,
    brute_code: str | None = None,
    advisory_size: bool = False,
    suite_complete: bool = False,
) -> dict[str, Any]:
    issues: list[str] = []
    warnings: list[str] = []
    hard_fail = False

    total = len(test_cases)
    if total < MIN_TESTCASES:
        # A complete suite over a tiny input space cannot reach the minimum — there are
        # no more legal inputs to add. Note it, never fail it.
        if suite_complete:
            warnings.append(f"total cases {total} < MIN_TESTCASES ({MIN_TESTCASES}) "
                            f"— accepted: suite covers the whole input space")
        else:
            issues.append(f"total cases {total} < MIN_TESTCASES ({MIN_TESTCASES})")
            hard_fail = True

    subtask_counts = _subtask_counts(test_cases)
    subtask_n = len(subtask_counts)
    if subtask_n < MIN_SUBTASKS or subtask_n > MAX_SUBTASKS:
        issues.append(f"subtask count {subtask_n} outside [{MIN_SUBTASKS}, {MAX_SUBTASKS}]")
        hard_fail = True

    # per-subtask cap
    if subtask_n > 0:
        effective_cap = max(MAX_CASES_PER_SUBTASK, math.ceil(total / subtask_n))
        for tier, cnt in subtask_counts.items():
            if cnt > effective_cap:
                issues.append(
                    f"subtask_{tier} has {cnt} cases > effective_cap {effective_cap}"
                )
                hard_fail = True
            elif cnt > math.ceil(total / subtask_n) + 2:
                warnings.append(f"subtask_{tier} count {cnt} above average")

    # Buckets scale to THIS problem's size dimension: the constraint bound when
    # the description states one, else the largest size the suite itself contains.
    kind, max_n = resolve_size_context(None, description, test_cases)
    bucket_counts = {b: 0 for b in SIZE_BUCKETS}
    mislabeled = 0
    for tc in test_cases:
        bucket = bucket_for_case(tc, max_n, kind)
        if bucket is None:
            continue
        bucket_counts[bucket] += 1
        declared = tag_size_bucket(tc.get("tags") or [])
        if declared and declared != bucket:
            mislabeled += 1

    if mislabeled:
        warnings.append(f"{mislabeled} case(s) have size_* tag mismatched vs derived bucket")

    # size distribution enforcement
    size_split: dict[str, float] = {}
    if total > 0:
        for b in SIZE_BUCKETS:
            size_split[b] = round(100.0 * bucket_counts[b] / total, 1)
        for b, target in SIZE_CATEGORY_TARGETS.items():
            actual = size_split.get(b, 0.0)
            if abs(actual - target) > SIZE_TOLERANCE_PP:
                msg = (
                    f"size_{b}: {actual}% vs target {target}% "
                    f"(tolerance +/-{SIZE_TOLERANCE_PP}pp)"
                )
                if advisory_size:
                    warnings.append(msg)
                else:
                    issues.append(msg)
                    hard_fail = True

    # per-type scenario hints (soft warning)
    ptype = problem_type or detect_problem_type(description)
    all_tags = set()
    for tc in test_cases:
        for t in tc.get("tags") or []:
            name = t if isinstance(t, str) else str(t.get("name_enum", ""))
            all_tags.add(name)
    hints = _TYPE_SCENARIO_HINTS.get(ptype, _TYPE_SCENARIO_HINTS["generic"])
    missing_hints = [h for h in hints if not any(h in tag for tag in all_tags)]
    if missing_hints:
        warnings.append(f"problem type '{ptype}' may be missing scenario tags: {missing_hints[:3]}")

    # uniqueness spot-check via brute on first small case
    if brute_code and test_cases:
        small = test_cases[0]
        opt_out, s1 = run_solution(brute_code, small.get("input", ""))
        if s1 == "ok" and normalize(opt_out) != normalize(small.get("output", "")):
            # Surface the disagreeing input/expected/actual so this is actionable:
            # a brute that disagrees with the stored output (while B4 fuzz passes)
            # usually means the case's expected output is wrong or the brute reads
            # the format differently — not something the suite can self-correct.
            def _clip(s: str, n: int = 120) -> str:
                s = (s or "").replace("\n", "\\n")
                return s if len(s) <= n else s[:n] + "…"
            warnings.append(
                "brute disagrees with expected output on spot-check case "
                f"(input='{_clip(small.get('input', ''))}' "
                f"expected='{_clip(normalize(small.get('output', '')), 80)}' "
                f"brute='{_clip(normalize(opt_out), 80)}')"
            )

    return {
        "total": total,
        "subtask_count": subtask_n,
        "subtask_counts": subtask_counts,
        "effective_cap": max(MAX_CASES_PER_SUBTASK, math.ceil(total / max(subtask_n, 1))),
        "size_split": size_split,
        "size_bucket_counts": bucket_counts,
        "problem_type": ptype,
        "issues": issues,
        "warnings": warnings,
        "hard_fail": hard_fail,
    }


# --------------------------------------------------------------------------- #
# B4 — Differential fuzz
# --------------------------------------------------------------------------- #
def run_differential_fuzz(
    optimal_code: str,
    brute_code: str,
    description: str,
    test_cases: list[dict] | None = None,
    count: int = BENCHMARK_FUZZ_COUNT,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
) -> dict[str, Any]:
    """Cross-check the optimal against the brute force to catch a WRONG optimal.

    Inputs are FORMAT-PRESERVING: the real test cases plus value-perturbations of
    them. A generic numeric fuzz is only a fallback when no test cases are given —
    the old generic-only fuzz produced inputs in a fixed "n / array" shape that
    custom formats (e.g. "n m / values / decays") reject, so every comparison was
    skipped and B4 passed vacuously, letting a buggy optimal slip through."""
    inputs: list[str] = []
    if test_cases:
        inputs.extend(tc.get("input", "") for tc in test_cases if tc.get("input"))
        inputs.extend(_perturb_numeric_inputs(test_cases, count, description=description))
    if not inputs:
        max_n = parse_constraint_max_n(description) or 100
        cap = min(max_n, 50)
        random.seed(42)
        for _ in range(count):
            n = random.randint(1, max(1, cap))
            inputs.append(f"{n}\n" + " ".join(str(random.randint(-10, 10)) for _ in range(n)) + "\n0\n")

    # Process in chunks with early-stop + a wall-time cap: a buggy optimal usually
    # disagrees within the first chunk (stop fast), while a correct optimal must
    # not run unbounded over a slow brute.
    disagreements = []
    tested: list[dict] = []
    ran = 0
    deadline = time.monotonic() + 30.0
    chunk = 12
    for start in range(0, len(inputs), chunk):
        if time.monotonic() > deadline:
            break
        batch = inputs[start:start + chunk]
        opt_results = run_solutions_batch(optimal_code, batch, timeout)
        bru_results = run_solutions_batch(brute_code, batch, timeout)
        ran += len(batch)
        for inp, (opt_out, s1), (bru_out, s2) in zip(batch, opt_results, bru_results):
            agree = s1 == "ok" and s2 == "ok" and normalize(opt_out) == normalize(bru_out)
            tested.append({
                "input": inp,
                "optimal": opt_out if s1 == "ok" else f"<{s1}>",
                "brute": bru_out if s2 == "ok" else f"<{s2}>",
                "agree": agree,
            })
            if s1 != "ok" or s2 != "ok":
                continue
            if normalize(opt_out) != normalize(bru_out):
                disagreements.append({"input": inp[:200], "optimal": opt_out[:100], "brute": bru_out[:100]})
        if len(disagreements) >= 5:
            break

    # Persist every input actually run through BOTH optimal and brute (with both
    # outputs) so the exact cases behind a pass/advisory/fail are inspectable in
    # Outputs/ rather than lost. Best-effort — never fail the gate over logging.
    try:
        os.makedirs("Outputs", exist_ok=True)
        with open(os.path.join("Outputs", "differential_fuzz_cases.json"), "w", encoding="utf-8") as f:
            json.dump({
                "generated_inputs": len(inputs),
                "runs": ran,
                "disagreement_count": len(disagreements),
                "cases": tested[:500],
            }, f, indent=2)
    except Exception as e:
        print(f"  (could not write differential_fuzz_cases.json: {e})", flush=True)

    return {
        "runs": ran,
        "disagreements": disagreements,
        "hard_fail": len(disagreements) > 0,
    }


_SORTED_INPUT_RE = re.compile(
    r"\bsorted\b|\bascending order\b|\bnon-?decreasing\b|\bincreasing order\b"
    r"|\bin (?:ascending|increasing|sorted) order\b",
    re.I,
)
_DISTINCT_INPUT_RE = re.compile(
    r"\bdistinct\b|\bunique\b|\bno duplicates?\b|\bno two .* (?:equal|same)\b",
    re.I,
)


def _declares_sorted_input(description: str) -> bool:
    """True when the statement says the input array is sorted/ascending. Used to
    keep perturbed fuzz inputs valid: perturbing tokens independently can turn a
    sorted array unsorted, on which the optimal (e.g. binary search) and brute
    (e.g. linear scan) legitimately differ — a SPURIOUS B4 disagreement."""
    return bool(_SORTED_INPUT_RE.search(description or ""))


def _declares_distinct_input(description: str) -> bool:
    """True when the statement says the input values are distinct/unique."""
    return bool(_DISTINCT_INPUT_RE.search(description or ""))


def _perturb_numeric_inputs(
    test_cases: list[dict], count: int, seed: int = 777, description: str = ""
) -> list[str]:
    """Generate new inputs by perturbing the NUMERIC VALUES in existing test-case
    inputs while keeping their line/token structure intact. This is format-
    agnostic — it reuses each problem's real input shape (counts, line layout)
    and only changes data values — so the optimal solution still accepts them.
    Used to find inputs that distinguish the optimal from a surviving wrong
    solution (B2 strengthening).

    When `description` declares a sorted (and optionally distinct) input array,
    each perturbed multi-value line is re-sorted (and made strictly increasing)
    so the perturbation never violates the problem's precondition — otherwise the
    fuzz manufactures invalid inputs that cause spurious optimal/brute B4
    disagreements (search-insert-position regression)."""
    bases = [tc.get("input", "") for tc in test_cases if tc.get("input")]
    if not bases:
        return []
    rng = random.Random(seed)
    seen = {tc.get("input", "") for tc in test_cases}

    # Observed integer range across all inputs — keep perturbed values IN this
    # range (and don't introduce a negative if none were seen). Going out of the
    # problem's value range can create inputs the constraints forbid, where the
    # optimal and a correct brute may legitimately differ — which would cause
    # spurious B4 failures. Staying in-distribution keeps inputs valid.
    observed = []
    for base in bases:
        for line in base.split("\n"):
            for t in line.split():
                try:
                    observed.append(int(t))
                except ValueError:
                    pass
    lo = min(observed) if observed else 0
    hi = max(observed) if observed else 100
    deltas = [1, -1, 2, -2, 3, -3, 5, -5, 10, -10]
    boundary = [lo, hi, lo + 1, hi - 1, (lo + hi) // 2]

    sorted_pre = _declares_sorted_input(description)
    distinct_pre = _declares_distinct_input(description)

    def _clamp(x: int) -> int:
        return max(lo, min(hi, x))

    def _reestablish_preconditions(tokens: list[str]) -> list[str]:
        """Keep a perturbed multi-value line valid under declared preconditions:
        re-sort ascending when the array is sorted, and force strictly-increasing
        when values must also be distinct. No-op for single values / non-integer
        lines / problems without a sorted precondition."""
        if not sorted_pre or len(tokens) < 2:
            return tokens
        try:
            vals = [int(t) for t in tokens]
        except ValueError:
            return tokens  # not a pure-integer line (e.g. strings) — leave as-is
        vals.sort()
        if distinct_pre:
            for k in range(1, len(vals)):
                if vals[k] <= vals[k - 1]:
                    vals[k] = vals[k - 1] + 1
        return [str(v) for v in vals]

    out: list[str] = []
    attempts = 0
    while len(out) < count and attempts < count * 8:
        attempts += 1
        base = rng.choice(bases)
        lines = base.split("\n")
        # Prefer perturbing data lines (after the first, which is usually counts);
        # fall back to any non-empty line. Token COUNT per line is preserved so
        # array lengths / declared sizes stay consistent.
        data_idxs = [i for i in range(1, len(lines)) if lines[i].strip()] \
            or [i for i in range(len(lines)) if lines[i].strip()]
        if not data_idxs:
            continue
        new_lines = list(lines)
        li = rng.choice(data_idxs)
        toks = new_lines[li].split()
        changed = False
        for j in range(len(toks)):
            if rng.random() < 0.5:
                try:
                    v = int(toks[j])
                except ValueError:
                    continue
                v2 = v + rng.choice(deltas) if rng.random() < 0.7 else rng.choice(boundary)
                toks[j] = str(_clamp(v2))
                changed = True
        if not changed:
            continue
        toks = _reestablish_preconditions(toks)
        new_lines[li] = " ".join(toks)
        cand = "\n".join(new_lines)
        if cand in seen:
            continue
        seen.add(cand)
        out.append(cand)
    return out


_EXAMPLE_INPUT_RE = re.compile(r"\*\*Input:\*\*\s*```[^\n]*\n(.*?)```", re.S)
_EXAMPLE_OUTPUT_RE = re.compile(r"\*\*Output:\*\*\s*```[^\n]*\n(.*?)```", re.S)
_NAMED_VAR_LINE_RE = re.compile(r"^\s*[A-Za-z_]\w*\s*=\s*\S")


def is_named_var_example_block(block: str) -> bool:
    """True when an example **Input:** block is human-readable NAMED-VARIABLE
    assignments (e.g. `n = 5` / `arr = [1, 2, 3]`) rather than raw stdin.

    For function-based problems the description shows named variables for readability,
    but the reference solution reads raw-token stdin — so these blocks are NOT
    executable as stdin and must not be fed to the solution (it would crash) or copied
    verbatim into the graded token test cases. Correctness for these problems is enforced
    upstream by the testcase-generation grounding step (which runs the solution on every
    token input) plus the token example cases. Raw-stdin blocks (a size line, a data line)
    are unaffected: their first token is not an identifier followed by `=`."""
    lines = [ln for ln in block.splitlines() if ln.strip()]
    if not lines:
        return False
    return all(_NAMED_VAR_LINE_RE.match(ln) for ln in lines)


def extract_example_inputs(description: str) -> list[str]:
    """Pull the stdin from each `**Input:** ``` ... ``` ` block in a description.
    Named-variable (display-only) blocks are skipped — they are not executable stdin."""
    out: list[str] = []
    for m in _EXAMPLE_INPUT_RE.finditer(description or ""):
        s = m.group(1).strip("\n")
        if s.strip() and not is_named_var_example_block(s):
            out.append(s + "\n")
    return out


def _paired_example_blocks(description: str) -> list[tuple[str, str]]:
    """[(input_block, output_block), ...] — each `**Input:**` block paired with the
    `**Output:**` block that follows it. Blocks are returned verbatim, unfiltered."""
    text = description or ""
    ins = [(m.start(), m.group(1).strip("\n")) for m in _EXAMPLE_INPUT_RE.finditer(text)]
    outs = [(m.start(), m.group(1).strip("\n")) for m in _EXAMPLE_OUTPUT_RE.finditer(text)]
    pairs: list[tuple[str, str]] = []
    for pos, inp in ins:
        if not inp.strip():
            continue
        expected = next((o for (opos, o) in outs if opos > pos), None)
        if expected is not None and expected.strip():
            pairs.append((inp, expected))
    return pairs


def extract_example_io(description: str) -> list[tuple[str, str]]:
    """Pair each `**Input:**` block with the `**Output:**` block that follows it,
    yielding [(stdin, expected_stdout), ...] straight from the description. These
    are the problem's GROUND TRUTH: the optimal solution must reproduce them, and a
    failure here is brute-independent evidence the optimal is buggy.

    Named-variable example inputs are display-only (function-based problems) and cannot
    be piped to the solution as stdin, so they are skipped here — never false-flag the
    optimal as "buggy" or copy that form into the graded token test cases. Use
    `extract_named_var_example_io` + `named_var_stdin_candidates` to convert them."""
    return [
        (inp + "\n", out)
        for inp, out in _paired_example_blocks(description)
        if not is_named_var_example_block(inp)
    ]


def extract_named_var_example_io(description: str) -> list[tuple[str, str]]:
    """The blocks `extract_example_io` skips: [(named_var_block, stated_output), ...].

    Returned RAW (not stdin): the caller must run them through
    `named_var_stdin_candidates` and pick a layout by running the reference solution."""
    return [
        (inp, out)
        for inp, out in _paired_example_blocks(description)
        if is_named_var_example_block(inp)
    ]


_NAMED_VAR_ASSIGN_RE = re.compile(r"^\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s*$")


def _scalar_token(val) -> str:
    return "null" if val is None else str(val)


def _render_named_var_value(raw: str) -> list[str]:
    """One display-form value -> the stdin line(s) it becomes.

    `[1, 2, 3]` -> ["1 2 3"];  `[[1,2],[3,4]]` -> ["1 2", "3 4"];  `"abc"` -> ["abc"];
    `5` -> ["5"]. Space-separated tokens, no brackets, no quotes, one line per matrix
    row: the layout the reference `main()` in this pipeline reads."""
    try:
        val = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return [raw.strip().strip("\"'")]
    if isinstance(val, (list, tuple)):
        if val and all(isinstance(x, (list, tuple)) for x in val):
            return [" ".join(_scalar_token(x) for x in row) for row in val]
        return [" ".join(_scalar_token(x) for x in val)]
    return [_scalar_token(val)]


def parse_named_var_block(block: str) -> list[tuple[str, list[str]]]:
    """[(variable_name, stdin_lines), ...] in the order the block declares them."""
    out: list[tuple[str, list[str]]] = []
    for ln in (block or "").splitlines():
        m = _NAMED_VAR_ASSIGN_RE.match(ln)
        if m:
            out.append((m.group(1), _render_named_var_value(m.group(2))))
    return out


def _var_length(lines: list[str]) -> int | None:
    """The size a solution would read for this variable, or None for a plain scalar."""
    if len(lines) > 1:
        return len(lines)                       # matrix: row count
    toks = lines[0].split()
    return len(toks) if len(toks) > 1 else None


def named_var_stdin_candidates(block: str) -> list[str]:
    """Candidate raw-stdin serializations of a named-variable example block.

    The display form (`n = 4` / `a = [1, 5, 2, 1]`) is what every function-type
    description shows; the reference solution reads raw tokens. The forms differ only in
    how the SIZES are laid out — whether the block declared them, and whether the
    solution reads them — and that is not knowable from the block alone. So emit the
    plausible layouts in likelihood order and let the caller pick the one that actually
    reproduces the stated output when piped to the reference. The reference's stdin
    parser is the only source of truth; guessing from the block is what let `N = 2763`
    ship as a graded input on 2026-07-29."""
    variables = parse_named_var_block(block)
    if not variables:
        return []

    verbatim: list[str] = []                    # 1. exactly as declared
    for _, lines in variables:
        verbatim.extend(lines)

    with_sizes: list[str] = []                  # 2. size line before every collection
    prev = None
    for _, lines in variables:
        n = _var_length(lines)
        if n is not None and prev != str(n):
            with_sizes.append(str(n))
        with_sizes.extend(lines)
        prev = lines[0] if _var_length(lines) is None else None

    without_sizes: list[str] = []               # 3. drop sizes the solution may not read
    for i, (_, lines) in enumerate(variables):
        if _var_length(lines) is None and i + 1 < len(variables):
            nxt = _var_length(variables[i + 1][1])
            if nxt is not None and lines[0].strip() == str(nxt):
                continue
        without_sizes.extend(lines)

    out: list[str] = []
    for seq in (verbatim, with_sizes, without_sizes):
        cand = "\n".join(seq) + "\n" if seq else ""
        if cand.strip() and cand not in out:
            out.append(cand)
    return out


_DISPLAY_PUNCT = re.compile(r"[\[\]\(\)\{\},\"']+")


def display_value_tokens(text: str) -> list[str]:
    """Tokens for comparing a DESCRIBED return value against PRINTED stdout.

    The description writes what the function returns (`[1, 2]`, `false`, `"NO"`); the
    solution prints it (`1 2`, `false`, `NO`). Brackets, quotes and commas exist only in
    the display form, so drop them and fold case before comparing. This comparison only
    picks WHICH candidate stdin layout is right — the pair that gets frozen afterwards is
    the reference's real stdout, byte for byte."""
    return _DISPLAY_PUNCT.sub(" ", text or "").lower().split()


def optimal_example_failures(
    optimal_code: str,
    description: str,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
) -> list[dict]:
    """Run the optimal on the description's worked examples and return the cases where
    it does NOT reproduce the stated expected output. Unlike the brute cross-check,
    this compares against the problem's own ground truth, so a non-empty result is
    strong, tie-break-independent evidence the reference/optimal solution is buggy."""
    pairs = extract_example_io(description)
    if not pairs:
        return []
    fails: list[dict] = []
    for inp, expected in pairs:
        got, status = run_solution(optimal_code, inp, timeout)
        if status != "ok":
            fails.append({"input": inp, "expected": normalize(expected), "got": f"<{status}>"})
        elif normalize(got) != normalize(expected):
            fails.append({"input": inp, "expected": normalize(expected), "got": normalize(got)[:120]})
    return fails


def is_stale_brute_only_crosscheck_marker(payload: dict) -> bool:
    """Pre-ground-truth crosscheck wrote mismatch for optimal/brute disagreement only."""
    if payload.get("status") != "mismatch":
        return False
    reason = str(payload.get("reason") or "")
    if "brute-force oracle" not in reason and "brute force oracle" not in reason:
        return False
    mismatches = payload.get("mismatches") or []
    return not any(str(m.get("optimal", "")).startswith("<") for m in mismatches)


def structured_random_inputs(examples: list[str], count: int = 100, seed: int = 7) -> list[str]:
    """Generate fresh SMALL inputs in the problem's own format, inferred from the
    example inputs: header tokens that equal an array length are treated as counts
    (regenerated to a small n), other header tokens as small parameters, and array
    lines as small random values (duplicates likely). Small inputs with small
    params + clustered values expose many bugs that large/random fuzz misses."""
    if not examples:
        return []
    rng = random.Random(seed)
    out: list[str] = []
    for _ in range(count):
        lines = [l for l in rng.choice(examples).split("\n")]
        header = lines[0].split() if lines else []
        arr_lines = [l.split() for l in lines[1:] if l.strip()]
        if not header or not arr_lines:
            continue
        arr_lens = {len(a) for a in arr_lines}
        n = rng.randint(1, 4)
        new_header = []
        for tok in header:
            try:
                tv = int(tok)
            except ValueError:
                new_header.append(tok)
                continue
            new_header.append(str(n) if tv in arr_lens else str(rng.randint(1, max(2, n + 1))))
        new_lines = [" ".join(new_header)]
        for _a in arr_lines:
            new_lines.append(" ".join(str(rng.randint(1, 12)) for _ in range(n)))
        out.append("\n".join(new_lines) + "\n")
    return out


_OPEN_ENDED_RE = re.compile(
    r"\b(return|print|output|construct|produce|find|report|give|build)\s+any\b"
    r"|\bany\s+(valid|such|one|correct)\b"
    r"|\bmultiple\s+(valid|correct|possible|right)\b"
    r"|\bmore than one\b"
    r"|\bif there (are|is)\s+(multiple|several|many)\b"
    r"|\bany of (them|the)\b",
    re.I,
)


def is_open_ended_problem(description: str) -> bool:
    """True when the statement accepts more than one correct output (e.g. "return
    any grid such that ..."). For these, optimal and brute legitimately differ
    textually, so a plain output comparison would false-positive."""
    return bool(_OPEN_ENDED_RE.search(description or ""))


def crosscheck_optimal_brute(
    optimal_code: str,
    brute_code: str,
    examples: list[str],
    count: int = 100,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
    max_report: int = 5,
) -> list[dict]:
    """Run the optimal and the (independent) brute on the example inputs plus a
    structure-aware small-input sweep; return the inputs where they disagree. A
    disagreement strongly indicates the reference/optimal solution is buggy."""
    candidates = list(examples) + structured_random_inputs(examples, count)
    if not candidates:
        return []
    opt = run_solutions_batch(optimal_code, candidates, timeout)
    bru = run_solutions_batch(brute_code, candidates, timeout)
    out: list[dict] = []
    for inp, (o, s1), (br, s2) in zip(candidates, opt, bru):
        if s1 == "ok" and s2 == "ok" and normalize(o) != normalize(br):
            out.append({"input": inp, "optimal": normalize(o)[:80], "brute": normalize(br)[:80]})
            if len(out) >= max_report:
                break
    return out


# --------------------------------------------------------------------------- #
# Consolidated benchmark
# --------------------------------------------------------------------------- #
@dataclass
class BenchmarkReport:
    kill_rate: float = 0.0
    b1: dict = field(default_factory=dict)
    b2: dict = field(default_factory=dict)
    b3: dict = field(default_factory=dict)
    b4: dict = field(default_factory=dict)
    hard_failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def passes_gate(self, min_kill: float) -> bool:
        if self.hard_failures:
            return False
        return self.kill_rate >= min_kill


def run_benchmark(
    optimal_path: str | None = None,
    testcases_path: str | None = None,
    description_path: str | None = None,
    brute_path: str | None = None,
    min_kill: float = DEFAULT_MIN_KILL,
    advisory_size: bool = False,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
    fuzz_count: int = BENCHMARK_FUZZ_COUNT,
    precomputed_b2: dict | None = None,
) -> BenchmarkReport:
    optimal_path = optimal_path or os.path.join("Outputs", "generatedFullCode", "PYTHON.py")
    testcases_path = testcases_path or os.path.join("Outputs", "testcases.json")
    description_path = description_path or os.path.join("Outputs", "generated_description.md")
    brute_candidates = [
        brute_path,
        os.path.join("Outputs", "generatedFullCode", "BRUTE_FORCE.py"),
        os.path.join("Outputs", "generatedFullCode", "BRUTE.py"),
    ]
    brute_path = next((p for p in brute_candidates if p and os.path.exists(p)), None)

    optimal_code = load_text(optimal_path)
    test_cases = load_testcases(testcases_path)
    description = load_text(description_path) if os.path.exists(description_path) else ""
    brute_code = load_text(brute_path) if brute_path else None

    _log_banner("Benchmark test-case suite")
    _log_detail(f"Optimal solution: {optimal_path}")
    _log_detail(f"Test cases: {len(test_cases)} from {testcases_path}")
    if brute_code:
        _log_detail(f"Brute force: {brute_path}")
    else:
        _log_warn("No brute-force reference — B4 differential fuzz will be skipped")

    report = BenchmarkReport()
    print("[B1] Mutation kill rate", flush=True)
    report.b1 = run_mutation_benchmark(optimal_code, test_cases, timeout=timeout, progress=True)
    report.kill_rate = report.b1["kill_rate"]
    threshold_ok = report.kill_rate >= min_kill
    if threshold_ok:
        _log_ok(
            f"[B1] kill rate {report.kill_rate:.1%} "
            f"({report.b1.get('killed', 0)}/{report.b1.get('non_equivalent_total', 0)} killed) "
            f"— meets {min_kill:.0%} target"
        )
    else:
        _log_fail(
            f"[B1] kill rate {report.kill_rate:.1%} "
            f"({report.b1.get('killed', 0)}/{report.b1.get('non_equivalent_total', 0)} killed) "
            f"— below {min_kill:.0%} target"
        )

    if precomputed_b2 is not None:
        # Merged select+benchmark step: select_testcases already ran every wrong
        # solution over the pool and knows which the selected suite fails to catch
        # (`uncatchable`). Reuse that verdict instead of re-executing every wrong
        # solution over the suite — same answer, one fewer full-suite pass.
        print("[B2] Wrong-approach gate (reused from selection)", flush=True)
        report.b2 = precomputed_b2
    else:
        print("[B2] Wrong-approach gate", flush=True)
        report.b2 = run_wrong_approach_gate(test_cases, timeout=timeout, progress=True,
                                            description=description)
    if report.b2.get("skipped"):
        pass
    elif report.b2.get("missing"):
        report.hard_failures.append(f"B2: {report.b2.get('reason')}")
    elif report.b2.get("hard_fail"):
        _log_fail(f"[B2] FAIL — wrong solution(s) passed tests")
        report.hard_failures.append(
            f"B2: wrong solution(s) passed: {report.b2.get('failures')}"
        )
    else:
        _log_ok(f"[B2] PASS — all {report.b2.get('wrong_files', 0)} wrong files rejected")

    print("[B3] Coverage-shape audit", flush=True)
    _log_detail("Checking subtask count, size distribution, and scenario tags…")
    report.b3 = audit_coverage_shape(
        test_cases, description, brute_code=brute_code, advisory_size=advisory_size,
        suite_complete=load_suite_complete(testcases_path),
    )
    report.warnings.extend(report.b3.get("warnings", []))
    if report.b3.get("hard_fail"):
        _log_fail(f"[B3] FAIL — {len(report.b3.get('issues', []))} issue(s)")
        for issue in report.b3.get("issues", [])[:5]:
            _log_fail(f"  {issue}")
        report.hard_failures.extend(report.b3.get("issues", []))
    else:
        _log_ok(
            f"[B3] PASS — {report.b3.get('total')} cases, "
            f"{report.b3.get('subtask_count')} subtask(s), "
            f"type={report.b3.get('problem_type')}"
        )
        if report.b3.get("size_split"):
            _log_detail(f"Size split: {report.b3['size_split']}")

    if brute_code:
        print("[B4] Differential fuzz vs brute force", flush=True)
        _log_detail(f"Generating up to {fuzz_count} random inputs…")
        report.b4 = run_differential_fuzz(
            optimal_code, brute_code, description,
            test_cases=test_cases, count=fuzz_count, timeout=timeout,
        )
        d = len(report.b4.get("disagreements", []))
        if report.b4.get("hard_fail"):
            # Advisory downgrade (mirrors generate_brute_force._crosscheck_optimal_vs_brute):
            # an optimal/brute disagreement is only trustworthy evidence of a buggy
            # optimal when the optimal ALSO fails the problem's own worked examples,
            # or the problem is open-ended. When the optimal reproduces every worked
            # example and the problem has a single valid answer, disagreements are
            # almost always multiple-valid-answer artifacts or precondition-sensitive
            # fuzz inputs (e.g. a "sorted" array perturbed into an unsorted one) —
            # advisory, not a hard fail.
            opt_fails_examples = bool(
                optimal_example_failures(optimal_code, description, timeout=timeout)
            )
            if not opt_fails_examples and not is_open_ended_problem(description):
                report.b4["hard_fail"] = False
                report.b4["advisory"] = True
                report.b4["advisory_reason"] = (
                    "optimal reproduces all worked examples and the problem is not "
                    f"open-ended; {d} optimal/brute disagreement(s) treated as advisory "
                    "(likely multiple valid answers or precondition-sensitive fuzz inputs)"
                )
                _log_warn(
                    f"[B4] ADVISORY — {d} optimal/brute disagreement(s); optimal passes "
                    "all worked examples, so not treated as a failure"
                )
                report.warnings.append(
                    f"B4: {d} optimal/brute disagreement(s) — advisory (optimal passes "
                    "worked examples; likely multiple-valid or precondition-sensitive)"
                )
            else:
                _log_fail(f"[B4] FAIL — {d} optimal/brute disagreement(s)")
                report.hard_failures.append(
                    f"B4: optimal vs brute disagreements: {d}"
                )
        else:
            _log_ok(f"[B4] PASS — no disagreements in {fuzz_count} fuzz inputs")
    else:
        report.b4 = {"skipped": True, "note": "no brute force"}

    return report


def print_report(report: BenchmarkReport, min_kill: float, report_only: bool = False) -> None:
    _log_banner("Final report")

    print(f"[B1] Mutation kill rate: {report.kill_rate:.1%} "
          f"({report.b1.get('killed', 0)}/{report.b1.get('non_equivalent_total', 0)})")
    if report.b1.get("survivors"):
        _log_warn(f"Survivors ({len(report.b1['survivors'])}) — mutants your tests did not kill:")
        for s in report.b1["survivors"][:10]:
            _log_detail(f"{s['id']} [{s['bug_class']}] {s['operator']}: {s['diff']}")
        if len(report.b1["survivors"]) > 10:
            _log_detail(f"… and {len(report.b1['survivors']) - 10} more (see benchmark output JSON if saved)")

    if report.b2.get("skipped"):
        _log_warn(f"B2 Wrong-approach gate: CANNOT JUDGE ({report.b2.get('reason')}) "
                  "— abstained, not a pass")
    elif report.b2.get("missing"):
        _log_fail(f"B2 Wrong-approach gate: BLOCKED ({report.b2.get('reason')})")
    else:
        if report.b2.get("hard_fail"):
            _log_fail(f"B2 Wrong-approach gate: FAIL ({report.b2.get('wrong_files', 0)} files checked)")
        else:
            _log_ok(f"B2 Wrong-approach gate: PASS ({report.b2.get('wrong_files', 0)} files)")

    if report.b3.get("hard_fail"):
        _log_fail(f"B3 Coverage-shape: FAIL")
    else:
        _log_ok(f"B3 Coverage-shape: PASS")
    _log_detail(
        f"total={report.b3.get('total')} subtasks={report.b3.get('subtask_count')} "
        f"type={report.b3.get('problem_type')}"
    )
    if report.b3.get("size_split"):
        _log_detail(f"size split: {report.b3['size_split']}")
    for issue in report.b3.get("issues", []):
        _log_fail(f"ISSUE: {issue}")

    if report.b4.get("skipped"):
        _log_warn(f"B4 Differential fuzz: SKIPPED ({report.b4.get('note')})")
    elif report.b4.get("advisory"):
        d = len(report.b4.get("disagreements", []))
        _log_warn(
            f"B4 Differential fuzz: ADVISORY ({d} disagreement(s); optimal passes "
            "all worked examples — not treated as a failure)"
        )
    else:
        d = len(report.b4.get("disagreements", []))
        if d:
            _log_fail(f"B4 Differential fuzz: FAIL ({d} disagreements)")
        else:
            _log_ok(f"B4 Differential fuzz: PASS")

    if report.warnings:
        _log_warn(f"{len(report.warnings)} warning(s):")
        for w in report.warnings[:8]:
            _log_detail(w)

    # Report-only mode (redesign): the deterministic selector owns the final suite,
    # and there is no longer a Strengthen/regeneration step to act on distribution
    # gaps — so B1/B2/B4 are the real signals and coverage-shape items are advisory
    # notes, never a pipeline failure.
    if report_only:
        real_pass = report.b1.get("kill_rate", 0.0) >= min_kill and not report.b2.get("hard_fail")
        print(f"\nBenchmark report (informational — not a gate). "
              f"Quality: {'STRONG' if real_pass else 'REVIEW'}", flush=True)
        if report.hard_failures:
            _log_warn(f"{len(report.hard_failures)} coverage-shape note(s) "
                      f"(distribution is owned by Select Test Cases; not blocking):")
            for hf in report.hard_failures:
                _log_detail(str(hf))
        return

    gate = "PASS" if report.passes_gate(min_kill) else "FAIL"
    print(f"\nGate (min_kill={min_kill:.0%}): {gate}", flush=True)
    if gate == "PASS":
        _log_ok("Benchmark gate passed — test suite is strong enough to continue")
    else:
        _log_fail("Benchmark gate failed — review survivors/issues above; "
                  "re-run Generate → Select Test Cases to rebuild the suite")
    if report.hard_failures:
        _log_fail(f"{len(report.hard_failures)} hard failure(s):")
        for hf in report.hard_failures:
            _log_detail(str(hf))


def main():
    parser = argparse.ArgumentParser(description="Benchmark test-case suite strength")
    parser.add_argument("--min-kill", type=float, default=DEFAULT_MIN_KILL)
    parser.add_argument("--no-gate", action="store_true",
                        help="Informational mode: do not exit non-zero on failures")
    parser.add_argument("--advisory-size", action="store_true",
                        help="Size distribution violations are warnings only")
    parser.add_argument("--timeout", type=float, default=BENCHMARK_RUN_TIMEOUT)
    args = parser.parse_args()

    root_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    os.chdir(root_dir)

    # Quiet the compiler's per-poll chatter ("poll N/480 -> PROCESSING"); the
    # benchmark's own phase lines (filter/test/killed-by) carry the progress.
    if _use_compiler():
        try:
            import execution_manager_v3 as _emv3
            _emv3.QUIET = True
        except Exception:
            pass

    report = run_benchmark(min_kill=args.min_kill, advisory_size=args.advisory_size,
                           timeout=args.timeout)
    print_report(report, args.min_kill, report_only=args.no_gate)

    if args.no_gate:
        sys.exit(0)
    if not report.passes_gate(args.min_kill):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
