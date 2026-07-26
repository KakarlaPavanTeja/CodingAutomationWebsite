"""Known-good IO harness for generated testcase scripts.

testcase_manager_v4 copies this file next to the generated
testcases_generator_script.py, and the generator prompt mandates
`from tc_harness import run_solution` instead of hand-rolling stdin/stdout
capture. Hand-rolled shims were the #1 in-process crash across generations:
readonly `sys.stdout.buffer` assignment, StringIO without `.buffer`,
unrestored streams. This file removes that entire failure class.
"""
import io
import sys


def run_solution(input_str, solution_code):
    """Exec `solution_code` (a source string) with stdin fed from `input_str`;
    return everything it wrote to stdout as a str.

    Supports solutions that read via input(), sys.stdin.read(), or
    sys.stdin.buffer, and write via print(), sys.stdout.write(), or
    sys.stdout.buffer. The code runs fresh in its own single namespace with
    __name__ == "__main__", so both module-level scripts and
    `if __name__ == "__main__":` entry points execute. sys.exit() inside the
    solution ends the run normally.
    """
    stdin = io.TextIOWrapper(io.BytesIO(input_str.encode("utf-8")), encoding="utf-8")
    out_buf = io.BytesIO()
    stdout = io.TextIOWrapper(out_buf, encoding="utf-8", write_through=True)
    old_stdin, old_stdout = sys.stdin, sys.stdout
    sys.stdin, sys.stdout = stdin, stdout
    try:
        env = {"__name__": "__main__"}
        try:
            exec(solution_code, env)
        except SystemExit:
            pass
    finally:
        try:
            stdout.flush()
        except Exception:
            pass
        sys.stdin, sys.stdout = old_stdin, old_stdout
    return out_buf.getvalue().decode("utf-8")


if __name__ == "__main__":
    # Self-check: every stdin/stdout access style the harness must survive.
    out = run_solution(
        "2\n3 4\n",
        "import sys\nprint(sum(map(int, sys.stdin.buffer.read().split()[1:])))",
    )
    assert out.strip() == "7", out
    out = run_solution(
        "abc\n",
        "s = input()\nimport sys\nsys.stdout.buffer.write(s.upper().encode())",
    )
    assert out.strip() == "ABC", out
    out = run_solution(
        "5\n",
        "def main():\n    print(int(input()) * 2)\n\nif __name__ == '__main__':\n    main()\n",
    )
    assert out.strip() == "10", out
    assert sys.stdin is sys.__stdin__ and sys.stdout is sys.__stdout__
    print("tc_harness self-check OK")
