import json
import io
import sys

TOTAL_WEIGHTAGE = 25
NUM_TESTCASES = 10

SOLUTION_CODE = """def two_sum(nums, target):
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
"""

sol_env = {"__name__": "solution_namespace"}
exec(SOLUTION_CODE, sol_env)


def run_optimal(input_data):
    original_stdin = sys.stdin
    original_stdout = sys.stdout
    sys.stdin = io.StringIO(input_data)
    captured_output = io.StringIO()
    sys.stdout = captured_output
    try:
        sol_env["main"]()
    finally:
        sys.stdin = original_stdin
        sys.stdout = original_stdout
    return captured_output.getvalue().strip()


def format_input(nums, target):
    assert 2 <= len(nums) <= 10**4
    assert all(-10**9 <= x <= 10**9 for x in nums)
    assert -10**9 <= target <= 10**9
    return f"{len(nums)}\n{' '.join(map(str, nums))}\n{target}"


def redistribute_if_needed(stress_weights, other_weights):
    combined = stress_weights[:] + other_weights[:]
    if combined and any(w <= 0 for w in combined):
        count = len(combined)
        even_weight = round(TOTAL_WEIGHTAGE / count, 2)
        combined = [even_weight] * count
        diff = round(TOTAL_WEIGHTAGE - sum(combined), 2)
        combined[-1] += diff
    return combined[:len(stress_weights)], combined[len(stress_weights):]


def fallback_input(order, attempts):
    a = min(10**9 - 1, order * 100000 + attempts)
    nums = [a, -a, order]
    return format_input(nums, 0)


def add_case(test_cases, seen_inputs, candidate_func, weightage, order, testcase_type):
    attempts = 0
    while True:
        attempts += 1
        if attempts <= 10000:
            input_data = candidate_func(attempts)
        else:
            input_data = fallback_input(order, attempts)

        if input_data not in seen_inputs:
            seen_inputs.add(input_data)
            output_data = run_optimal(input_data)
            test_cases.append({
                "input": input_data,
                "output": output_data,
                "weightage": round(float(weightage), 2),
                "order": order,
                "testcase_type": testcase_type
            })
            break

        if attempts > 20000:
            raise RuntimeError("Unable to generate a unique testcase after many attempts.")


def constant_candidate(input_data):
    return lambda attempts, data=input_data: data


def generate_testcases_file():
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

    stress_weights, other_weights = redistribute_if_needed(stress_weights, other_weights)

    weights = stress_weights[:] + other_weights[:]
    assert all(w > 0 for w in weights)
    assert abs(sum(weights) - TOTAL_WEIGHTAGE) < 0.01

    example_inputs = [
        format_input([14, -2, 9, 5, 11, 7], 16),
        format_input([4, 12, -1, 8, 3], 25),
    ]

    edge_inputs = [
        format_input([-1000000000, 1000000000], 0),
        format_input([5, 5], 10),
    ]

    normal_inputs = [
        format_input([8, -3, 4, 7, 7, 2, -5, 11, 0, 6], 14),
    ]

    stress_inputs = [
        format_input([1000000000] + list(range(1, 9999)) + [-1000000000], 0),
        format_input([1000000000] + list(range(2, 19996, 2)) + [-500000000, -500000000], -1000000000),
        format_input([1000000000] * 9997 + [2, 1, 0], 2),
        format_input([-1000000000] * 9996 + [2, 5, 3, -1], 1),
        format_input([1000000000 if i % 2 == 0 else 999999999 for i in range(10000)], -1),
    ]

    assert example_count == 2
    assert len(example_inputs) == example_count
    assert len(edge_inputs) == edge_count
    assert len(normal_inputs) == normal_count
    assert len(stress_inputs) == stress_count
    assert corner_count == 0

    example_generators = [constant_candidate(x) for x in example_inputs]
    edge_generators = [constant_candidate(x) for x in edge_inputs]
    corner_generators = []
    normal_generators = [constant_candidate(x) for x in normal_inputs]
    stress_generators = [constant_candidate(x) for x in stress_inputs]

    test_cases = []
    seen_inputs = set()
    order = 1

    for generator in example_generators:
        add_case(test_cases, seen_inputs, generator, other_weights.pop(0), order, "example")
        order += 1

    for generator in edge_generators:
        add_case(test_cases, seen_inputs, generator, other_weights.pop(0), order, "edge")
        order += 1

    for generator in corner_generators:
        add_case(test_cases, seen_inputs, generator, other_weights.pop(0), order, "corner")
        order += 1

    for generator in normal_generators:
        add_case(test_cases, seen_inputs, generator, other_weights.pop(0), order, "normal")
        order += 1

    for generator in stress_generators:
        add_case(test_cases, seen_inputs, generator, stress_weights.pop(0), order, "stress")
        order += 1

    assert len(test_cases) == NUM_TESTCASES
    assert len(seen_inputs) == NUM_TESTCASES
    assert [tc["order"] for tc in test_cases] == list(range(1, NUM_TESTCASES + 1))
    assert all(list(tc.keys()) == ["input", "output", "weightage", "order", "testcase_type"] for tc in test_cases)
    assert abs(sum(tc["weightage"] for tc in test_cases) - TOTAL_WEIGHTAGE) < 0.01

    non_example_cases = [tc for tc in test_cases if tc["testcase_type"] != "example"]
    meaningful_non_example = sum(1 for tc in non_example_cases if tc["output"] != "-1")
    assert meaningful_non_example >= 7

    result = [{"test_cases": test_cases}]
    assert isinstance(result, list) and len(result) == 1
    assert list(result[0].keys()) == ["test_cases"]

    with open("testcases.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    generate_testcases_file()