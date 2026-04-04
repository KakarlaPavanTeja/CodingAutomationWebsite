from collections import defaultdict

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