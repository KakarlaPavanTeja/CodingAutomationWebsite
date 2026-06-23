"""
Benchmark harness for test-case suite strength (Component B).

Pure local execution: mutation kill rate (B1), wrong-approach gate (B2),
coverage-shape audit (B3), differential fuzz (B4).

Standalone CLI + importable API for harden_suite.py.
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
    detect_problem_type,
    derive_size_bucket,
    parse_constraint_max_n,
    parse_primary_n,
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
        if proc.returncode != 0:
            return [run_solution(code_str, inp, timeout) for inp in inputs]
        rows = json.loads(proc.stdout or "[]")
        out: list[tuple[str, str]] = []
        for row in rows:
            out.append((row.get("out", ""), row.get("status", "error")))
        while len(out) < len(inputs):
            out.append(("", "error"))
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

    if progress:
        _log_ok(
            f"Equivalence filter done — {len(non_equivalent)}/{len(mutants)} mutants need testing"
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
        "survivors": survivors,
        "mutant_objects": {m.mutant_id: m for m in non_equivalent},
    }


# --------------------------------------------------------------------------- #
# B2 — Wrong-approach gate
# --------------------------------------------------------------------------- #
def run_wrong_approach_gate(
    test_cases: list[dict],
    wrong_dir: str | None = None,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
    progress: bool = False,
) -> dict[str, Any]:
    wrong_dir = wrong_dir or os.path.join("Outputs", "wrong_solutions")
    paths = sorted(glob.glob(os.path.join(wrong_dir, "*.py")))
    if not paths:
        if progress:
            _log_warn("No wrong_solutions/*.py found — skipping B2")
        return {"skipped": True, "note": "no wrong_solutions/*.py found", "hard_fail": False}

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
    return {
        "skipped": False,
        "wrong_files": len(paths),
        "failures": failures,
        "hard_fail": len(failures) > 0,
    }


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
) -> dict[str, Any]:
    issues: list[str] = []
    warnings: list[str] = []
    hard_fail = False

    total = len(test_cases)
    if total < MIN_TESTCASES:
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

    max_n = parse_constraint_max_n(description)
    bucket_counts = {b: 0 for b in SIZE_BUCKETS}
    mislabeled = 0
    for tc in test_cases:
        inp = tc.get("input", "")
        n = parse_primary_n(inp)
        bucket = derive_size_bucket(n, max_n, inp)
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
            warnings.append("brute disagrees with expected output on spot-check case")

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
    count: int = BENCHMARK_FUZZ_COUNT,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
) -> dict[str, Any]:
    max_n = parse_constraint_max_n(description) or 100
    cap = min(max_n, 50)
    disagreements = []
    random.seed(42)
    # Generate all fuzz inputs first, then run optimal + brute each in ONE batched
    # process (was 2 subprocess spawns per input). Same seed -> same inputs/results.
    inputs = []
    for _ in range(count):
        n = random.randint(1, max(1, cap))
        inputs.append(f"{n}\n" + " ".join(str(random.randint(-10, 10)) for _ in range(n)) + "\n0\n")
    opt_results = run_solutions_batch(optimal_code, inputs, timeout)
    bru_results = run_solutions_batch(brute_code, inputs, timeout)
    for inp, (opt_out, s1), (bru_out, s2) in zip(inputs, opt_results, bru_results):
        if s1 != "ok" or s2 != "ok":
            continue
        if normalize(opt_out) != normalize(bru_out):
            disagreements.append({"input": inp[:200], "optimal": opt_out[:100], "brute": bru_out[:100]})
            if len(disagreements) >= 5:
                break
    return {
        "runs": count,
        "disagreements": disagreements,
        "hard_fail": len(disagreements) > 0,
    }


# --------------------------------------------------------------------------- #
# Fuzz-harden helpers (used by harden_suite)
# --------------------------------------------------------------------------- #
def fuzz_kill_survivors(
    optimal_code: str,
    test_cases: list[dict],
    survivors: list[dict],
    mutant_map: dict[str, Mutant],
    brute_code: str | None = None,
    description: str = "",
    count: int = 300,
    timeout: float = DEFAULT_RUN_TIMEOUT,
    progress: bool = False,
) -> list[dict]:
    """Generate random/boundary inputs; keep those that kill surviving mutants."""
    if not survivors:
        return []
    survivor_ids = {s["id"] for s in survivors}
    max_n = parse_constraint_max_n(description) or 100
    cap = min(max_n, 80)
    random.seed(123)
    new_cases: list[dict] = []
    seen_inputs = {tc.get("input", "") for tc in test_cases}

    size_pool: list[int] = []
    for n in [1, 2, max(1, cap // 2), cap, max_n if max_n else cap]:
        if n and n <= (max_n or cap):
            size_pool.append(n)

    # Generate all candidate inputs up front (deduped), then execute in batches —
    # one process for the optimal over all inputs, one for brute, and one per
    # survivor mutant — instead of a subprocess per (input x solution).
    gen_inputs: list[str] = []
    for _fi in range(count):
        n = random.choice(size_pool) if size_pool else random.randint(1, cap)
        inp = f"{n}\n" + " ".join(str(random.randint(-1000, 1000)) for _ in range(n))
        if inp in seen_inputs:
            continue
        seen_inputs.add(inp)
        gen_inputs.append(inp)
    if not gen_inputs:
        return []

    # Keep inputs the optimal accepts; record expected output.
    opt_results = run_solutions_batch(optimal_code, gen_inputs, timeout)
    valid: list[tuple[str, str]] = [
        (inp, normalize(out)) for inp, (out, s1) in zip(gen_inputs, opt_results) if s1 == "ok"
    ]
    # Cross-check against brute force where available.
    if brute_code and valid:
        bru_results = run_solutions_batch(brute_code, [inp for inp, _ in valid], timeout)
        valid = [
            (inp, exp)
            for (inp, exp), (bout, bs) in zip(valid, bru_results)
            if bs == "ok" and normalize(bout) == exp
        ]
    if not valid:
        return []

    valid_inputs = [inp for inp, _ in valid]
    expected_by_input = dict(valid)

    # An input kills a survivor when that mutant errors/timeouts or disagrees with
    # the (already-validated) expected output. One batched run per survivor.
    killer: set[str] = set()
    for sid in survivor_ids:
        m = mutant_map.get(sid)
        if not m:
            continue
        mres = run_solutions_batch(m.code, valid_inputs, timeout)
        for inp, (mout, mstatus) in zip(valid_inputs, mres):
            if mstatus in ("timeout", "error") or normalize(mout) != expected_by_input[inp]:
                killer.add(inp)
    if progress:
        print(f"    fuzz: {len(valid_inputs)} valid input(s), {len(killer)} killer case(s)", flush=True)

    for inp, exp in valid:
        if inp not in killer:
            continue
        n_val = parse_primary_n(inp)
        bucket = derive_size_bucket(n_val, max_n, inp)
        new_cases.append({
            "input": inp,
            "output": exp,
            "weightage": 1.0,
            "tags": [size_tag_from_bucket(bucket), "fuzz_harden", "adversarial"],
            "order": 0,
        })
    return new_cases


def _perturb_numeric_inputs(test_cases: list[dict], count: int, seed: int = 777) -> list[str]:
    """Generate new inputs by perturbing the NUMERIC VALUES in existing test-case
    inputs while keeping their line/token structure intact. This is format-
    agnostic — it reuses each problem's real input shape (counts, line layout)
    and only changes data values — so the optimal solution still accepts them.
    Used to find inputs that distinguish the optimal from a surviving wrong
    solution (B2 strengthening)."""
    bases = [tc.get("input", "") for tc in test_cases if tc.get("input")]
    if not bases:
        return []
    rng = random.Random(seed)
    seen = {tc.get("input", "") for tc in test_cases}
    deltas = [1, -1, 2, -2, 3, -3, 5, -5, 10, -10]
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
                r = rng.random()
                v2 = v + rng.choice(deltas) if r < 0.7 else (-v if r < 0.85 else rng.choice([0, 1, -1, 1000, -1000]))
                toks[j] = str(v2)
                changed = True
        if not changed:
            continue
        new_lines[li] = " ".join(toks)
        cand = "\n".join(new_lines)
        if cand in seen:
            continue
        seen.add(cand)
        out.append(cand)
    return out


def fuzz_kill_wrong_solutions(
    optimal_code: str,
    test_cases: list[dict],
    wrong_solutions: list[tuple[str, str]],
    brute_code: str | None = None,
    count: int = 200,
    timeout: float = BENCHMARK_RUN_TIMEOUT,
    description: str = "",
    progress: bool = False,
    chunk: int = 40,
    target_per_solution: int = 3,
    max_seconds: float = 45.0,
) -> list[dict]:
    """Find inputs that kill surviving WRONG solutions (B2). Perturbs existing
    inputs (format-preserving), validates against optimal (+ brute), and keeps
    cases where a wrong solution disagrees. Processed in CHUNKS with early-stop
    and a wall-time cap — a handful of discriminating cases per wrong solution is
    enough, and blind perturbation can't always find subtle ones, so it must not
    run unbounded."""
    if not wrong_solutions:
        return []
    candidates = _perturb_numeric_inputs(test_cases, count)
    if not candidates:
        return []
    max_n = parse_constraint_max_n(description) or 100
    deadline = time.monotonic() + max_seconds

    killer_cases: dict[str, str] = {}  # input -> expected
    kills_per_sol = {name: 0 for name, _ in wrong_solutions}

    for start in range(0, len(candidates), chunk):
        if time.monotonic() > deadline:
            if progress:
                print(f"    wrong-soln harden: time cap reached ({max_seconds:.0f}s)", flush=True)
            break
        batch = candidates[start:start + chunk]
        opt_results = run_solutions_batch(optimal_code, batch, timeout)
        valid = [(inp, normalize(o)) for inp, (o, s) in zip(batch, opt_results) if s == "ok"]
        if brute_code and valid:
            bru = run_solutions_batch(brute_code, [i for i, _ in valid], timeout)
            valid = [(i, e) for (i, e), (bo, bs) in zip(valid, bru) if bs == "ok" and normalize(bo) == e]
        if valid:
            vin = [i for i, _ in valid]
            exp_by = dict(valid)
            for name, code in wrong_solutions:
                wres = run_solutions_batch(code, vin, timeout)
                for inp, (wout, wstatus) in zip(vin, wres):
                    if wstatus in ("timeout", "error") or normalize(wout) != exp_by[inp]:
                        killer_cases.setdefault(inp, exp_by[inp])
                        kills_per_sol[name] += 1
        if progress:
            print(f"    wrong-soln harden: {len(killer_cases)} killer case(s) after "
                  f"{min(start + chunk, len(candidates))} candidate(s)", flush=True)
        # Stop once every surviving wrong solution has enough discriminating cases.
        if all(kills_per_sol[name] >= target_per_solution for name, _ in wrong_solutions):
            break

    new_cases: list[dict] = []
    for inp, exp in killer_cases.items():
        n_val = parse_primary_n(inp)
        bucket = derive_size_bucket(n_val, max_n, inp)
        new_cases.append({
            "input": inp,
            "output": exp,
            "weightage": 1.0,
            "tags": [size_tag_from_bucket(bucket), "wrong_soln_harden", "adversarial"],
            "order": 0,
        })
    return new_cases


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

    print("[B2] Wrong-approach gate", flush=True)
    report.b2 = run_wrong_approach_gate(test_cases, timeout=timeout, progress=True)
    if report.b2.get("skipped"):
        pass
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
        test_cases, description, brute_code=brute_code, advisory_size=advisory_size
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
            optimal_code, brute_code, description, count=fuzz_count, timeout=timeout
        )
        d = len(report.b4.get("disagreements", []))
        if report.b4.get("hard_fail"):
            _log_fail(f"[B4] FAIL — {d} optimal/brute disagreement(s)")
            report.hard_failures.append(
                f"B4: optimal vs brute disagreements: {d}"
            )
        else:
            _log_ok(f"[B4] PASS — no disagreements in {fuzz_count} fuzz inputs")
    else:
        report.b4 = {"skipped": True, "note": "no brute force"}

    return report


def print_report(report: BenchmarkReport, min_kill: float) -> None:
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
        _log_warn(f"B2 Wrong-approach gate: SKIPPED ({report.b2.get('note')})")
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

    gate = "PASS" if report.passes_gate(min_kill) else "FAIL"
    print(f"\nGate (min_kill={min_kill:.0%}): {gate}", flush=True)
    if gate == "PASS":
        _log_ok("Benchmark gate passed — test suite is strong enough to continue")
    else:
        _log_fail("Benchmark gate failed — review survivors/issues above or run Strengthen Test Cases")
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

    report = run_benchmark(min_kill=args.min_kill, advisory_size=args.advisory_size,
                           timeout=args.timeout)
    print_report(report, args.min_kill)

    if args.no_gate:
        sys.exit(0)
    if not report.passes_gate(args.min_kill):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
