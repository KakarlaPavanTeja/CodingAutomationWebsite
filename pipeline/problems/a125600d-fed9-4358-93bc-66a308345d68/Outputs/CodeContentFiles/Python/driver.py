from solution import solution
import time
import sys
import resource

file_path = sys.argv[2]
total_elapsed_time_ns = 0
sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
n = int(input())
values = list(map(int, input().split()))
required = int(input())
# Input Area End

# Function Call Area Start
start_time_ns = time.perf_counter_ns()
result = sol.locatePairPositions(values, required)
end_time_ns = time.perf_counter_ns()
# Function Call Area End

# Output Area Start 
if result:
    print(result[0], result[1])
else:
    print(-1)
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
