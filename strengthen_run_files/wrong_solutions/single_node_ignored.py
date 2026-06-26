# WRONG APPROACH: This solution initializes the answer to 0 instead of negative infinity.
# WHY IT FAILS: When all node values are negative, the best path is the single node with
# the least negative value (e.g., -1). But with ans starting at 0, we return 0 instead,
# which is incorrect because paths must be non-empty (at least one node must be included).

class solution:
    def dfs(self, node, values, children):
        if node == -1:
            return 0
        
        left = max(self.dfs(children[node][0], values, children), 0)
        right = max(self.dfs(children[node][1], values, children), 0)
        
        self.ans = max(self.ans, values[node] + left + right)
        return values[node] + max(left, right)

    def computePeakPathValue(self, values, children):
        # Bug: Initializes to 0 instead of float('-inf')
        # Fails when all nodes are negative (should return least negative, not 0)
        self.ans = 0
        self.dfs(0, values, children)
        return self.ans
