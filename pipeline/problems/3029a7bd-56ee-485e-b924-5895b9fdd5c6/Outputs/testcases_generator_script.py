import io
import json
import sys

TOTAL_WEIGHTAGE = 25
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

stress_count = max(1, int(NUM_TESTCASES * 0.50))
edge_count = max(1, int(NUM_TESTCASES * 0.20))
normal_count = max(1, int(NUM_TESTCASES * 0.15))
example_count = min(2, max(0, NUM_TESTCASES - stress_count - edge_count - normal_count))
corner_count = max(0, NUM_TESTCASES - (stress_count + edge_count + normal_count + example_count))

stress_total = TOTAL_WEIGHTAGE * 0.60
stress_weights = [round(stress_total / stress_count, 2)] * stress_count
remaining_total = TOTAL_WEIGHTAGE - sum(stress_weights)
other_count = example_count + edge_count + normal_count + corner_count
other_weights = [round(remaining_total / other_count, 2)] * other_count if other_count > 0 else []
current_sum = sum(stress_weights) + sum(other_weights)
diff = round(TOTAL_WEIGHTAGE - current_sum, 2)
if other_count > 0:
    other_weights[-1] += diff
elif stress_count > 0:
    stress_weights[-1] += diff

weights = stress_weights[:] + other_weights[:]
assert all(w > 0 for w in weights)
assert abs(sum(weights) - TOTAL_WEIGHTAGE) < 0.01

def run_optimal(input_data):
    prepared_input = input_data if input_data.endswith("\n") else input_data + "\n"
    sol_env = {"__name__": "solution_namespace"}
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = io.StringIO(prepared_input)
    captured = io.StringIO()
    sys.stdout = captured
    try:
        exec(SOLUTION_CODE, sol_env)
        if captured.getvalue() == "" and "main" in sol_env and callable(sol_env["main"]):
            sol_env["main"]()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
    return captured.getvalue().strip()

def build_matrix(m, n, func):
    return [[int(func(i, j)) for j in range(n)] for i in range(m)]

def serialize_matrix(matrix):
    m = len(matrix)
    n = len(matrix[0]) if m > 0 else 0
    lines = [f"{m} {n}"]
    for row in matrix:
        lines.append(" ".join(map(str, row)))
    return "\n".join(lines)

def tweak_matrix(base_matrix, attempts):
    matrix = [row[:] for row in base_matrix]
    if matrix and matrix[0]:
        last_val = matrix[-1][-1]
        shifted = -10000 + ((last_val + 10000 + attempts) % 20001)
        matrix[-1][-1] = shifted
    return matrix

seen_inputs = set()
test_cases = []
order_counter = [1]

def add_case(base_matrix, weightage, testcase_type):
    attempts = 0
    while True:
        attempts += 1
        if attempts > 10000:
            raise RuntimeError("Exceeded attempt limit while generating a unique testcase.")
        matrix = [row[:] for row in base_matrix] if attempts == 1 else tweak_matrix(base_matrix, attempts)
        input_data = serialize_matrix(matrix)
        if input_data not in seen_inputs:
            seen_inputs.add(input_data)
            output_data = run_optimal(input_data)
            test_cases.append({
                "input": input_data,
                "output": output_data,
                "weightage": weightage,
                "order": order_counter[0],
                "testcase_type": testcase_type
            })
            order_counter[0] += 1
            break

example_matrices = [
    [
        [16, -20, 17, 21],
        [25, 23, -14, 26]
    ],
    [
        [18, 24, 31],
        [27, 19, 22],
        [30, 28, 35]
    ]
]
assert len(example_matrices) == example_count

edge_matrices = [
    [[-10000]],
    [[-10000 + (20000 * j) // 99 for j in range(100)]],
    [[10000 - (20000 * i) // 99] for i in range(100)],
    [
        [-10000, 9999],
        [-9999, 10000]
    ]
]
assert len(edge_matrices) == edge_count

corner_matrices = [
    [
        [5, 1, 7, 0],
        [9, -7, 0, 8],
        [14, 0, 8, 50],
        [100, -8, -50, 11]
    ]
]
assert len(corner_matrices) == corner_count

normal_matrices = [
    [
        [5, -3, 8, 8, 1],
        [-2, 7, 0, 4, -6],
        [9, -1, 3, 2, 10],
        [11, -5, -4, 6, 12]
    ],
    [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [-1, -2, -3, -4],
        [8, 8, 8, 8],
        [9, -9, 9, -9],
        [10, 0, -10, 5]
    ],
    build_matrix(5, 7, lambda i, j: ((i * 13 + j * 17 + i * j * 3) % 41) - 20)
]
assert len(normal_matrices) == normal_count

stress_builders = [
    lambda: build_matrix(100, 100, lambda i, j: 10000 if (i + j) % 2 == 0 else -10000),
    lambda: build_matrix(100, 100, lambda i, j: 10000 if i % 2 == 0 else -10000),
    lambda: build_matrix(100, 100, lambda i, j: 10000 if j % 2 == 0 else -10000),
    lambda: build_matrix(100, 100, lambda i, j: -10000 if j == (i * 7) % 100 else 10000),
    lambda: build_matrix(100, 100, lambda i, j: 10000 if (i == j or i + j == 99 or (i - j) % 17 == 0) else -10000),
    lambda: build_matrix(100, 100, lambda i, j: ((i * 911 + j * 353 + i * j * 17) % 20001) - 10000),
    lambda: build_matrix(100, 100, lambda i, j: ((i * 123 + j * 987 + (i + 31) * (j + 7) * 19) % 20001) - 10000),
    lambda: build_matrix(100, 100, lambda i, j: 10000 if (i in (0, 99) or j in (0, 99)) else (-10000 if ((i // 5) + (j // 5)) % 2 == 0 else 9999)),
    lambda: build_matrix(100, 100, lambda i, j: -10000 + (((i * 100 + j) * 37) % 20001)),
    lambda: build_matrix(100, 100, lambda i, j: (9994 if ((i < 50) == (j < 50)) else -9994) + (((i * 29 + j * 31) % 7) - 3))
]
assert len(stress_builders) == stress_count

for matrix in example_matrices:
    add_case(matrix, other_weights.pop(0), "example")

for matrix in edge_matrices:
    add_case(matrix, other_weights.pop(0), "edge")

for matrix in corner_matrices:
    add_case(matrix, other_weights.pop(0), "corner")

for matrix in normal_matrices:
    add_case(matrix, other_weights.pop(0), "normal")

for builder in stress_builders:
    add_case(builder(), stress_weights.pop(0), "stress")

assert len(test_cases) == NUM_TESTCASES
assert len(other_weights) == 0
assert len(stress_weights) == 0
assert [tc["order"] for tc in test_cases] == list(range(1, NUM_TESTCASES + 1))
assert all(tc["weightage"] > 0 for tc in test_cases)
assert all(tc["output"] != "" for tc in test_cases)
expected_key_order = ["input", "output", "weightage", "order", "testcase_type"]
assert all(list(tc.keys()) == expected_key_order for tc in test_cases)

result = [{"test_cases": test_cases}]

with open("testcases.json", "w", encoding="utf-8") as f:
    json.dump(result, f, indent=4, ensure_ascii=False)