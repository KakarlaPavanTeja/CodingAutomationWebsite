def two_sum(nums, target):
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