import sys


class solution:
    # Brute-force oracle:
    # Try every node as a start of a path, and explore all simple paths starting there.
    # In a tree, avoiding the parent is enough to avoid revisiting nodes.
    def computePeakPathValue(self, values, children):
        n = len(values)
        if n == 0:
            return 0

        adj = [[] for _ in range(n)]
        for i in range(n):
            left, right = children[i]
            if left != -1:
                adj[i].append(left)
                adj[left].append(i)
            if right != -1:
                adj[i].append(right)
                adj[right].append(i)

        sys.setrecursionlimit(10**6)
        best = -10**18

        def dfs(node, parent, current_sum):
            nonlocal best
            current_sum += values[node]
            if current_sum > best:
                best = current_sum

            for nxt in adj[node]:
                if nxt == parent:
                    continue
                dfs(nxt, node, current_sum)

        for start in range(n):
            dfs(start, -1, 0)

        return best