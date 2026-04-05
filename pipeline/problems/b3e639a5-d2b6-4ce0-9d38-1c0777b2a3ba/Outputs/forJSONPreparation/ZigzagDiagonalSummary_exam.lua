----------QUESTION_DESCRIPTION_START----------
In the desert observatory of Saruun, a wall of numbered bronze plates preserves the last measured pulse of an ancient sky engine.

To copy the pattern correctly, the royal archivist reads the plates in a serpentine sweep: row `0`, row `2`, row `4`, and so on from left to right, while row `1`, row `3`, row `5`, and so on from right to left.

Each plate is then filed into a resonance chamber identified by `row + column`.

Your duty is to prepare the chamber report that the observatory seals at dawn.

Rows are treated as `0`-indexed.

Traverse the table in that zigzag row order and collect values by their chamber label.

Process the chamber labels in increasing order.

If a chamber contains an odd count of values, sort those values and use the middle one.

If a chamber contains an even count of values, use the arithmetic mean of all values in that chamber.

Write the final chamber results on one line, separated by single spaces, with every value shown to exactly `2` digits after the decimal point.

**Example 1:**

**Input:**

```
2 4
12 18 20 24
31 29 27 25
```

**Output:**

```
12.00 24.50 24.50 25.50 25.00
```

**Explanation:**

- Diagonal labels from `0` to `4` gather the readings `12`; `18` and `31`; `20` and `29`; `24` and `27`; and `25`.

- Their final formatted chamber values become `12.00`, `24.50`, `24.50`, `25.50`, and `25.00`.

**Example 2:**

**Input:**

```
4 3
16 22 30
44 17 19
28 26 32
40 34 38
```

**Output:**

```
16.00 33.00 28.00 26.00 33.00 38.00
```

**Explanation:**

- Diagonal label `2` gathers `30`, `17`, and `28`; after ordering them, the middle reading is `28.00`.

- Diagonal label `3` gathers `19`, `26`, and `40`, so its middle reading is `26.00`, while diagonal label `4` uses the mean of `32` and `34` to produce `33.00`.

**Your Task**

- Complete the provided `summarizeDiagonalEchoes` function that takes `gridData` and returns the final space-separated report string.

**Constraints**

- `1 ≤ m ≤ 100`

- `1 ≤ n ≤ 100`

- `−10^4 ≤ each table value ≤ 10^4`

- The table contains exactly `m` rows, and each row contains exactly `n` space-separated integers.

**Input Format**

- The first line contains two space-separated integers `m` and `n`.

- Each of the next `m` lines contains `n` space-separated integers describing one row of the table.

**Output Format**

The output is a single line:

- The output contains one space-separated formatted value for every diagonal chamber, listed from the smallest `row + column` value to the largest one.

- Each formatted value contains exactly `2` digits after the decimal point.

- The final result is printed to standard output as a single joined line; if there are no diagonal chambers, the printed line would be `""`.
----------QUESTION_DESCRIPTION_END----------

----------SHORT_TEXT_START----------
Zigzag Diagonal Summary
----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------
EASY
----------QUESTION_LEVEL_END----------

----------CODE_CONTENT_CPP_START----------
#include <bits/stdc++.h>
using namespace std;

class solution {
    public:
    string summarizeDiagonalEchoes(vector<vector<int>>& gridData) {
        // Write your code here...
        
    }
};
----------CODE_CONTENT_CPP_END----------

----------CODE_CONTENT_PYTHON_START----------
class solution:
    def summarizeDiagonalEchoes(self, gridData):
        # Write your code here...
        pass
----------CODE_CONTENT_PYTHON_END----------

----------CODE_CONTENT_JAVA_START----------
import java.util.*;

public class Solution {
    public String summarizeDiagonalEchoes(int[][] gridData) {
        //Write your code here...
        
    }
}
----------CODE_CONTENT_JAVA_END----------

----------CODE_CONTENT_NODE_JS_START----------
class Solution {
    static summarizeDiagonalEchoes(gridData) {
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
    int m, n;
    cin >> m >> n;
    vector<vector<int> > matrix(m, vector<int>(n));
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            cin >> matrix[i][j];
        }
    }
    // Input Area End

    // Function call Area Start
    auto start = high_resolution_clock::now();
    auto result = sol.summarizeDiagonalEchoes(matrix);
    auto stop = high_resolution_clock::now();
    // Function call Area End

    // Output Area Start
    cout << result << endl;
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
gridData = []
for _ in range(m):
    gridData.append(list(map(int, input().split())))
# Input Area End

# Function Call Area Start
start_time_ns = time.perf_counter_ns()
result = sol.summarizeDiagonalEchoes(gridData)
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
        int[][] gridData = new int[m][n];
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                gridData[i][j] = sc.nextInt();
            }
        }
        // Input Area End

        // Function Call Area Start
        long start_time = System.nanoTime();
        // [INSERT FUNCTION CALL HERE]
        String result = sol.summarizeDiagonalEchoes(gridData); 
        long end_time = System.nanoTime();
        // Function Call Area End

        // Output Area Start
        System.out.println(result);
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
    let matrix = [];
    if (raw.length > 0) {
        const input = raw.split(/\s+/).map(Number);
        const m = input[idx++];
        const n = input[idx++];
        matrix = new Array(m);
        for (let i = 0; i < m; i++) {
            matrix[i] = new Array(n);
            for (let j = 0; j < n; j++) {
                matrix[i][j] = input[idx++];
            }
        }
    }

    // Input Parsing Area End

    // Function Call Area Start

    const startTime = process.hrtime.bigint();
    const result = Solution.summarizeDiagonalEchoes(matrix);
    const endTime = process.hrtime.bigint();

    // Function Call Area End

    // Output Printing Area Start

    if (raw.length === 0) {
        process.stdout.write("");
    } else {
        process.stdout.write(result + "\n");
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