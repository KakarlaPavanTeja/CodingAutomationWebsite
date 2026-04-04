----------PRE_USER_CODE_START----------
import sys
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
input = sys.stdin.read
data = input().split()
n = int(data[0])
target = int(data[1])
nums = list(map(int, data[2:]))
# Input Area End

# Function Call Area Start
result = sol.twoSum(n, nums, target)
# Function Call Area End

# Output Area Start 
if result:
    print(result[0], result[1])
else:
    print(-1)
# Output Area End

----------POST_USER_CODE_END----------
