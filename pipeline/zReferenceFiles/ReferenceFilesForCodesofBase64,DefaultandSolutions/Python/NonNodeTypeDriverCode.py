from solution import solution
import time
import sys
import resource

# Standard setup for script execution
file_path = sys.argv[2]
total_elapsed_time_ns = 0
sol = solution()

# --- Input Area Start ---
# Reading all at once is the fastest way to handle large datasets in Python
input_data = sys.stdin.read().split()

if input_data:
    numAPIs = int(input_data[0])
    # Slice the list to get runtimes and map them to integers
    runtimes = list(map(int, input_data[1 : 1 + numAPIs]))
    numApps = int(input_data[1 + numAPIs])
# --- Input Area End ---

# --- Function Call Area Start ---
start_time_ns = time.perf_counter_ns()
result = sol.findMaxMinRuntime(numAPIs, runtimes, numApps)
end_time_ns = time.perf_counter_ns()
# --- Function Call Area End ---

# --- Output Area Start ---
# Using sys.stdout.write is faster than print() for large outputs, 
# though for a single 'result', print is sufficient.
sys.stdout.write(str(result) + '\n')
# --- Output Area End ---

# Final calculations and resource logging
total_elapsed_time_ns += end_time_ns - start_time_ns
usage = resource.getrusage(resource.RUSAGE_SELF)
memory_used = usage.ru_maxrss
    
elapsed_time_seconds = total_elapsed_time_ns / 1e9

with open(file_path, 'w') as output_file:
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* {elapsed_time_seconds:.9f}")
    output_file.write("\n")
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* {str(memory_used)}")