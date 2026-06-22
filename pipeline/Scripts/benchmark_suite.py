"""
Benchmark harness for test-case suite strength (Component B).

Pure local execution: mutation kill rate (B1), wrong-approach gate (B2),
coverage-shape audit (B3), differential fuzz (B4).

Standalone CLI + importable API for harden_suite.py.
"""

from __future__ import annotations

import argparse
import ast
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
DEFAULT_FUZZ_COUNT = 500
MUTANT_CAP = 120

SIZE_PREFIX = "size_"
SIZE_BUCKETS = ("edge", "small", "medium", "large")

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


def run_against_suite(
    code_str: str,
    test_cases: list[dict],
    timeout: float = DEFAULT_RUN_TIMEOUT,
) -> list[tuple[int, bool, str]]:
    """Run code against each case. Returns [(index, passed, status), ...]."""
    results = []
    for i, tc in enumerate(test_cases):
        inp = tc.get("input", "")
        expected = normalize(tc.get("output", ""))
        out, status = run_solution(code_str, inp, timeout)
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



def _outputs_on_inputs(code: str, inputs: list[str], timeout: float) -> list[str | None]:
    outs = []
    for inp in inputs:
        out, status = run_solution(code, inp, timeout)
        if status != "ok":
            outs.append(None)
        else:
            outs.append(normalize(out))
    return outs


def is_equivalent_mutant(
    mutant: Mutant,
    optimal_code: str,
    test_cases: list[dict],
    extra_inputs: list[str] | None = None,
    timeout: float = DEFAULT_RUN_TIMEOUT,
) -> bool:
    inputs = [tc.get("input", "") for tc in test_cases]
    if extra_inputs:
        inputs.extend(extra_inputs)
    opt_outs = _outputs_on_inputs(optimal_code, inputs, timeout)
    mut_outs = _outputs_on_inputs(mutant.code, inputs, timeout)
    if len(opt_outs) != len(mut_outs):
        return False
    for o, m in zip(opt_outs, mut_outs):
        if o is None or m is None:
            continue
        if o != m:
            return False
    return True


def run_mutation_benchmark(
    optimal_code: str,
    test_cases: list[dict],
    mutants: list[Mutant] | None = None,
    timeout: float = DEFAULT_RUN_TIMEOUT,
    progress: bool = False,
) -> dict[str, Any]:
    if mutants is None:
        mutants = generate_mutants(optimal_code)

    if progress:
        print(f"  Generated {len(mutants)} mutant(s); filtering equivalents "
              f"against {len(test_cases)} case(s)...", flush=True)

    random.seed(42)
    fuzz_inputs = [tc.get("input", "") for tc in random.sample(
        test_cases, min(5, len(test_cases))
    )] if test_cases else []

    non_equivalent: list[Mutant] = []
    for i, m in enumerate(mutants):
        if not is_equivalent_mutant(m, optimal_code, test_cases, fuzz_inputs, timeout):
            non_equivalent.append(m)
        if progress and (i + 1) % 20 == 0:
            print(f"    filtered {i + 1}/{len(mutants)} "
                  f"({len(non_equivalent)} non-equivalent so far)", flush=True)

    if progress:
        print(f"  Testing {len(non_equivalent)} non-equivalent mutant(s) "
              f"against the suite...", flush=True)

    killed: list[str] = []
    survivors: list[dict] = []

    for idx, m in enumerate(non_equivalent):
        is_killed = False
        for tc in test_cases:
            inp = tc.get("input", "")
            expected = normalize(tc.get("output", ""))
            out, status = run_solution(m.code, inp, timeout)
            if status == "timeout":
                opt_out, opt_status = run_solution(optimal_code, inp, timeout)
                if opt_status == "ok":
                    is_killed = True
                    break
                continue
            if status == "error":
                is_killed = True
                break
            if normalize(out) != expected:
                is_killed = True
                break
        if is_killed:
            killed.append(m.mutant_id)
        else:
            survivors.append({
                "id": m.mutant_id,
                "operator": m.operator,
                "bug_class": m.bug_class,
                "diff": m.diff_summary,
            })
        if progress and (idx + 1) % 20 == 0:
            print(f"    tested {idx + 1}/{len(non_equivalent)} "
                  f"({len(killed)} killed)", flush=True)

    total = len(non_equivalent)
    kill_rate = (len(killed) / total) if total else 1.0
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
    timeout: float = DEFAULT_RUN_TIMEOUT,
) -> dict[str, Any]:
    wrong_dir = wrong_dir or os.path.join("Outputs", "wrong_solutions")
    paths = sorted(glob.glob(os.path.join(wrong_dir, "*.py")))
    if not paths:
        return {"skipped": True, "note": "no wrong_solutions/*.py found", "hard_fail": False}

    failures = []
    for path in paths:
        code = load_text(path)
        results = run_against_suite(code, test_cases, timeout)
        passed_any = any(p for _, p, _ in results)
        if passed_any:
            failures.append({
                "file": os.path.basename(path),
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
    count: int = DEFAULT_FUZZ_COUNT,
    timeout: float = DEFAULT_RUN_TIMEOUT,
) -> dict[str, Any]:
    max_n = parse_constraint_max_n(description) or 100
    cap = min(max_n, 50)
    disagreements = []
    random.seed(42)
    for _ in range(count):
        n = random.randint(1, max(1, cap))
        # generic numeric fuzz — problems may reject; skip non-ok
        inp = f"{n}\n" + " ".join(str(random.randint(-10, 10)) for _ in range(n)) + "\n0\n"
        opt_out, s1 = run_solution(optimal_code, inp, timeout)
        bru_out, s2 = run_solution(brute_code, inp, timeout)
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

    def kills_survivor(inp: str, expected: str) -> bool:
        for sid in survivor_ids:
            m = mutant_map.get(sid)
            if not m:
                continue
            out, status = run_solution(m.code, inp, timeout)
            if status in ("timeout", "error"):
                opt_out, opt_s = run_solution(optimal_code, inp, timeout)
                if opt_s == "ok":
                    return True
                continue
            if normalize(out) != expected:
                return True
        return False

    candidates: list[str] = []
    # boundary sizes
    for n in [1, 2, max(1, cap // 2), cap, max_n if max_n else cap]:
        if n and n <= (max_n or cap):
            candidates.append(n)
    for fi in range(count):
        if progress and fi and fi % 100 == 0:
            print(f"    fuzz {fi}/{count} ({len(new_cases)} killer case(s) so far)", flush=True)
        n = random.choice(candidates) if candidates else random.randint(1, cap)
        inp = f"{n}\n" + " ".join(str(random.randint(-1000, 1000)) for _ in range(n))
        if inp in seen_inputs:
            continue
        opt_out, s1 = run_solution(optimal_code, inp, timeout)
        if s1 != "ok":
            continue
        expected = normalize(opt_out)
        if brute_code:
            bru_out, s2 = run_solution(brute_code, inp, timeout)
            if s2 != "ok" or normalize(bru_out) != expected:
                continue
        if kills_survivor(inp, expected):
            n_val = parse_primary_n(inp)
            bucket = derive_size_bucket(n_val, max_n, inp)
            new_cases.append({
                "input": inp,
                "output": expected,
                "weightage": 1.0,
                "tags": [size_tag_from_bucket(bucket), "fuzz_harden", "adversarial"],
                "order": 0,
            })
            seen_inputs.add(inp)
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
    timeout: float = DEFAULT_RUN_TIMEOUT,
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

    print(f"Loaded {len(test_cases)} test case(s)"
          f"{' with brute force' if brute_code else ' (no brute force)'}", flush=True)

    report = BenchmarkReport()
    print("[B1] Mutation kill rate - generating and testing mutants...", flush=True)
    report.b1 = run_mutation_benchmark(optimal_code, test_cases, timeout=timeout, progress=True)
    report.kill_rate = report.b1["kill_rate"]
    print(f"[B1] kill rate {report.kill_rate:.1%} "
          f"({report.b1.get('killed', 0)}/{report.b1.get('non_equivalent_total', 0)} killed, "
          f"{len(report.b1.get('survivors', []))} survivor(s))", flush=True)

    print("[B2] Wrong-approach gate...", flush=True)
    report.b2 = run_wrong_approach_gate(test_cases, timeout=timeout)
    if report.b2.get("hard_fail"):
        report.hard_failures.append(
            f"B2: wrong solution(s) passed: {report.b2.get('failures')}"
        )

    print("[B3] Coverage-shape audit...", flush=True)
    report.b3 = audit_coverage_shape(
        test_cases, description, brute_code=brute_code, advisory_size=advisory_size
    )
    report.warnings.extend(report.b3.get("warnings", []))
    if report.b3.get("hard_fail"):
        report.hard_failures.extend(report.b3.get("issues", []))

    if brute_code:
        print("[B4] Differential fuzz vs brute force...", flush=True)
        report.b4 = run_differential_fuzz(optimal_code, brute_code, description, timeout=timeout)
        if report.b4.get("hard_fail"):
            report.hard_failures.append(
                f"B4: optimal vs brute disagreements: {len(report.b4.get('disagreements', []))}"
            )
    else:
        report.b4 = {"skipped": True, "note": "no brute force"}

    return report


def print_report(report: BenchmarkReport, min_kill: float) -> None:
    print("\n=== Benchmark Report ===")
    print(f"B1 Mutation kill rate: {report.kill_rate:.1%} "
          f"({report.b1.get('killed', 0)}/{report.b1.get('non_equivalent_total', 0)})")
    if report.b1.get("survivors"):
        print(f"  Survivors ({len(report.b1['survivors'])}):")
        for s in report.b1["survivors"][:10]:
            print(f"    {s['id']} [{s['bug_class']}] {s['operator']}: {s['diff']}")
        if len(report.b1["survivors"]) > 10:
            print(f"    ... and {len(report.b1['survivors']) - 10} more")

    if report.b2.get("skipped"):
        print(f"B2 Wrong-approach gate: SKIPPED ({report.b2.get('note')})")
    else:
        status = "PASS" if not report.b2.get("hard_fail") else "FAIL"
        print(f"B2 Wrong-approach gate: {status} ({report.b2.get('wrong_files', 0)} files)")

    print(f"B3 Coverage-shape: {'FAIL' if report.b3.get('hard_fail') else 'PASS'}")
    print(f"  total={report.b3.get('total')} subtasks={report.b3.get('subtask_count')}")
    if report.b3.get("size_split"):
        print(f"  size split: {report.b3['size_split']}")
    for issue in report.b3.get("issues", []):
        print(f"  ISSUE: {issue}")

    if report.b4.get("skipped"):
        print(f"B4 Differential fuzz: SKIPPED ({report.b4.get('note')})")
    else:
        d = len(report.b4.get("disagreements", []))
        print(f"B4 Differential fuzz: {'FAIL' if d else 'PASS'} ({d} disagreements)")

    if report.warnings:
        print("Warnings:")
        for w in report.warnings[:8]:
            print(f"  - {w}")

    gate = "PASS" if report.passes_gate(min_kill) else "FAIL"
    print(f"\nGate (min_kill={min_kill:.0%}): {gate}")
    if report.hard_failures:
        print("Hard failures:")
        for hf in report.hard_failures:
            print(f"  - {hf}")


def main():
    parser = argparse.ArgumentParser(description="Benchmark test-case suite strength")
    parser.add_argument("--min-kill", type=float, default=DEFAULT_MIN_KILL)
    parser.add_argument("--no-gate", action="store_true",
                        help="Informational mode: do not exit non-zero on failures")
    parser.add_argument("--advisory-size", action="store_true",
                        help="Size distribution violations are warnings only")
    parser.add_argument("--timeout", type=float, default=DEFAULT_RUN_TIMEOUT)
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
