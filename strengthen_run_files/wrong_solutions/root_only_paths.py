# WRONG APPROACH: This solution only updates the answer at the root level, assuming
# the best path must go through the root node.
# WHY IT FAILS: The optimal path can be entirely within a left or right subtree without
# ever touching the root. By only checking at root, we miss these subtree-only paths.

class solution:
    def dfs(self, node, values, children):
        if node == -1:
            return 0
        
        left = max(self.dfs(children[node][0], values, children), 0)
        right = max(self.dfs(children[node][1], values, children), 0)
        
        # Bug: Only update answer at root (node 0), missing paths entirely in subtrees
        if node == 0:
            self.ans = max(self.ans, values[node] + left + right)
        
        return values[node] + max(left, right)

    def computePeakPathValue(self, values, children):
        self.ans = float('-inf')
        self.dfs(0, values, children)
        return self.ans
