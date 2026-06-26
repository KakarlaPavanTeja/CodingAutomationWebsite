# WRONG APPROACH: This solution computes paths through each node but fails to handle
# negative contributions properly by not using max(0, child_sum) to exclude negative paths.
# WHY IT FAILS: When a subtree has negative sum, we should ignore it (contribute 0), but
# this solution always adds the child contributions even when negative, reducing the total.

class solution:
    def dfs(self, node, values, children):
        if node == -1:
            return 0
        
        # Bug: Missing max(0, ...) to ignore negative subtree contributions
        left = self.dfs(children[node][0], values, children)
        right = self.dfs(children[node][1], values, children)
        
        # Bug: This always includes left and right even if they are negative
        self.ans = max(self.ans, values[node] + left + right)
        
        # Bug: This can return a negative value that pollutes parent calculations
        return values[node] + max(left, right)

    def computePeakPathValue(self, values, children):
        self.ans = float('-inf')
        self.dfs(0, values, children)
        return self.ans
