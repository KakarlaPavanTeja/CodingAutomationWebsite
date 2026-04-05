----------PRE_USER_CODE_START----------
import sys
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
data = sys.stdin.read().strip().split()
idx = 0
m = int(data[idx]); idx += 1
n = int(data[idx]); idx += 1
gridData = []
for _ in range(m):
    row = list(map(int, data[idx:idx+n]))
    idx += n
    gridData.append(row)
# Input Area End

# Function Call Area Start
result = sol.summarizeDiagonalEchoes(gridData)
# Function Call Area End

# Output Area Start 
print(result)
# Output Area End

----------POST_USER_CODE_END----------