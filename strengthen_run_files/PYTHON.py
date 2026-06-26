class solution:
    def dfs(self, node, values, children):
        if node == -1:
            return 0
        left = max(self.dfs(children[node][0], values, children), 0)
        right = max(self.dfs(children[node][1], values, children), 0)
        self.ans = max(self.ans, values[node] + left + right)
        return values[node] + max(left, right)

    def computePeakPathValue(self, values, children):
        self.ans = float('-inf')
        self.dfs(0, values, children)
        return self.ans