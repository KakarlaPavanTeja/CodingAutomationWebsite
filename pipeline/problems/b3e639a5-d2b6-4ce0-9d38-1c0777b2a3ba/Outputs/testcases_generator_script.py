import io
import json
import sys

TOTAL_WEIGHTAGE = 20
NUM_TESTCASES = 20

SOLUTION_CODE = """from collections import defaultdict

m, n = map(int, input().split())
matrix = []
for _ in range(m):
    matrix.append(list(map(int, input().split())))

diagonals = defaultdict(list)

for r in range(m):
    if r % 2 == 0:
        for c in range(n):
            diagonals[r + c].append(matrix[r][c])
    else:
        for c in range(n - 1, -1, -1):
            diagonals[r + c].append(matrix[r][c])

result = []
for d in sorted(diagonals.keys()):
    group = sorted(diagonals[d])
    size = len(group)
    if size % 2 == 1:
        median = group[size // 2]
        result.append(f"{median:.2f}")
    else:
        avg = sum(group) / size
        result.append(f"{avg:.2f}")

print(' '.join(result))
"""


def run_optimal(input_data):
    backup_stdin = sys.stdin
    backup_stdout = sys.stdout
    sys.stdin = io.StringIO(input_data)
    captured_output = io.StringIO()
    sys.stdout = captured_output
    try:
        sol_env = {"__name__": "solution_namespace"}
        exec(SOLUTION_CODE, sol_env)
    finally:
        sys.stdin = backup_stdin
        sys.stdout = backup_stdout
    return captured_output.getvalue().rstrip("\n")


def build_matrix(m, n, value_fn):
    matrix = []
    for r in range(m):
        row = []
        for c in range(n):
            val = int(value_fn(r, c))
            assert -10000 <= val <= 10000
            row.append(val)
        matrix.append(row)
    return matrix


def matrix_to_input(matrix):
    m = len(matrix)
    n = len(matrix[0]) if m > 0 else 0
    lines = [f"{m} {n}"]
    for row in matrix:
        assert len(row) == n
        lines.append(" ".join(map(str, row)))
    return "\n".join(lines)


def make_fixed_factory(matrix):
    cached_input = matrix_to_input(matrix)
    return lambda attempts, cached_input=cached_input: cached_input


def make_pattern_factory(m, n, value_fn):
    cached_input = matrix_to_input(build_matrix(m, n, value_fn))
    return lambda attempts, cached_input=cached_input: cached_input


def add_case(test_cases, seen_inputs, input_factory, weightage, testcase_type):
    allowed_types = {"example", "edge", "corner", "normal", "stress"}
    assert testcase_type in allowed_types
    attempts = 0
    while True:
        attempts += 1
        if attempts <= 10000:
            input_data = input_factory(attempts)
        else:
            salt = len(test_cases) * 211 + attempts
            v1 = -10000 + (salt % 20001)
            v2 = -10000 + ((salt * 37) % 20001)
            input_data = f"1 2\n{v1} {v2}"
        if input_data not in seen_inputs:
            seen_inputs.add(input_data)
            break
        if attempts > 10100:
            raise RuntimeError("Unable to generate a unique testcase within the attempt limit.")
    output_data = run_optimal(input_data)
    test_cases.append({
        "input": input_data,
        "output": output_data,
        "weightage": round(weightage, 2),
        "order": len(test_cases) + 1,
        "testcase_type": testcase_type
    })


def main():
    stress_count = max(1, int(NUM_TESTCASES * 0.50))
    edge_count = max(1, int(NUM_TESTCASES * 0.20))
    normal_count = max(1, int(NUM_TESTCASES * 0.15))
    example_count = min(2, max(0, NUM_TESTCASES - stress_count - edge_count - normal_count))
    corner_count = max(0, NUM_TESTCASES - (stress_count + edge_count + normal_count + example_count))

    assert stress_count + edge_count + normal_count + example_count + corner_count == NUM_TESTCASES

    stress_total = TOTAL_WEIGHTAGE * 0.60
    stress_weights = [round(stress_total / stress_count, 2)] * stress_count
    remaining_total = TOTAL_WEIGHTAGE - sum(stress_weights)
    other_count = example_count + edge_count + normal_count + corner_count
    other_weights = [round(remaining_total / other_count, 2)] * other_count if other_count > 0 else []
    current_sum = sum(stress_weights) + sum(other_weights)
    diff = round(TOTAL_WEIGHTAGE - current_sum, 2)
    if other_count > 0:
        other_weights[-1] = round(other_weights[-1] + diff, 2)
    elif stress_count > 0:
        stress_weights[-1] = round(stress_weights[-1] + diff, 2)

    if any(w <= 0 for w in stress_weights + other_weights):
        total_cases = len(stress_weights) + len(other_weights)
        uniform_weight = round(TOTAL_WEIGHTAGE / total_cases, 2)
        rebuilt = [uniform_weight] * total_cases
        rebuilt_diff = round(TOTAL_WEIGHTAGE - sum(rebuilt), 2)
        rebuilt[-1] = round(rebuilt[-1] + rebuilt_diff, 2)
        stress_weights = rebuilt[:stress_count]
        other_weights = rebuilt[stress_count:]

    weights = stress_weights[:] + other_weights[:]
    assert all(w > 0 for w in weights)
    assert abs(sum(weights) - TOTAL_WEIGHTAGE) < 0.01

    example_matrices = [
        [
            [12, 18, 20, 24],
            [31, 29, 27, 25]
        ],
        [
            [16, 22, 30],
            [44, 17, 19],
            [28, 26, 32],
            [40, 34, 38]
        ]
    ]

    edge_matrices = [
        [
            [-10000]
        ],
        [
            [-10000 + 200 * i for i in range(100)]
        ],
        [
            [10000 - 200 * i] for i in range(100)
        ],
        [
            [10000, -10000],
            [-9999, 9999]
        ]
    ]

    corner_matrices = [
        [
            [9, -4, 50],
            [1, 100, -7],
            [0, 8, -3]
        ]
    ]

    normal_matrices = [
        [
            [5, -2, 9, 4],
            [8, 7, -6, 3],
            [1, 0, 2, -1]
        ],
        [
            [3, 14, -7, 8, 1],
            [6, -5, 12, 0, 9],
            [11, 4, -2, 13, -6],
            [7, 10, 5, -9, 2],
            [-8, 15, 16, -3, 17]
        ],
        [
            [20, -1, 7, 14, -8, 3],
            [5, 11, -4, 6, 2, -9],
            [13, 0, 19, -7, 8, 1],
            [-2, 17, 4, 10, -5, 12]
        ]
    ]

    def s1(r, c):
        return 10000 if (r + c) % 2 == 0 else -10000

    def s2(r, c):
        if r == 99 and c == 99:
            return 10000
        return -10000 + 2 * (r * 100 + c)

    def s3(r, c):
        if r == 99 and c == 99:
            return -10000
        return 10000 - 2 * (r * 100 + c)

    def s4(r, c):
        if r % 2 == 0:
            return 10000 - 2 * c
        return -10000 + 2 * c

    def s5(r, c):
        if c % 2 == 0:
            return 10000 - 2 * r
        return -10000 + 2 * r

    def s6(r, c):
        if r == 0 and c == 0:
            return 10000
        if r == 99 and c == 99:
            return -10000
        return ((r * 97 + c * 89 + 12345) % 20001) - 10000

    def s7(r, c):
        if r == 99 and c == 0:
            return 10000
        if r == 0 and c == 99:
            return -10000
        return 10000 - (abs(49 - r) + abs(49 - c)) * 200

    def s8(r, c):
        if r == 99 and c == 0:
            return 10000
        if r == 0 and c == 99:
            return -10000
        return (r - c) * 101

    def s9(r, c):
        if r < 50 and c < 50:
            return 10000
        if r < 50 and c >= 50:
            return 5000
        if r >= 50 and c < 50:
            return -5000
        return -10000

    def s10(r, c):
        if r == 0 and c == 0:
            return 10000
        if r == 99 and c == 99:
            return -10000
        return 10000 - ((r * 7 + c * 11) % 201) * 100

    stress_factories = [
        make_pattern_factory(100, 100, s1),
        make_pattern_factory(100, 100, s2),
        make_pattern_factory(100, 100, s3),
        make_pattern_factory(100, 100, s4),
        make_pattern_factory(100, 100, s5),
        make_pattern_factory(100, 100, s6),
        make_pattern_factory(100, 100, s7),
        make_pattern_factory(100, 100, s8),
        make_pattern_factory(100, 100, s9),
        make_pattern_factory(100, 100, s10),
    ]

    example_factories = [make_fixed_factory(matrix) for matrix in example_matrices]
    edge_factories = [make_fixed_factory(matrix) for matrix in edge_matrices]
    corner_factories = [make_fixed_factory(matrix) for matrix in corner_matrices]
    normal_factories = [make_fixed_factory(matrix) for matrix in normal_matrices]

    assert len(example_factories) == example_count
    assert len(edge_factories) == edge_count
    assert len(corner_factories) == corner_count
    assert len(normal_factories) == normal_count
    assert len(stress_factories) == stress_count

    test_cases = []
    seen_inputs = set()

    other_weights_queue = other_weights[:]
    stress_weights_queue = stress_weights[:]

    for factory in example_factories:
        add_case(test_cases, seen_inputs, factory, other_weights_queue.pop(0), "example")

    for factory in edge_factories:
        add_case(test_cases, seen_inputs, factory, other_weights_queue.pop(0), "edge")

    for factory in corner_factories:
        add_case(test_cases, seen_inputs, factory, other_weights_queue.pop(0), "corner")

    for factory in normal_factories:
        add_case(test_cases, seen_inputs, factory, other_weights_queue.pop(0), "normal")

    for factory in stress_factories:
        add_case(test_cases, seen_inputs, factory, stress_weights_queue.pop(0), "stress")

    assert len(other_weights_queue) == 0
    assert len(stress_weights_queue) == 0
    assert len(test_cases) == NUM_TESTCASES
    assert len({case["input"] for case in test_cases}) == NUM_TESTCASES
    assert [case["order"] for case in test_cases] == list(range(1, NUM_TESTCASES + 1))
    assert sum(1 for case in test_cases if case["testcase_type"] == "example") == example_count
    assert sum(1 for case in test_cases if case["testcase_type"] == "edge") == edge_count
    assert sum(1 for case in test_cases if case["testcase_type"] == "corner") == corner_count
    assert sum(1 for case in test_cases if case["testcase_type"] == "normal") == normal_count
    assert sum(1 for case in test_cases if case["testcase_type"] == "stress") == stress_count
    assert all(case["weightage"] > 0 for case in test_cases)
    assert abs(sum(case["weightage"] for case in test_cases) - TOTAL_WEIGHTAGE) < 0.01

    result = [{"test_cases": test_cases}]
    with open("testcases.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    main()