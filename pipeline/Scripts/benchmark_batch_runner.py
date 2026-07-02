#!/usr/bin/env python3
"""Run one solution file against many stdin inputs in a single Python process."""
from __future__ import annotations

import io
import json
import signal
import sys
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO


class InputTimeout(Exception):
    pass


def _on_alarm(_signum, _frame) -> None:
    raise InputTimeout()


def _fake_stdin(inp: str) -> io.TextIOWrapper:
    """A stand-in for sys.stdin that, like the real one, exposes a binary
    `.buffer`. A plain StringIO does NOT, so solutions that read bytes via
    `sys.stdin.buffer.read()` would raise AttributeError and be misreported as
    a crashing (buggy) solution. Wrapping BytesIO in a TextIOWrapper supports
    both `input()`/`sys.stdin.read()` and `sys.stdin.buffer.read()`."""
    return io.TextIOWrapper(io.BytesIO(inp.encode("utf-8")), encoding="utf-8")


def run_one(code: str, inp: str, timeout_sec: int) -> tuple[str, str]:
    signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(max(1, timeout_sec))
    out_buf = StringIO()
    err_buf = StringIO()
    old_stdin = sys.stdin
    try:
        sys.stdin = _fake_stdin(inp)
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            exec(compile(code, "<solution>", "exec"), {"__name__": "__main__"})
        signal.alarm(0)
        return out_buf.getvalue(), "ok"
    except InputTimeout:
        signal.alarm(0)
        return "", "timeout"
    except SystemExit as exc:
        signal.alarm(0)
        out = out_buf.getvalue()
        code = exc.code
        if code is None or code == 0:
            return out, "ok"
        return (out or err_buf.getvalue()), "error"
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
