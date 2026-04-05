----------QUESTION_DESCRIPTION_START----------
At the storm-worn Observatory of Aurin, a vault wall holds a sequence of meteor shard readings in the exact order they were cataloged after a lunar crash.

Chief astronomer Meira can trigger the beacon only if two distinct shards resonate to a precise required value when their readings are combined.

Because the vault log uses the original placement order, she needs the zero-based positions of the chosen shards rather than the readings themselves.

If no valid pairing exists, the beacon stays dark and the outcome must be `-1`.

**Example 1:**

**Input:**

```
6
14 -2 9 5 11 7
16
```

**Output:**

```
3 4
```

**Explanation:**

- The readings at positions `3` and `4` are `5` and `11`, and their combined value is `16`.

**Example 2:**

**Input:**

```
5
4 12 -1 8 3
25
```

**Output:**

```
-1
```

**Explanation:**

- No two distinct readings in the sequence combine to `25`, so the failure marker `-1` is produced.

**Your Task**

- Complete the provided `locatePairPositions` function that takes `values` and `required`, and returns a list containing the two zero-based positions of a valid pair. If no valid pair exists, return an empty list `[]`.

**Constraints**

- `2 ≤ n ≤ 10^4`

- `−10^9 ≤ each value in the sequence ≤ 10^9`

- `−10^9 ≤ required ≤ 10^9`

- The two reported positions, if they exist, must be distinct and are counted from `0`.

**Input Format**

- The first line contains `n`, the number of values in the sequence.

- The second line contains `n` space-separated integers representing the sequence values.

- The third line contains `required`, the desired combined value.

**Output Format**

The output is a single line:

- The final result is printed to the standard output.

- The output contains two space-separated integers representing the zero-based positions of a valid pair when such a pair exists.

- The output contains `-1` if no such pair exists; this program does not produce an empty string `""` for the no-result case.
----------QUESTION_DESCRIPTION_END----------

----------SHORT_TEXT_START----------
Target Pair Indices
----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------
MEDIUM
----------QUESTION_LEVEL_END----------

----------CODE_CONTENT_CPP_START----------
#include <bits/stdc++.h>
using namespace std;

class solution {
    public:
    vector<int> locatePairPositions(vector<int>& values, int required) {
        // Write your code here...
        
    }
};
----------CODE_CONTENT_CPP_END----------

----------CODE_CONTENT_PYTHON_START----------
class solution:
    def locatePairPositions(self, values, required):
        # Write your code here...
        pass
----------CODE_CONTENT_PYTHON_END----------

----------CODE_CONTENT_JAVA_START----------
import java.util.*;

public class Solution {
    public List<Integer> locatePairPositions(int[] values, int required) {
        //Write your code here...
        
    }
}
----------CODE_CONTENT_JAVA_END----------

----------CODE_CONTENT_NODE_JS_START----------
class Solution {
    static locatePairPositions(values, required) {
        //Write your code here...
        
    }
}
----------CODE_CONTENT_NODE_JS_END----------

----------CODE_BASE64_CPP_START----------
#include <bits/stdc++.h>
#include <fstream>
#include <cstdlib>
#include <ctime>
#include <chrono>
#include <iomanip>
#include <sys/resource.h>
/* IF IT IS A BINARY TREE OR LINKED LIST PROBLEM, YOU MUST INCLUDE #include "node.h" HERE. OTHERWISE DO NOT. */
using namespace std;
using namespace std::chrono;
#include "solution.cpp"
// [INSERT ANY EXTRA HELPER FUNCTIONS PARSED FROM SOURCE HERE E.g. buildTree, linkedListToList]

long getPeakRSS() {
    struct rusage rusage;
    getrusage(RUSAGE_SELF, &rusage);
    return rusage.ru_maxrss; // Return peak memory usage in kilobytes
}



int main(int argc, char* argv[]) {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    solution sol;
    auto total_duration = 0ns;

    // Dont change or modify any lines before this point
    
    // Input Area Start
    int n;
    cin >> n;
    vector<int> values(n);
    for (int i = 0; i < n; i++) cin >> values[i];
    int required;
    cin >> required;
    // Input Area End

    // Function call Area Start
    auto start = high_resolution_clock::now();
    auto result = sol.locatePairPositions(values, required);
    auto stop = high_resolution_clock::now();
    // Function call Area End

    // Output Area Start
    if (!result.empty()) {
        cout << result[0] << " " << result[1] << "\n";
    } else {
        cout << -1 << "\n";
    }
    // Output Area End

    // Dont change or modify any lines below this line

    total_duration += duration_cast<nanoseconds>(stop - start);
    long memory_used = getPeakRSS();
    float execution_time = total_duration.count()/1e9;
    
    const char* file_path = argv[2];
    std::ofstream output_file(file_path);
    output_file << std::fixed << std::setprecision(9);
    output_file << "*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* " << execution_time;
    output_file << "\n";
    output_file << "*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* " << memory_used;
    output_file.close();
    return 0;
}
----------CODE_BASE64_CPP_END----------

----------CODE_BASE64_PYTHON_START----------
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
----------CODE_BASE64_PYTHON_END----------

----------CODE_BASE64_JAVA_START----------
import java.util.*;
import java.io.FileWriter;
import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;

// [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]

public class Main {
    static class FastReader {
        BufferedReader br;
        StringTokenizer st;

        public FastReader() {
            br = new BufferedReader(new InputStreamReader(System.in));
        }

        String next() {
            while (st == null || !st.hasMoreElements()) {
                try {
                    st = new StringTokenizer(br.readLine());
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
            return st.nextToken();
        }

        int nextInt() {
            return Integer.parseInt(next());
        }

        long nextLong() {
            return Long.parseLong(next());
        }

        double nextDouble() {
            return Double.parseDouble(next());
        }

        String nextLine() {
            String str = "";
            try {
                str = br.readLine();
            } catch (IOException e) {
                e.printStackTrace();
            }
            return str;
        }
    }

    public static long getPeakRSS() {
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();
        return heapUsage.getUsed() / 1024; // Convert bytes to kilobytes
    }

    public static void main(String[] args) throws IOException {
        if (args.length < 2) {
            System.out.println("Usage: java Main <file_path>");
            return;
        }
        String file_path = args[1];
        long total_elapsed_time_ns = 0; 
        Solution sol = new Solution();
        FastReader sc = new FastReader();

        // Dont Remove the code of above lines in the main function or dont modify them
        // or dont change the order of the lines.

        // Input Area Start
        int n = sc.nextInt();
        int[] values = new int[n];
        for (int i = 0; i < n; i++) {
            values[i] = sc.nextInt();
        }
        int required = sc.nextInt();
        // Input Area End

        // Function Call Area Start
        long start_time = System.nanoTime();
        List<Integer> result = sol.locatePairPositions(values, required); 
        long end_time = System.nanoTime();
        // Function Call Area End

        // Output Area Start
        if (!result.isEmpty()) {
            System.out.println(result.get(0) + " " + result.get(1));
        } else {
            System.out.println(-1);
        }
        // Output Area End

        // Dont change or modify any lines below this line
        
        total_elapsed_time_ns += (end_time - start_time);

        long memory_used = getPeakRSS();
        double execution_time = total_elapsed_time_ns / 1e9;
        FileWriter writer = new FileWriter(file_path);
        writer.write("*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* "+ execution_time);
        writer.write("\n");
        writer.write("*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* "+ memory_used);
        writer.close();
    }
}
----------CODE_BASE64_JAVA_END----------

----------CODE_BASE64_NODE_JS_START----------
const fs = require("fs");
const path = require("path");

const solutionPath = path.join(__dirname, "Solution.js");

if (fs.existsSync(solutionPath)) {
    const userCode = fs.readFileSync(solutionPath, "utf8");
    eval(userCode + "\n; global.Solution = Solution;");
} else {
    console.error("Error: Solution.js not found at", solutionPath);
    process.exit(1);
}

async function main() {
    const filePath = process.argv[3];
    if (!filePath) {
        console.error('Usage: node Main.js <output_file_path>');
        process.exit(1);
    }
    let total_elapsed_time_ns = 0n;

    // Dont Remove the code of above lines in the main function or dont modify them
    // or dont change the order of the lines.


    // Input Parsing Area Start

    let idx = 0;
    const input = fs.readFileSync(0, "utf8").trim().split(/\s+/);
    const n = parseInt(input[idx++], 10);
    const values = [];
    for (let i = 0; i < n; i++) {
        values.push(parseInt(input[idx++], 10));
    }
    const required = parseInt(input[idx++], 10);

    // Input Parsing Area End

    // Function Call Area Start

    const startTime = process.hrtime.bigint();
    const result = Solution.locatePairPositions(values, required); 
    const endTime = process.hrtime.bigint();

    // Function Call Area End

    // Output Printing Area Start

    if (result.length > 0) {
        console.log(result[0] + " " + result[1]);
    } else {
        console.log("-1");
    }

    // Output Printing Area End 

    // Dont change or modify any lines below this line

    total_elapsed_time_ns += (endTime - startTime);

    const elapsedTimeSeconds = Number(total_elapsed_time_ns) / 1e9;
    const memoryUsedKB = Math.round(process.memoryUsage().rss / 1024);
    const outputContent =
        `*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* ${elapsedTimeSeconds.toFixed(9)}\n` +
        `*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* ${memoryUsedKB}`;

    fs.writeFile(filePath, outputContent, (err) => {
        if (err) {
            console.error('Error writing output file:', err);
            process.exit(1);
        }
    });
}
main();
----------CODE_BASE64_NODE_JS_END----------