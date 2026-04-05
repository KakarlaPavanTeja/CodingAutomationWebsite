import json
import io
import sys
import contextlib

TOTAL_WEIGHTAGE = 25
NUM_TESTCASES = 10

SOLUTION_CODE = '''def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []


def main():
    n = int(input())
    nums = list(map(int, input().split()))
    target = int(input())

    result = two_sum(nums, target)

    if result:
        print(result[0], result[1])
    else:
        print(-1)


if __name__ == "__main__":
    main()
'''

sol_env = {"__name__": "solution_namespace"}
exec(SOLUTION_CODE, sol_env)

MIN_N = 2
MAX_N = 10**4
MIN_VAL = -10**9
MAX_VAL = 10**9
MAX_ATTEMPTS = 10000

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
    other_weights[-1] = round(other_weights[-1] + diff, 2)
elif stress_count > 0:
    stress_weights[-1] = round(stress_weights[-1] + diff, 2)

weights = stress_weights[:] + other_weights[:]
if any(w <= 0 for w in weights):
    positive_floor = 0.01
    weights = [max(positive_floor, round(w, 2)) for w in weights]
    adjustment = round(TOTAL_WEIGHTAGE - sum(weights), 2)
    weights[-1] = round(weights[-1] + adjustment, 2)
    if weights[-1] <= 0:
        raise ValueError("Unable to redistribute weights to keep all positive.")
    stress_weights = weights[:stress_count]
    other_weights = weights[stress_count:]
    weights = stress_weights[:] + other_weights[:]

assert all(w > 0 for w in weights)
assert abs(sum(weights) - TOTAL_WEIGHTAGE) < 0.01


def run_optimal(input_data: str) -> str:
    old_stdin = sys.stdin
    captured = io.StringIO()
    try:
        sys.stdin = io.StringIO(input_data)
        with contextlib.redirect_stdout(captured):
            sol_env["main"]()
    finally:
        sys.stdin = old_stdin
    return captured.getvalue().strip()


def format_input(nums, goal):
    return f"{len(nums)}\n{' '.join(map(str, nums))}\n{goal}"


def validate_constraints(nums, goal):
    assert MIN_N <= len(nums) <= MAX_N
    assert MIN_VAL <= goal <= MAX_VAL
    assert len(nums) >= 2
    for value in nums:
        assert MIN_VAL <= value <= MAX_VAL


def count_index_pairs(nums, target, stop_after=2):
    freq = {}
    for value in nums:
        freq[value] = freq.get(value, 0) + 1

    count = 0
    visited = set()
    for value in freq:
        if value in visited:
            continue
        complement = target - value
        if complement not in freq:
            visited.add(value)
            continue

        if complement == value:
            count += freq[value] * (freq[value] - 1) // 2
        elif complement not in visited:
            count += freq[value] * freq[complement]

        visited.add(value)
        visited.add(complement)

        if count >= stop_after:
            return count
    return count


def validate_solution_output(nums, goal, output):
    if output == "-1":
        assert count_index_pairs(nums, goal, stop_after=1) == 0
    else:
        parts = output.split()
        assert len(parts) == 2
        i, j = map(int, parts)
        assert 0 <= i < len(nums)
        assert 0 <= j < len(nums)
        assert i != j
        assert nums[i] + nums[j] == goal


def build_fallback_case(attempts, required_pair_count, testcase_type):
    type_offset = {
        "example": 1,
        "edge": 2,
        "corner": 3,
        "normal": 4,
        "stress": 5,
    }.get(testcase_type, 0)
    base = 100000 + attempts * 10 + type_offset

    if required_pair_count == 0:
        nums = [base, base + 2]
        goal = -(base + 1)
    else:
        nums = [-base, base]
        goal = 0

    return nums, goal


def build_example1(attempts):
    return [8, 13, 4, 21, 6, 15], 19


def build_example2(attempts):
    return [10, 3, 17, 8, 1], 50


def build_edge1(attempts):
    return [0, 0], 0


def build_edge2(attempts):
    return [1000000000, -1000000000], 1000000000


def build_normal1(attempts):
    return [-4, -11, 12, -20, -1, -7, 25, -30], 37


def build_stress1(attempts):
    nums = [-1000000000] + list(range(1, 9999)) + [1000000000]
    return nums, 0


def build_stress2(attempts):
    nums = list(range(-1, -5000, -1)) + [0] + list(range(-5000, -9999, -1)) + [1000000000]
    return nums, 1000000000


def build_stress3(attempts):
    nums = list(range(1, 4001)) + [0] + list(range(4001, 9999)) + [-1000000000]
    return nums, -1000000000


def build_stress4(attempts):
    nums = list(range(1, 1235)) + [-1] + list(range(1235, 9999)) + [-999999999]
    return nums, -1000000000


def build_stress5(attempts):
    nums = list(range(-1, -5679, -1)) + [999999999] + list(range(-5679, -9999, -1)) + [1]
    return nums, 1000000000


def main():
    seen_inputs = set()
    test_cases = []

    def add_case(builder_fn, weight, testcase_type, required_pair_count=None, expected_output=None):
        attempts = 0
        while True:
            attempts += 1
            if attempts > MAX_ATTEMPTS + 1000:
                raise RuntimeError("Unable to generate a unique testcase within the hard attempt limit.")

            if attempts > MAX_ATTEMPTS:
                nums, goal = build_fallback_case(attempts, required_pair_count, testcase_type)
            else:
                nums, goal = builder_fn(attempts)

            validate_constraints(nums, goal)

            if required_pair_count is not None:
                actual_pairs = count_index_pairs(nums, goal, stop_after=2)
                assert actual_pairs == required_pair_count

            input_data = format_input(nums, goal)

            if input_data not in seen_inputs:
                seen_inputs.add(input_data)
                output_data = run_optimal(input_data)
                validate_solution_output(nums, goal, output_data)

                if expected_output is not None:
                    assert output_data == expected_output

                test_cases.append({
                    "input": input_data,
                    "output": output_data,
                    "weightage": weight,
                    "order": len(test_cases) + 1,
                    "testcase_type": testcase_type
                })
                break

    example_specs = [
        (build_example1, None, "1 4"),
        (build_example2, None, "-1"),
    ]
    edge_specs = [
        (build_edge1, 1, None),
        (build_edge2, 0, None),
    ]
    corner_specs = []
    normal_specs = [
        (build_normal1, 1, None),
    ]
    stress_specs = [
        (build_stress1, 1, None),
        (build_stress2, 1, None),
        (build_stress3, 1, None),
        (build_stress4, 1, None),
        (build_stress5, 1, None),
    ]

    assert len(example_specs) >= example_count
    assert len(edge_specs) >= edge_count
    assert len(corner_specs) >= corner_count
    assert len(normal_specs) >= normal_count
    assert len(stress_specs) >= stress_count

    for i in range(example_count):
        builder_fn, required_pair_count, expected_output = example_specs[i]
        add_case(builder_fn, other_weights.pop(0), "example", required_pair_count, expected_output)

    for i in range(edge_count):
        builder_fn, required_pair_count, expected_output = edge_specs[i]
        add_case(builder_fn, other_weights.pop(0), "edge", required_pair_count, expected_output)

    for i in range(corner_count):
        builder_fn, required_pair_count, expected_output = corner_specs[i]
        add_case(builder_fn, other_weights.pop(0), "corner", required_pair_count, expected_output)

    for i in range(normal_count):
        builder_fn, required_pair_count, expected_output = normal_specs[i]
        add_case(builder_fn, other_weights.pop(0), "normal", required_pair_count, expected_output)

    for i in range(stress_count):
        builder_fn, required_pair_count, expected_output = stress_specs[i]
        add_case(builder_fn, stress_weights.pop(0), "stress", required_pair_count, expected_output)

    assert len(test_cases) == NUM_TESTCASES
    assert len(seen_inputs) == NUM_TESTCASES
    assert [case["order"] for case in test_cases] == list(range(1, NUM_TESTCASES + 1))

    result = [
        {
            "test_cases": test_cases
        }
    ]

    with open("testcases.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    main()