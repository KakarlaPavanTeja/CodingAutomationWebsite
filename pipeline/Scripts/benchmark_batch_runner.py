#!/usr/bin/env python3
"""Run one solution file against many stdin inputs in a single Python process."""
from __future__ import annotations

import json
import signal
import sys
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO


class InputTimeout(Exception):
    pass


def _on_alarm(_signum, _frame) -> None:
    raise InputTimeout()


def run_one(code: str, inp: str, timeout_sec: int) -> tuple[str, str]:
    signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(max(1, timeout_sec))
    out_buf = StringIO()
    err_buf = StringIO()
    old_stdin = sys.stdin
    try:
        sys.stdin = StringIO(inp)
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            exec(compile(code, "<solution>", "exec"), {"__name__": "__main__"})
        signal.alarm(0)
        err = err_buf.getvalue()
        out = out_buf.getvalue()
        if err.strip() and not out.strip():
            return err, "error"
        return out, "ok"
    except InputTimeout:
        signal.alarm(0)
        return "", "timeout"
    except Exception:
        signal.alarm(0)
        return (out_buf.getvalue() or err_buf.getvalue()), "error"
    finally:
        sys.stdin = old_stdin


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: benchmark_batch_runner.py <code.py> [timeout_sec]", file=sys.stderr)
        sys.exit(2)
    timeout_sec = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    code = open(sys.argv[1], encoding="utf-8").read()
    inputs = json.load(sys.stdin)
    results = []
    for inp in inputs:
        out, status = run_one(code, inp, timeout_sec)
        results.append({"out": out, "status": status})
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
