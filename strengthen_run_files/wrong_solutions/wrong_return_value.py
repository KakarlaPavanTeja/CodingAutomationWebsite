# WRONG APPROACH: When returning the maximum path ending at current node to parent,
# this solution incorrectly returns values[node] + left + right instead of values[node] + max(left, right).
# WHY IT FAILS: A path to a parent can only extend through ONE child (left OR right), not both.
# Returning both creates an invalid path that branches, which violates the path definition.

class solution:
    def dfs(self, node, values, children):
        if node == -1:
            return 0
        
        left = max(self.dfs(children[node][0], values, children), 0)
        right = max(self.dfs(children[node][1], values, children), 0)
        
        self.ans = max(self.ans, values[node] + left + right)
        
        # Bug: Returns sum of BOTH children instead of max of ONE child
        # This creates invalid branching paths when propagated to parent
        return values[node] + left + right

    def computePeakPathValue(self, values, children):
        self.ans = float('-inf')
        self.dfs(0, values, children)
        return self.ans
