"""Persist a step's quality verdict so something other than a human can act on it.

Every gate here already computed the right answer and then dropped it:
`run_annotation` built a report dict that `__main__` discarded, and `print_report`
worked out pass/fail into a local variable and returned None. The only consumer of
any of it was a person reading stdout, which is why a weak suite and a strong one
look identical to the orchestrator and to the unattended runner in
`scripts/cp-auto-resume.sh`.

One file per step at `<outputs_dir>/gates/<step_id>.json`, written on every path —
pass, fail, and crash. The crash case is the whole point: a gate that could not run
is `error`, never `pass`.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

PASS = "pass"
FAIL = "fail"
ERROR = "error"
VERDICTS = (PASS, FAIL, ERROR)


def gate_path(step_id: str, outputs_dir: str = "Outputs") -> str:
    return os.path.join(outputs_dir, "gates", f"{step_id}.json")


def write_gate(
    step_id: str,
    verdict: str,
    *,
    outputs_dir: str = "Outputs",
    numbers: dict | None = None,
    gates: dict | None = None,
    blocking: list[str] | None = None,
    advisory: list[str] | None = None,
) -> str:
    """Write one step's verdict; return the path.

    `blocking` is what made this a FAIL, in a form a reader can act on without
    parsing log prose. `advisory` is everything worth knowing that did not fail the
    step.

    A write failure is logged, not raised: the verdict the caller is about to act on
    must not turn into a crash because a disk was full.
    """
    if verdict not in VERDICTS:
        raise ValueError(f"verdict must be one of {VERDICTS}, got {verdict!r}")

    payload = {
        "step": step_id,
        "verdict": verdict,
        "written_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "numbers": numbers or {},
        "gates": gates or {},
        "blocking": list(blocking or []),
        "advisory": list(advisory or []),
    }
    path = gate_path(step_id, outputs_dir)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, sort_keys=True, default=str)
    except OSError as e:
        print(f"could not write gate report {path}: {type(e).__name__}: {e}", flush=True)
    return path
