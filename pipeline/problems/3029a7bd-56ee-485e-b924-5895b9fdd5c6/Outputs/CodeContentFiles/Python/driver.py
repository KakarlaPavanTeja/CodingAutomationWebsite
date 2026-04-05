from solution import solution
import time
import sys
import resource

file_path = sys.argv[2]
total_elapsed_time_ns = 0
sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
m, n = map(int, input().split())
vaultGrid = []
for _ in range(m):
    vaultGrid.append(list(map(int, input().split())))
# Input Area End

# Function Call Area Start
start_time_ns = time.perf_counter_ns()
result = sol.compileDiagonalLedger(m, n, vaultGrid)
end_time_ns = time.perf_counter_ns()
# Function Call Area End

# Output Area Start 
print(result)
# Output Area End

# Dont change or modify any lines below this line

total_elapsed_time_ns += end_time_ns - start_time_ns
usage = resource.getrusage(resource.RUSAGE_SELF)
memory_used = usage.ru_maxrss
    
elapsed_time_seconds = total_elapsed_time_ns / 1e9

with open(file_path, 'w') as output_file:
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* {elapsed_time_seconds:.9f}")
    output_file.write("\n")
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* {str(memory_used)}")