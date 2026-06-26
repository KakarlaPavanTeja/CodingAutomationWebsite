# WRONG APPROACH: This solution greedily follows the path with maximum child values
# starting from root, assuming the best path must go through the root and extend downward.
# WHY IT FAILS: The optimal path might not include the root at all (e.g., it could be
# entirely in a subtree). Also, it only considers one path downward rather than exploring
# all possible paths including those that go through a node connecting left and right subtrees.

class solution:
    def computePeakPathValue(self, values, children):
        if not values:
            return 0
        
        # Start from root and greedily pick maximum path downward
        max_sum = values[0]
        current = 0
        current_sum = values[0]
        
        while True:
            left_child = children[current][0]
            right_child = children[current][1]
            
            # Bug: Only considers going down one path, not combining left+right through current node
            if left_child == -1 and right_child == -1:
                break
            
            left_val = values[left_child] if left_child != -1 else float('-inf')
            right_val = values[right_child] if right_child != -1 else float('-inf')
            
            # Bug: Greedily picks the larger child, missing better paths in the other subtree
            if left_val > right_val and left_child != -1:
                current = left_child
                current_sum += left_val
            elif right_child != -1:
                current = right_child
                current_sum += right_val
            else:
                break
            
            max_sum = max(max_sum, current_sum)
        
        return max_sum
