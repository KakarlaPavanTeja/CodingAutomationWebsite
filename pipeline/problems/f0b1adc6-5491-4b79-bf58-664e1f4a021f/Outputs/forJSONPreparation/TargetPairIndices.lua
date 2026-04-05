----------QUESTION_DESCRIPTION_START----------
Inside the storm-lit vaults of a floating city, an apprentice engineer studies a line of power cells recorded in the order they were loaded into the gate console.

The ancient mechanism unlocks only when exactly two cells, chosen by their positions in the record, combine to match a required charge.

Using the same position twice would overload the circuit, so the two positions must be different.

Your job is to examine the sequence of values and locate the zero-based positions of a valid pair whose combined value equals the required total. If no such pair exists, report `-1`.

**Example 1:**

**Input:**

```
5
10 14 1 5 8
19
```

**Output:**

```
1 3
```

**Explanation:**

- The values at positions `1` and `3` are `14` and `5`, and together they form the required total `19`.

**Example 2:**

**Input:**

```
6
12 -5 8 1 14 20
40
```

**Output:**

```
-1
```

**Explanation:**

- No two distinct positions in the sequence produce the required total `40`, so the output is `-1`.

**Your Task**

- Complete the provided `locatePairPositions(values, required)` function that takes the sequence of integers and the required total, and returns a list containing the two zero-based positions of a valid pairing, or `[]` if no pairing exists.

**Constraints**

- `2 ≤ n ≤ 10^4`

- `−10^9 ≤ each value in the sequence ≤ 10^9`

- `−10^9 ≤ required ≤ 10^9`

- The second input line contains exactly `n` integers, and any reported pair must use two different positions.

**Input Format**

- The first line contains an integer `n`, representing how many values are in the sequence.

- The second line contains `n` space-separated integers representing the sequence values.

- The third line contains an integer `required`, representing the desired combined total.

**Output Format**

The output is a single line:

- The final result is printed to the standard output.

- If a valid pairing exists, the output contains two space-separated zero-based positions.

- If no valid pairing exists, the output contains `-1`.

- An empty string `""` is not used in this program; absence of a valid pairing is represented by `-1`.
----------QUESTION_DESCRIPTION_END----------

----------SHORT_TEXT_START----------
Target Pair Indices
----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------
MEDIUM
----------QUESTION_LEVEL_END----------

----------COMPANIES_START----------

----------COMPANIES_END----------

----------DEFAULT_TAGS_START----------

----------DEFAULT_TAGS_END----------

----------BEGINNER_TOPICS_START----------
Array
----------BEGINNER_TOPICS_END----------

----------INTERMEDIATE_TOPICS_START----------
Hash Table
----------INTERMEDIATE_TOPICS_END----------

----------ADVANCED_TOPICS_START----------

----------ADVANCED_TOPICS_END----------

----------REAL_LIFE_EXAMPLES_START----------
1. This kind of pair-finding is used in payment and billing systems to quickly detect two transactions that exactly match a target refund or balance amount without checking every possible pair.

2. The hash-map approach matters in real systems like sensor or game event processing because it finds a matching pair in one pass, which keeps performance fast even when thousands of values arrive.
----------REAL_LIFE_EXAMPLES_END----------

----------FOLLOW_UP_QUESTIONS_START----------
----------FOLLOW_UP_QUESTION_START_1----------
----------QUESTION_START----------
Your solution uses an `unordered_map` with `O(n)` extra space. Can you reduce the auxiliary space, and what trade-off would that introduce?
----------QUESTION_END----------

----------ANSWER_START----------
Yes — we can sort value-index pairs and then use the two-pointer technique to find the target sum in `O(n log n)` time with `O(n)` if we preserve indices, or `O(1)` extra beyond the array if modifying input is allowed. The trade-off is losing the linear-time `O(n)` behavior of hashing.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_1----------

----------FOLLOW_UP_QUESTION_START_2----------
----------QUESTION_START----------
Given the constraints allow values up to `10^9` and down to `-10^9`, is using `int` always safe here? What would you change for stricter constraints like values near `10^18`?
----------QUESTION_END----------

----------ANSWER_START----------
For the current bounds, `int` is safe because `target - num` stays within roughly `[-2 * 10^9, 2 * 10^9]`, which fits in `32`-bit signed range. For larger bounds, we should use `long long` for the array values, target, and complement computation to avoid overflow.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_2----------

----------FOLLOW_UP_QUESTION_START_3----------
----------QUESTION_START----------
Your hash-based approach works well for a finite array. How would you adapt it if the numbers arrived as an infinite stream and you needed to report the first valid pair as early as possible?
----------QUESTION_END----------

----------ANSWER_START----------
We can keep the same incremental hash-map idea: for each incoming value, check whether its complement has already appeared, and if yes, return immediately. This still gives expected `O(1)` processing per element, but memory can grow without bound unless we are allowed a sliding window or other constraint.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_3----------
----------FOLLOW_UP_QUESTIONS_END----------

----------HINTS_START----------
----------HINTS_START_1----------
Try checking every pair of positions `i` and `j` with `i < j`. If `values[i] + values[j] == required`, return those indices; otherwise keep going until all pairs are tested.
----------HINTS_END_1----------

----------HINTS_START_2----------
That pair-checking repeats a lot of work and takes about `O(n^2)`. While scanning left to right, think about what earlier value would be needed to complete the current one to `required`, and store seen values with their indices so you can test in near `O(1)` each time.
----------HINTS_END_2----------
----------HINTS_END----------

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

----------DEBUG_HELPER_CODE_CPP_START----------
----------PRE_USER_CODE_START----------
#include <bits/stdc++.h>
using namespace std;
// [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
// [INSERT buildTree LOGIC HERE IF APPLICABLE]

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    solution sol;
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
    vector<int> result = sol.locatePairPositions(values, required);
    // Function call Area End

    // Output Area Start
    if (!result.empty()) {
        cout << result[0] << " " << result[1] << "\n";
    } else {
        cout << -1 << "\n";
    }
    // Output Area End

    // Dont change or modify any lines below this line
    return 0;
}
----------POST_USER_CODE_END----------
----------DEBUG_HELPER_CODE_CPP_END----------

----------DEBUG_HELPER_CODE_PYTHON_START----------
----------PRE_USER_CODE_START----------
import sys
# [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
# [INSERT buildTree LOGIC HERE IF APPLICABLE]

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
----------DEBUG_HELPER_CODE_PYTHON_END----------

----------DEBUG_HELPER_CODE_JAVA_START----------
----------PRE_USER_CODE_START----------
import java.util.*;
import java.io.*;
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
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

    public static void main(String[] args) throws IOException {
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
        List<Integer> result = sol.locatePairPositions(values, required);
        // Function Call Area End

        // Output Area Start
        if (!result.isEmpty()) {
            System.out.println(result.get(0) + " " + result.get(1));
        } else {
            System.out.println(-1);
        }
        // Output Area End

    }
    // [INSERT buildTree LOGIC HERE IF APPLICABLE]
}
----------POST_USER_CODE_END----------
----------DEBUG_HELPER_CODE_JAVA_END----------

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
        cout << result[0] << " " << result[1] << endl;
    } else {
        cout << -1 << endl;
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
result = sol.locatePairPositions(values, required) # Replace with actual function call
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
        // [INSERT FUNCTION CALL HERE]
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

----------SOLUTIONS_CPP_START----------
#include <bits/stdc++.h>
using namespace std;

class solution {
public:
    vector<int> locatePairPositions(vector<int>& values, int required) {
        unordered_map<int, int> seen;
        for (int i = 0; i < (int)values.size(); i++) {
            int num = values[i];
            int complement = required - num;
            if (seen.find(complement) != seen.end()) {
                return {seen[complement], i};
            }
            seen[num] = i;
        }
        return {};
    }
};
----------SOLUTIONS_CPP_END----------

----------SOLUTIONS_PYTHON_START----------
class solution:
    def locatePairPositions(self, values, required):
        seen = {}
        for i, num in enumerate(values):
            complement = required - num
            if complement in seen:
                return [seen[complement], i]
            seen[num] = i
        return []
----------SOLUTIONS_PYTHON_END----------

----------SOLUTIONS_JAVA_START----------
import java.util.*;

public class Solution {
    public List<Integer> locatePairPositions(int[] values, int required) {
        HashMap<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < values.length; i++) {
            int complement = required - values[i];
            if (seen.containsKey(complement)) {
                List<Integer> res = new ArrayList<>();
                res.add(seen.get(complement));
                res.add(i);
                return res;
            }
            seen.put(values[i], i);
        }
        return new ArrayList<>();
    }
}
----------SOLUTIONS_JAVA_END----------

----------SOLUTIONS_NODE_JS_START----------
class Solution {
    static locatePairPositions(values, required) {
        const seen = new Map();
        for (let i = 0; i < values.length; i++) {
            const num = values[i];
            const complement = required - num;
            if (seen.has(complement)) {
                return [seen.get(complement), i];
            }
            seen.set(num, i);
        }
        return [];
    }
}
----------SOLUTIONS_NODE_JS_END----------