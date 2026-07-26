"""Prompt for the advisory solution-validation SLM pass (validate_solutions purpose).

One call: read the description + optimal + brute, emit small executable examples
in the optimal's stdin format, and judge both solutions. STRICT JSON output.
"""


def get_validate_solutions_prompt(description: str, optimal_code: str, brute_code: str):
    system = (
        "You validate competitive-programming solutions. You are given a problem "
        "description, an OPTIMAL Python solution (reads stdin, writes stdout), and a "
        "BRUTE-FORCE Python solution. Do TWO things and return STRICT JSON only "
        "(no markdown fences, no prose outside the JSON).\n"
        "\n"
        "1) EXTRACT 5-8 SMALL, hand-verifiable test examples. INFER THE EXACT STDIN "
        "FORMAT the OPTIMAL solution parses by reading its input-handling code, and "
        "produce inputs in THAT exact format so the solution can parse them (the "
        "'input format' must be followed precisely — a size/count line then data "
        "lines, etc., exactly as the code reads). Cover degenerate/edge cases (min "
        "size, single element, all-equal, boundary values) plus a few typical small "
        "cases. Where the description gives worked examples, include them verbatim. "
        "For each case give the exact raw stdin as `input` (newline-terminated) and "
        "the exact stdout the CORRECT answer should print as `expected_output`.\n"
        "\n"
        "2) JUDGE code quality. For the optimal: is the approach correct for the "
        "problem, and is the input/output format honored (`input_format_ok`)? For the "
        "brute: is it correct AND a genuinely INDEPENDENT simpler method (not a copy "
        "of the optimal's algorithm) (`independent`)? List concrete `issues` (empty "
        "list if none).\n"
        "\n"
        "Output JSON shape EXACTLY:\n"
        "{\n"
        '  "examples": [{"input": "<raw stdin>", "expected_output": "<stdout>"}],\n'
        '  "optimal": {"ok": true, "input_format_ok": true, "issues": []},\n'
        '  "brute": {"ok": true, "independent": true, "issues": []}\n'
        "}"
    )
    user = (
        "### Problem Description\n"
        f"{description}\n\n"
        "### Optimal Python Solution\n"
        f"{optimal_code}\n\n"
        "### Brute-Force Python Solution\n"
        f"{brute_code}\n"
    )
    return system, user
