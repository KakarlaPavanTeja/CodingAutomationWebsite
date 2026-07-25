# Testcase Selection Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, LLM-free core that turns an annotated candidate pool into the final selected testcase suite — exact-input dedup, model-fed size bucketing, and the guarantee + fill-to-cap selection algorithm.

**Architecture:** A single pure module `pipeline/Scripts/testcase_selection.py` operating on plain case dicts. No subprocess, no network, no LLM — every function is deterministic and unit-testable. Later phases (running solutions to produce `kills`/`is_tle`, the generator-script/prompt, step wiring, frontend) consume this module; they are separate plans.

**Tech Stack:** Python 3 stdlib only (`hashlib`, `collections`), `unittest` (matches `npm run test:json`).

## Global Constraints

- Deterministic: same input pool → same selected suite. No `random`, no clock, stable tie-breaks by `id`.
- Hard cap `TESTCASE_CASE_CAP = 150`; floor `TESTCASE_CASE_FLOOR = 25` (env-overridable by callers).
- No new dependencies — stdlib only.
- Case record is the contract between phases; do not rename fields without updating the spec.

---

## Case record (the contract)

A candidate case is a `dict` with these keys (produced by later phases, consumed here):

```python
# id: str            stable unique id (e.g. "c0007")
# input: str         raw stdin the solution parses
# output: str        expected output (from reference solution)
# size_metric: int   model-declared numeric size (n / len / rows*cols / ...)
# max_n: int         problem-level MAX_N (same for all cases of a problem)
# subtask: str       e.g. "S1".."S8"
# scenario: str      e.g. "answer_at_end", "duplicates"
# is_edge: bool      came from the generator's EDGE_CASES section
# is_tle: bool       brute force verified-timed-out on this case
# kills: set[str]    ids of wrong solutions this case catches
```

---

### Task 1: Size bucketing

**Files:**
- Create: `pipeline/Scripts/testcase_selection.py`
- Test: `pipeline/Scripts/tests/test_testcase_selection.py`

**Interfaces:**
- Produces: `bucket_size(size_metric: int, max_n: int) -> str` returning one of `"edge"|"small"|"medium"|"large"`; constants `SMALL_FRAC`, `LARGE_FRAC`.

- [ ] **Step 1: Write the failing test**

```python
# pipeline/Scripts/tests/test_testcase_selection.py
import unittest
from testcase_selection import bucket_size

class TestBucketSize(unittest.TestCase):
    def test_edge_is_degenerate(self):
        self.assertEqual(bucket_size(0, 100000), "edge")
        self.assertEqual(bucket_size(1, 100000), "edge")

    def test_small_up_to_20pct(self):
        self.assertEqual(bucket_size(20, 100000), "small")
        self.assertEqual(bucket_size(20000, 100000), "small")   # 0.2*MAX_N

    def test_large_at_half_max(self):
        self.assertEqual(bucket_size(50000, 100000), "large")
        self.assertEqual(bucket_size(100000, 100000), "large")

    def test_medium_between(self):
        self.assertEqual(bucket_size(20001, 100000), "medium")
        self.assertEqual(bucket_size(49999, 100000), "medium")

    def test_tiny_max_n_still_orders(self):
        self.assertEqual(bucket_size(1, 4), "edge")
        self.assertEqual(bucket_size(4, 4), "large")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: FAIL with `ImportError: cannot import name 'bucket_size'`.

- [ ] **Step 3: Write minimal implementation**

```python
# pipeline/Scripts/testcase_selection.py
"""Deterministic, LLM-free testcase selection core.

Turns an annotated candidate pool (list of case dicts) into the final suite:
dedup exact inputs, bucket by model-declared size, then guarantee + fill-to-cap
selection. Pure functions only — no subprocess, network, clock, or randomness.
"""

# Bucket thresholds as proportions of MAX_N. edge is degenerate (<=1);
# small up to SMALL_FRAC; large from LARGE_FRAC; medium is the gap.
SMALL_FRAC = 0.2
LARGE_FRAC = 0.5


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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/testcase_selection.py pipeline/Scripts/tests/test_testcase_selection.py
git commit -m "feat(testcases): size bucketing from model-declared size_metric"
```

---

### Task 2: Exact-input dedup

**Files:**
- Modify: `pipeline/Scripts/testcase_selection.py`
- Test: `pipeline/Scripts/tests/test_testcase_selection.py`

**Interfaces:**
- Produces: `normalize_input(raw: str) -> str`; `dedup_by_input(cases: list[dict]) -> tuple[list[dict], int]` returning `(unique_cases, dropped_count)`, keeping the first occurrence in input order.

- [ ] **Step 1: Write the failing test**

```python
from testcase_selection import normalize_input, dedup_by_input

class TestDedup(unittest.TestCase):
    def test_normalize_collapses_trailing_ws_and_newlines(self):
        self.assertEqual(normalize_input("1 2 3\n"), normalize_input("1 2 3"))
        self.assertEqual(normalize_input("1 2 3 \n\n"), normalize_input("1 2 3"))

    def test_normalize_preserves_internal_structure(self):
        self.assertNotEqual(normalize_input("1 2\n3 4"), normalize_input("1 2 3 4"))

    def test_dedup_keeps_first_drops_exact_dupes(self):
        cases = [
            {"id": "a", "input": "1 2 3"},
            {"id": "b", "input": "1 2 3\n"},   # exact dup after normalize
            {"id": "c", "input": "4 5 6"},
        ]
        unique, dropped = dedup_by_input(cases)
        self.assertEqual([c["id"] for c in unique], ["a", "c"])
        self.assertEqual(dropped, 1)

    def test_dedup_keeps_different_inputs(self):
        cases = [{"id": "a", "input": "1 1"}, {"id": "b", "input": "1 2"}]
        unique, dropped = dedup_by_input(cases)
        self.assertEqual(dropped, 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: FAIL with `ImportError: cannot import name 'normalize_input'`.

- [ ] **Step 3: Write minimal implementation**

```python
import hashlib

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/testcase_selection.py pipeline/Scripts/tests/test_testcase_selection.py
git commit -m "feat(testcases): exact-input dedup with structure-preserving normalize"
```

---

### Task 3: Selection — guarantee pass (edges, TLE, slot coverage, kill completion)

**Files:**
- Modify: `pipeline/Scripts/testcase_selection.py`
- Test: `pipeline/Scripts/tests/test_testcase_selection.py`

**Interfaces:**
- Consumes: cases carrying `bucket` (set by caller / Task 4 before this runs).
- Produces: `guarantee_pass(cases: list[dict], wrong_ids: set[str]) -> tuple[list[dict], dict]` returning `(selected, report)` where `report` has `slots_total`, `slots_filled`, `edges`, `tle`, `kills_covered`, `kills_total`, `uncatchable`; helpers `_slot(c)`, `_add(sel, seen, c)`.

- [ ] **Step 1: Write the failing test**

```python
from testcase_selection import guarantee_pass

def mk(id, subtask, bucket, scenario, kills=(), is_edge=False, is_tle=False, size=10):
    return {"id": id, "input": id, "output": "", "subtask": subtask,
            "bucket": bucket, "scenario": scenario, "is_edge": is_edge,
            "is_tle": is_tle, "size_metric": size, "max_n": 100,
            "kills": set(kills)}

class TestGuaranteePass(unittest.TestCase):
    def test_all_edges_included(self):
        cases = [mk("e1","S1","edge","min",is_edge=True),
                 mk("e2","S1","edge","empty",is_edge=True),
                 mk("n1","S1","small","x")]
        selected, rep = guarantee_pass(cases, wrong_ids=set())
        ids = {c["id"] for c in selected}
        self.assertIn("e1", ids); self.assertIn("e2", ids)

    def test_all_tle_included(self):
        cases = [mk("t1","S3","large","maxn",is_tle=True), mk("n1","S1","small","x")]
        selected, rep = guarantee_pass(cases, wrong_ids=set())
        self.assertIn("t1", {c["id"] for c in selected})
        self.assertEqual(rep["tle"], 1)

    def test_each_slot_covered_once(self):
        cases = [mk("a","S1","small","x"), mk("b","S1","small","x"),  # same slot
                 mk("c","S1","small","y")]
        selected, rep = guarantee_pass(cases, wrong_ids=set())
        self.assertEqual(rep["slots_filled"], 2)  # (S1,small,x) and (S1,small,y)

    def test_kill_completion_covers_all_wrong(self):
        cases = [mk("a","S1","small","x",kills=("w1",)),
                 mk("b","S1","small","x",kills=("w2",))]
        selected, rep = guarantee_pass(cases, wrong_ids={"w1","w2"})
        self.assertEqual(rep["kills_covered"], 2)
        self.assertEqual(rep["uncatchable"], [])

    def test_uncatchable_wrong_reported(self):
        cases = [mk("a","S1","small","x",kills=("w1",))]
        selected, rep = guarantee_pass(cases, wrong_ids={"w1","w2"})
        self.assertEqual(rep["uncatchable"], ["w2"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: FAIL with `ImportError: cannot import name 'guarantee_pass'`.

- [ ] **Step 3: Write minimal implementation**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: PASS (14 tests total).

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/testcase_selection.py pipeline/Scripts/tests/test_testcase_selection.py
git commit -m "feat(testcases): guarantee-pass selection (edges/TLE/slots/kill-cover)"
```

---

### Task 4: Selection — fill pass + top-level `select_suite`

**Files:**
- Modify: `pipeline/Scripts/testcase_selection.py`
- Test: `pipeline/Scripts/tests/test_testcase_selection.py`

**Interfaces:**
- Consumes: `bucket_size` (Task 1), `dedup_by_input` (Task 2), `guarantee_pass`/`_slot`/`_add` (Task 3).
- Produces: `select_suite(cases: list[dict], wrong_ids: set[str], max_n: int, cap: int = 150, floor: int = 25) -> tuple[list[dict], dict]`. Annotates `bucket`, dedups, runs guarantee pass, fills to `cap`. Report adds `generated`, `unique`, `selected`, `below_floor`. Helper `_fill_pass(selected, seen, remaining, cap)`.

- [ ] **Step 1: Write the failing test**

```python
from testcase_selection import select_suite

class TestSelectSuite(unittest.TestCase):
    def _pool(self, n):
        pool = []
        for i in range(n):
            c = mk(f"c{i:03d}", "S1", "small", f"s{i%5}", size=10)
            c["input"] = c["id"]      # unique inputs
            c.pop("bucket")           # select_suite computes bucket
            pool.append(c)
        return pool

    def test_fills_up_to_cap(self):
        selected, rep = select_suite(self._pool(300), wrong_ids=set(), max_n=100, cap=150)
        self.assertEqual(len(selected), 150)
        self.assertEqual(rep["selected"], 150)

    def test_dedup_before_select(self):
        a = mk("a","S1","small","x"); a["input"]="same"; a.pop("bucket")
        b = mk("b","S1","small","x"); b["input"]="same"; b.pop("bucket")
        selected, rep = select_suite([a, b], wrong_ids=set(), max_n=100, cap=150)
        self.assertEqual(rep["unique"], 1)
        self.assertEqual(len(selected), 1)

    def test_below_floor_flagged(self):
        selected, rep = select_suite(self._pool(3), wrong_ids=set(), max_n=100, cap=150, floor=25)
        self.assertTrue(rep["below_floor"])

    def test_deterministic(self):
        import copy
        pool = self._pool(200)
        a, _ = select_suite(copy.deepcopy(pool), set(), 100)
        b, _ = select_suite(copy.deepcopy(pool), set(), 100)
        self.assertEqual([c["id"] for c in a], [c["id"] for c in b])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: FAIL with `ImportError: cannot import name 'select_suite'`.

- [ ] **Step 3: Write minimal implementation**

```python
from collections import Counter


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


def select_suite(cases, wrong_ids, max_n, cap=150, floor=25):
    generated = len(cases)
    for c in cases:
        c["bucket"] = bucket_size(c["size_metric"], max_n)
        c["kills"] = set(c.get("kills") or set())
    unique, _dropped = dedup_by_input(cases)
    selected, report = guarantee_pass(unique, wrong_ids)
    seen = {c["id"] for c in selected}
    remaining = [c for c in unique if c["id"] not in seen]
    selected = _fill_pass(selected, seen, remaining, cap)
    report.update({
        "generated": generated,
        "unique": len(unique),
        "selected": len(selected),
        "below_floor": len(selected) < floor,
    })
    return selected, report
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: PASS (18 tests total).

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/testcase_selection.py pipeline/Scripts/tests/test_testcase_selection.py
git commit -m "feat(testcases): fill-to-cap pass and select_suite entrypoint"
```

---

### Task 5: Funnel report formatter + no-regression check

**Files:**
- Modify: `pipeline/Scripts/testcase_selection.py`
- Test: `pipeline/Scripts/tests/test_testcase_selection.py`

**Interfaces:**
- Produces: `format_funnel(report: dict) -> str` → one-line funnel string.

- [ ] **Step 1: Write the failing test**

```python
from testcase_selection import format_funnel

class TestFunnel(unittest.TestCase):
    def test_one_line_summary(self):
        rep = {"generated":250,"unique":231,"selected":150,"edges":9,"tle":4,
               "slots_filled":30,"slots_total":30,"kills_covered":6,"kills_total":6,
               "uncatchable":[],"below_floor":False}
        s = format_funnel(rep)
        self.assertIn("generated 250", s)
        self.assertIn("unique 231", s)
        self.assertIn("selected 150", s)
        self.assertIn("slots 30/30", s)
        self.assertIn("kills 6/6", s)

    def test_flags_uncatchable_and_floor(self):
        rep = {"generated":30,"unique":20,"selected":18,"edges":2,"tle":0,
               "slots_filled":5,"slots_total":6,"kills_covered":4,"kills_total":5,
               "uncatchable":["w5"],"below_floor":True}
        s = format_funnel(rep)
        self.assertIn("BELOW FLOOR", s)
        self.assertIn("uncatchable: w5", s)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: FAIL with `ImportError: cannot import name 'format_funnel'`.

- [ ] **Step 3: Write minimal implementation**

```python
def format_funnel(report):
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
    if report.get("below_floor"):
        flags.append("BELOW FLOOR")
    if flags:
        line += "  [" + "; ".join(flags) + "]"
    return line
```

- [ ] **Step 4: Run full suite + project test command**

Run: `cd pipeline/Scripts && python3 -m unittest tests.test_testcase_selection -v`
Expected: PASS (20 tests).
Run: `npm run test:json`
Expected: existing JSON-prep tests still PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add pipeline/Scripts/testcase_selection.py pipeline/Scripts/tests/test_testcase_selection.py
git commit -m "feat(testcases): funnel report formatter for select step"
```

---

## Self-review (this plan vs spec §2,4,7,10)

- Spec §2 exact-input dedup → Task 2. ✓
- Spec §4 size bucketing from model metric → Task 1. ✓
- Spec §7 selection guarantee pass (edges/TLE/slots/kill-cover) → Task 3; fill-to-cap → Task 4. ✓
- Spec §10 funnel observability → Task 5. ✓
- Cap/floor constants, determinism, stdlib-only → Global Constraints + `test_deterministic`. ✓
- **Not in this plan (later phases, by design):** producing `kills`/`is_tle`/`size_metric` (needs running solutions), the generator script + prompt, step wiring, DB, frontend.

---

## Remaining phases (each its own plan, in order)

1. **Annotation phase** — produce `kills` (run wrong solutions on the pool), `is_tle` (time brute force on large cases), and adapt current `testcases.json` cases into the case-record shape. Consumes Task 4's `select_suite`. Testable with a fake solutions runner.
2. **Generator script + prompt** — restructure `Prompts/testcasesprompt_v4.py` to require `EDGE_CASES` / `SCENARIO_GENERATORS` / `TLE_BUILDERS` and per-case `size_metric` + `MAX_N`. Testable via `test_size_fix_prompt`-style assertions.
3. **Step wiring + DB** — add `select_testcases` step, remove `harden_testcases`, make benchmark one-shot in `pipeline-config.ts`, run route, `pipeline_states.step_statuses`. Testable via lint/build + run-route unit check.
4. **Frontend** — step rows/labels in `StepProgress.tsx`, `PipelineSidePanel.tsx`, `PipelineWaveList.tsx`, `problems/[id]/page.tsx`. Testable via `npm run build` + visual check.
