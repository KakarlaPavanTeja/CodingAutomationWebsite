----------PRE_USER_CODE_START----------
import sys
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------

sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
input_data = sys.stdin.read().strip().split()
idx = 0
m = int(input_data[idx]); idx += 1
n = int(input_data[idx]); idx += 1
vaultGrid = []
for _ in range(m):
    row = list(map(int, input_data[idx:idx+n]))
    idx += n
    vaultGrid.append(row)
# Input Area End

# Function Call Area Start
result = sol.compileDiagonalLedger(m, n, vaultGrid)
# Function Call Area End

# Output Area Start 
print(result)
# Output Area End

----------POST_USER_CODE_END----------