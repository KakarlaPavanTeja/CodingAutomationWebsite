----------PRE_USER_CODE_START----------
import sys
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------

sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
n = int(input())
values = list(map(int, input().split()))
required = int(input())
# Input Area End

# Function Call Area Start
result = sol.locatePairPositions(values, required)
# Function Call Area End

# Output Area Start 
if result:
    print(result[0], result[1])
else:
    print(-1)
# Output Area End

----------POST_USER_CODE_END----------