import json
import io
import sys

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

sol_env = { "__name__": "solution_namespace" }
exec(SOLUTION_CODE, sol_env)


def run_optimal(input_data):
    original_stdin = sys.stdin
    original_stdout = sys.stdout
    try:
        sys.stdin = io.StringIO(input_data)
        captured_output = io.StringIO()
        sys.stdout = captured_output
        sol_env["main"]()
        return captured_output.getvalue().rstrip("\n")
    finally:
        sys.stdin = original_stdin
        sys.stdout = original_stdout


def build_input(nums, target):
    return f"{len(nums)}\n{' '.join(map(str, nums))}\n{target}"


def generate_example_1(attempt):
    nums = [10, 14, 1, 5, 8]
    target = 19
    return build_input(nums, target)


def generate_example_2(attempt):
    nums = [12, -5, 8, 1, 14, 20]
    target = 40
    return build_input(nums, target)


def generate_edge_1(attempt):
    if attempt == 1:
        nums = [0, 0]
        target = 0
    else:
        val = attempt - 1
        nums = [val, -val]
        target = 0
    return build_input(nums, target)


def generate_edge_2(attempt):
    if attempt == 1:
        nums = [1000000000, -1000000000]
        target = 5
    else:
        a = 1000000000 - attempt
        b = -1000000000 + attempt
        nums = [a, b]
        target = 5
    return build_input(nums, target)


def generate_normal_1(attempt):
    nums = [13 + (attempt - 1), -4, 7, 2, 9, 5, -1, 6]
    target = 8
    return build_input(nums, target)


def generate_stress_1(attempt):
    offset = attempt - 1
    nums = list(range(1 + offset, 9999 + offset)) + [500000000, 500000000]
    target = 1000000000
    return build_input(nums, target)


def generate_stress_2(attempt):
    offset = attempt - 1
    nums = list(range(2 + offset, 9999 + offset)) + [-1000000000, 1000000000, 0]
    target = -1000000000
    return build_input(nums, target)


def generate_stress_3(attempt):
    special = 123456789 + attempt
    nums = [1000000000] * 5000 + [-1000000000] * 4998 + [special, -special]
    target = 0
    return build_input(nums, target)


def generate_stress_4(attempt):
    fill = 7 + attempt
    nums = [fill] * 10000
    nums[1234] = 1000000000
    nums[9876] = -999999999
    target = 1
    return build_input(nums, target)


def generate_stress_5(attempt):
    fill = 13 + attempt
    nums = [500000000] + [fill] * 9998 + [500000000]
    target = 1000000000
    return build_input(nums, target)


def fix_weights_if_needed(stress_weights, other_weights):
    combined = stress_weights + other_weights
    if combined and any(w <= 0 for w in combined):
        total_count = len(combined)
        base = round(TOTAL_WEIGHTAGE / total_count, 2)
        combined = [base] * total_count
        diff = round(TOTAL_WEIGHTAGE - sum(combined), 2)
        combined[-1] = round(combined[-1] + diff, 2)
        if any(w <= 0 for w in combined):
            min_positive = 0.01
            combined = [min_positive] * total_count
            combined[-1] = round(TOTAL_WEIGHTAGE - min_positive * (total_count - 1), 2)
        stress_weights = combined[:len(stress_weights)]
        other_weights = combined[len(stress_weights):]
    return stress_weights, other_weights


def main():
    stress_count = max(1, int(NUM_TESTCASES * 0.50))
    edge_count = max(1, int(NUM_TESTCASES * 0.20))
    normal_count = max(1, int(NUM_TESTCASES * 0.15))
    example_count = min(2, max(0, NUM_TESTCASES - stress_count - edge_count - normal_count))
    corner_count = max(0, NUM_TESTCASES - (stress_count + edge_count + normal_count + example_count))

    assert stress_count + edge_count + normal_count + example_count + corner_count == NUM_TESTCASES
    assert example_count == 2

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

    stress_weights, other_weights = fix_weights_if_needed(stress_weights, other_weights)

    weights = stress_weights[:] + other_weights[:]
    assert all(w > 0 for w in weights)
    assert abs(sum(weights) - TOTAL_WEIGHTAGE) < 0.01

    example_generators = [generate_example_1, generate_example_2]
    edge_generators = [generate_edge_1, generate_edge_2]
    corner_generators = []
    normal_generators = [generate_normal_1]
    stress_generators = [
        generate_stress_1,
        generate_stress_2,
        generate_stress_3,
        generate_stress_4,
        generate_stress_5,
    ]

    assert len(example_generators) >= example_count
    assert len(edge_generators) >= edge_count
    assert len(corner_generators) >= corner_count
    assert len(normal_generators) >= normal_count
    assert len(stress_generators) >= stress_count

    test_cases = []
    seen_inputs = set()

    def add_case(generator, weightage, testcase_type):
        attempts = 0
        while True:
            attempts += 1
            if attempts > 10000:
                raise RuntimeError(f"Failed to generate unique {testcase_type} testcase after 10000 attempts")
            input_data = generator(attempts)
            if input_data not in seen_inputs:
                seen_inputs.add(input_data)
                output_data = run_optimal(input_data)
                test_cases.append({
                    "input": input_data,
                    "output": output_data,
                    "weightage": weightage,
                    "order": len(test_cases) + 1,
                    "testcase_type": testcase_type
                })
                break

    for i in range(example_count):
        add_case(example_generators[i], other_weights.pop(0), "example")

    for i in range(edge_count):
        add_case(edge_generators[i], other_weights.pop(0), "edge")

    for i in range(corner_count):
        add_case(corner_generators[i], other_weights.pop(0), "corner")

    for i in range(normal_count):
        add_case(normal_generators[i], other_weights.pop(0), "normal")

    for i in range(stress_count):
        add_case(stress_generators[i], stress_weights.pop(0), "stress")

    assert len(test_cases) == NUM_TESTCASES
    assert len(seen_inputs) == NUM_TESTCASES
    assert len(other_weights) == 0
    assert len(stress_weights) == 0
    assert all(test_cases[i]["order"] == i + 1 for i in range(NUM_TESTCASES))

    result = [
        {
            "test_cases": test_cases
        }
    ]

    with open("testcases.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    main()