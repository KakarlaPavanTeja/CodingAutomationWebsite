----------QUESTION_DESCRIPTION_START----------
Inside the Ember Observatory, scribes catalog a wall of resonance tablets arranged as an `m x n` grid of energy marks.

To follow the vault ritual, even-indexed rows are read from left to right, while odd-indexed rows are read from right to left.

Each mark is then placed into a resonance band identified by `row + col`.

For every band, sort its collected values; if the band size is odd, record its median, otherwise record the average of all values in that band.

Produce the band records in increasing order of band id, with every value written to exactly `2` decimal places on a single line.

**Example 1:**

**Input:**

```
2 4
16 -20 17 21
25 23 -14 26
```

**Output:**

```
16.00 2.50 20.00 3.50 26.00
```

**Explanation:**

- Row `0` is read left to right, contributing `16`, `-20`, `17`, and `21`.

- Row `1` is read right to left, contributing `26`, `-14`, `23`, and `25`.

- The diagonal bands are `0 -> [16]`, `1 -> [-20, 25]`, `2 -> [17, 23]`, `3 -> [21, -14]`, and `4 -> [26]`, so the reported values are `16.00`, `2.50`, `20.00`, `3.50`, and `26.00`.

**Example 2:**

**Input:**

```
3 3
18 24 31
27 19 22
30 28 35
```

**Output:**

```
18.00 25.50 30.00 25.00 35.00
```

**Explanation:**

- The rows are collected in this order: `18 24 31`, then `22 19 27`, then `30 28 35`.

- The diagonal bands become `0 -> [18]`, `1 -> [24, 27]`, `2 -> [31, 19, 30]`, `3 -> [22, 28]`, and `4 -> [35]`.

- After sorting each band, the results are the median `18.00`, the average `25.50`, the median `30.00`, the average `25.00`, and the median `35.00`.

**Your Task**

- Complete the provided `compileDiagonalLedger` function that takes `m`, `n`, and `vaultGrid`, and returns the final space-separated summary string with every value formatted to exactly `2` decimal places`.

- The surrounding driver code will use that result to produce the required single-line output.

**Constraints**

- `1 ≤ m ≤ 100`

- `1 ≤ n ≤ 100`

- `−10^4 ≤ vaultGrid[i][j] ≤ 10^4`

- Each of the next `m` input lines contains exactly `n` space-separated integers.

**Input Format**

- The first line contains two space-separated integers `m` and `n`.

- The next `m` lines each contain `n` space-separated integers, representing the rows of the grid.

**Output Format**

The output is a single line:

- The output contains the diagonal summaries in increasing order of `row + col`, separated by single spaces.

- The final result is printed to standard output, and every value is shown with exactly `2` digits after the decimal point.

- If there is no diagonal summary, the produced line would be `""`, although valid inputs always generate at least one value.
----------QUESTION_DESCRIPTION_END----------

----------SHORT_TEXT_START----------
Zigzag Diagonal Statistics
----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------
MEDIUM
----------QUESTION_LEVEL_END----------

----------COMPANIES_START----------

----------COMPANIES_END----------

----------DEFAULT_TAGS_START----------

----------DEFAULT_TAGS_END----------

----------BEGINNER_TOPICS_START----------
Matrix, Sorting, Simulation
----------BEGINNER_TOPICS_END----------

----------INTERMEDIATE_TOPICS_START----------
Hash Table
----------INTERMEDIATE_TOPICS_END----------

----------ADVANCED_TOPICS_START----------

----------ADVANCED_TOPICS_END----------

----------REAL_LIFE_EXAMPLES_START----------
1. This pattern is useful in image and sensor processing, where zigzag row reading and diagonal grouping help summarize neighboring signals efficiently for compression or noise analysis.

2. It also matches warehouse or robot scanning paths, where alternating row movement reduces travel time and diagonal-based summaries can quickly report balanced statistics across zones.
----------REAL_LIFE_EXAMPLES_END----------

----------FOLLOW_UP_QUESTIONS_START----------
----------FOLLOW_UP_QUESTION_START_1----------
----------QUESTION_START----------
Your solution uses `map<int, vector<int>>`, which makes insertion `O(log(m+n))` per element. Since the diagonal id `r + c` is always in the fixed range `[0, m+n-2]`, can you reduce this to pure `O(m*n)` grouping time?
----------QUESTION_END----------

----------ANSWER_START----------
Yes — replace the `map` with `vector<vector<int>> diagonals(m + n - 1)`, and push directly into `diagonals[r+c]`. That removes the tree overhead and makes grouping `O(m*n)`, though sorting each diagonal still keeps the total at `O(m*n log(min(m,n)))` in the worst case.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_1----------

----------FOLLOW_UP_QUESTION_START_2----------
----------QUESTION_START----------
Right now you sort every diagonal completely, but for odd-sized bands you only need the median, and for even-sized bands you only need the mean. Can you avoid full sorting and improve the per-diagonal cost?
----------QUESTION_END----------

----------ANSWER_START----------
For odd-sized diagonals, `nth_element` can find the median in expected linear time without fully sorting. For even-sized diagonals, sorting is unnecessary because the required value is just the arithmetic mean, so you can maintain a running sum while building the diagonal and compute it in `O(1)` afterward.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_2----------

----------FOLLOW_UP_QUESTION_START_3----------
----------QUESTION_START----------
Your current approach stores all values of every diagonal, which is `O(m*n)` extra space. Can you optimize space if the input were much larger or arrived as a stream?
----------QUESTION_END----------

----------ANSWER_START----------
For even-length diagonals, you only need the count and sum, so no full storage is required. For odd-length diagonals, if exact median is needed you still need order-statistics support or buffering; with bounded values like `[-10^4, 10^4]`, a frequency array per diagonal can compute medians without storing all raw elements.
----------ANSWER_END----------
----------FOLLOW_UP_QUESTION_END_3----------
----------FOLLOW_UP_QUESTIONS_END----------

----------HINTS_START----------
----------HINTS_START_1----------
Try simulating the reading order exactly as described. For each cell, figure out which band it belongs to using `row + col`, collect all values for that band, then at the end sort each band and compute either the middle value or the average.
----------HINTS_END_1----------

----------HINTS_START_2----------
If you do everything in one big list first, you may end up re-grouping values again later. A cleaner improvement is to place each value directly into its correct `row + col` bucket while traversing the grid in zigzag row order, so each band is ready for final sorting and calculation.
----------HINTS_END_2----------
----------HINTS_END----------

----------CODE_CONTENT_CPP_START----------
#include <bits/stdc++.h>
using namespace std;

class solution {
    public:
    string compileDiagonalLedger(int m, int n, vector<vector<int>> &vaultGrid) {
        // Write your code here...
        
    }
};
----------CODE_CONTENT_CPP_END----------

----------CODE_CONTENT_PYTHON_START----------
class solution:
    def compileDiagonalLedger(self, m, n, vaultGrid):
        # Write your code here...
        pass
----------CODE_CONTENT_PYTHON_END----------

----------CODE_CONTENT_JAVA_START----------
import java.util.*;

public class Solution {
    public String compileDiagonalLedger(int m, int n, int[][] vaultGrid) {
        //Write your code here...
        
    }
}
----------CODE_CONTENT_JAVA_END----------

----------CODE_CONTENT_NODE_JS_START----------
class Solution {
    static compileDiagonalLedger(m, n, vaultGrid) {
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
    int m, n;
    cin >> m >> n;
    vector<vector<int>> vaultGrid(m, vector<int>(n));
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            cin >> vaultGrid[i][j];
        }
    }
    // Input Area End

    // Function call Area Start
    string result = sol.compileDiagonalLedger(m, n, vaultGrid);
    // Function call Area End

    // Output Area Start
    cout << result << "\n";
    // Output Area End

    // Dont change or modify any lines below this line
    return 0;
}
----------POST_USER_CODE_END----------
----------DEBUG_HELPER_CODE_CPP_END----------

----------DEBUG_HELPER_CODE_PYTHON_START----------
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
        int m = sc.nextInt();
        int n = sc.nextInt();
        int[][] vaultGrid = new int[m][n];
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                vaultGrid[i][j] = sc.nextInt();
            }
        }
        // Input Area End

        // Function Call Area Start
        String result = sol.compileDiagonalLedger(m, n, vaultGrid);
        // Function Call Area End

        // Output Area Start
        System.out.print(result);
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
    int m, n;
    cin >> m >> n;
    vector<vector<int>> vaultGrid(m, vector<int>(n));
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            cin >> vaultGrid[i][j];
        }
    }
    // Input Area End

    // Function call Area Start
    auto start = high_resolution_clock::now();
    auto result = sol.compileDiagonalLedger(m, n, vaultGrid);
    auto stop = high_resolution_clock::now();
    // Function call Area End

    // Output Area Start
    cout << result << "\n";
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
        int m = sc.nextInt();
        int n = sc.nextInt();
        int[][] vaultGrid = new int[m][n];
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                vaultGrid[i][j] = sc.nextInt();
            }
        }
        // Input Area End

        // Function Call Area Start
        long start_time = System.nanoTime();
        // [INSERT FUNCTION CALL HERE]
        String result = sol.compileDiagonalLedger(m, n, vaultGrid); 
        long end_time = System.nanoTime();
        // Function Call Area End

        // Output Area Start
        System.out.print(result);
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
    const raw = fs.readFileSync(0, "utf8").trim();
    let m = 0, n = 0;
    let vaultGrid = [];

    if (raw.length > 0) {
        const input = raw.split(/\s+/);
        m = parseInt(input[idx++], 10);
        n = parseInt(input[idx++], 10);

        vaultGrid = new Array(m);
        for (let i = 0; i < m; i++) {
            const row = new Array(n);
            for (let j = 0; j < n; j++) {
                row[j] = parseInt(input[idx++], 10);
            }
            vaultGrid[i] = row;
        }
    }

    // Input Parsing Area End

    // Function Call Area Start

    const startTime = process.hrtime.bigint();
    const result = Solution.compileDiagonalLedger(m, n, vaultGrid);
    const endTime = process.hrtime.bigint();

    // Function Call Area End

    // Output Printing Area Start

    console.log(result);

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
    string compileDiagonalLedger(int m, int n, vector<vector<int>> &vaultGrid) {
        map<int, vector<int>> diagonals;
        for (int r = 0; r < m; r++) {
            if (r % 2 == 0) {
                for (int c = 0; c < n; c++) {
                    diagonals[r + c].push_back(vaultGrid[r][c]);
                }
            } else {
                for (int c = n - 1; c >= 0; c--) {
                    diagonals[r + c].push_back(vaultGrid[r][c]);
                }
            }
        }

        vector<string> result;
        for (map<int, vector<int>>::iterator it = diagonals.begin(); it != diagonals.end(); ++it) {
            vector<int> group = it->second;
            sort(group.begin(), group.end());
            int size = (int)group.size();

            ostringstream out;
            out << fixed << setprecision(2);
            if (size % 2 == 1) {
                double median = group[size / 2];
                out << median;
            } else {
                double sum = 0.0;
                for (int i = 0; i < size; i++) sum += group[i];
                double avg = sum / size;
                out << avg;
            }
            result.push_back(out.str());
        }

        ostringstream ans;
        for (size_t i = 0; i < result.size(); i++) {
            ans << result[i] << (i + 1 < result.size() ? " " : "");
        }
        return ans.str();
    }
};
----------SOLUTIONS_CPP_END----------

----------SOLUTIONS_PYTHON_START----------
from collections import defaultdict

class solution:
    def compileDiagonalLedger(self, m, n, vaultGrid):
        diagonals = defaultdict(list)

        for r in range(m):
            if r % 2 == 0:
                for c in range(n):
                    diagonals[r + c].append(vaultGrid[r][c])
            else:
                for c in range(n - 1, -1, -1):
                    diagonals[r + c].append(vaultGrid[r][c])

        result = []
        for d in sorted(diagonals.keys()):
            group = sorted(diagonals[d])
            size = len(group)
            if size % 2 == 1:
                median = group[size // 2]
                result.append(f"{median:.2f}")
            else:
                avg = sum(group) / size
                result.append(f"{avg:.2f}")

        return ' '.join(result)
----------SOLUTIONS_PYTHON_END----------

----------SOLUTIONS_JAVA_START----------
import java.util.*;

public class Solution {
    public String compileDiagonalLedger(int m, int n, int[][] vaultGrid) {
        HashMap<Integer, ArrayList<Integer>> diagonals = new HashMap<>();

        for (int r = 0; r < m; r++) {
            if (r % 2 == 0) {
                for (int c = 0; c < n; c++) {
                    int key = r + c;
                    diagonals.putIfAbsent(key, new ArrayList<>());
                    diagonals.get(key).add(vaultGrid[r][c]);
                }
            } else {
                for (int c = n - 1; c >= 0; c--) {
                    int key = r + c;
                    diagonals.putIfAbsent(key, new ArrayList<>());
                    diagonals.get(key).add(vaultGrid[r][c]);
                }
            }
        }

        ArrayList<Integer> keys = new ArrayList<>(diagonals.keySet());
        Collections.sort(keys);

        StringBuilder result = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            int d = keys.get(i);
            ArrayList<Integer> group = diagonals.get(d);
            Collections.sort(group);

            int size = group.size();
            String val;
            if (size % 2 == 1) {
                int median = group.get(size / 2);
                val = String.format(Locale.US, "%.2f", (double) median);
            } else {
                long sum = 0;
                for (int x : group) sum += x;
                double avg = (double) sum / size;
                val = String.format(Locale.US, "%.2f", avg);
            }

            if (i > 0) result.append(" ");
            result.append(val);
        }

        return result.toString();
    }
}
----------SOLUTIONS_JAVA_END----------

----------SOLUTIONS_NODE_JS_START----------
class Solution {
    static compileDiagonalLedger(m, n, vaultGrid) {
        const diagonals = new Map();

        for (let r = 0; r < m; r++) {
            if (r % 2 === 0) {
                for (let c = 0; c < n; c++) {
                    const key = r + c;
                    if (!diagonals.has(key)) diagonals.set(key, []);
                    diagonals.get(key).push(vaultGrid[r][c]);
                }
            } else {
                for (let c = n - 1; c >= 0; c--) {
                    const key = r + c;
                    if (!diagonals.has(key)) diagonals.set(key, []);
                    diagonals.get(key).push(vaultGrid[r][c]);
                }
            }
        }

        const keys = Array.from(diagonals.keys()).sort((a, b) => a - b);
        const result = [];

        for (let i = 0; i < keys.length; i++) {
            const group = diagonals.get(keys[i]).slice().sort((a, b) => a - b);
            const size = group.length;

            if (size % 2 === 1) {
                const median = group[Math.floor(size / 2)];
                result.push(median.toFixed(2));
            } else {
                let sum = 0;
                for (let j = 0; j < size; j++) sum += group[j];
                const avg = sum / size;
                result.push(avg.toFixed(2));
            }
        }

        return result.join(" ");
    }
}
----------SOLUTIONS_NODE_JS_END----------