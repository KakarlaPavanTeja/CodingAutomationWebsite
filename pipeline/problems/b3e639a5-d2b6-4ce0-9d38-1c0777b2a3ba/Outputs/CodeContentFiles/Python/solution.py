from collections import defaultdict

class solution:
    def summarizeDiagonalEchoes(self, gridData):
        m = len(gridData)
        if m == 0:
            return ""
        n = len(gridData[0])

        diagonals = defaultdict(list)

        for r in range(m):
            if r % 2 == 0:
                for c in range(n):
                    diagonals[r + c].append(gridData[r][c])
            else:
                for c in range(n - 1, -1, -1):
                    diagonals[r + c].append(gridData[r][c])

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

        return ' '.join(result)
