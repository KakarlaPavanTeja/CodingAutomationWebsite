----------QUESTION_DESCRIPTION_START----------

Given `n` friends, each person can either remain single or be paired with another **friend**. 

Each **friend** can be part of only one pair. Write a **recursive function** to find the total number of ways friends can remain single or be paired.

#### Example 1

**Input**

```
n = 3

```

**Output**

```
4 
```

**Explanation**

- There are `3` friends` {1  2  3}`. The possible ways to pair them are:

* Everyone stays single: `{1  2  3}`
* `1` and `2` pair up, `3` stays single: `{(1  2)  3}`
* `1` and `3` pair up, `2` stays single: `{(1  3)  2}`
* `2` and `3` pair up, `1` stays single: `{(2  3)  1}`



#### Example 2

**Input**

```
n = 2

```

**Output**

```
2
```

**Explanation**

- There are `2` friends `{1  2}`. The possible ways are:

* Both stay single: `{1  2}`
* `1` and `2` pair up: `{(1   2)}`
* Total ways = `2`.

#### Your Task
Complete the recursive function to calculate the total number of ways friends can remain single or be paired for a given `n`.

#### Constraints
- `1` <= `n` <= `30`

#### Input Format
-   A single positive integer `n` representing the number of friends.


#### Output Format
- A single integer representing the total number of ways.

----------QUESTION_DESCRIPTION_END----------


----------SHORT_TEXT_START----------
Friends Pairing Problem


----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------
EASY
----------QUESTION_LEVEL_END----------

----------COMPANIES_START----------
----------COMPANIES_END----------

----------DEFAULT_TAGS_START----------

----------DEFAULT_TAGS_END----------

----------BEGINNER_TOPICS_START----------
Recursion
----------BEGINNER_TOPICS_END----------

----------INTERMEDIATE_TOPICS_START----------
----------INTERMEDIATE_TOPICS_END----------

----------ADVANCED_TOPICS_START----------

----------ADVANCED_TOPICS_END----------

----------REAL_LIFE_EXAMPLES_START----------
----------REAL_LIFE_EXAMPLES_END----------

----------FOLLOW_UP_QUESTIONS_START----------

----------FOLLOW_UP_QUESTION_START_1----------

----------QUESTION_START----------
----------QUESTION_END----------

----------ANSWER_START----------
----------ANSWER_END----------

----------FOLLOW_UP_QUESTION_END_1----------

----------FOLLOW_UP_QUESTION_START_2----------

----------QUESTION_START----------
----------QUESTION_END----------

----------ANSWER_START----------
----------ANSWER_END----------

----------FOLLOW_UP_QUESTION_END_2----------

----------FOLLOW_UP_QUESTIONS_END----------

----------HINTS_START----------

----------HINTS_START_1----------
----------HINTS_END_1----------

----------HINTS_START_2----------
----------HINTS_END_2----------

----------HINTS_START_3----------
----------HINTS_END_3----------

----------HINTS_END----------

----------CODE_CONTENT_CPP_START----------


#include <bits/stdc++.h>
using namespace std;


class solution {
public:
    int countFriendsPairing(int n) {
        // Write your recursive logic here
        
    }
};


----------CODE_CONTENT_CPP_END----------


----------CODE_CONTENT_PYTHON_START----------


class solution:
    def countFriendsPairing(self, n):
        # Write your recursive logic here
        


     
----------CODE_CONTENT_PYTHON_END----------


----------CODE_CONTENT_JAVA_START----------
import java.util.*;


class Solution {
        public static int countFriendsPairing(int n) {
        // Write your recursive logic here
        
    }
}








----------CODE_CONTENT_JAVA_END----------


----------CODE_CONTENT_NODE_JS_START----------


class Solution {
  // Declared as static to match common platform driver requirements
  static countFriendsPairing(n) {
    // Write your recursive logic here
    
  }
}


----------CODE_CONTENT_NODE_JS_END----------
    


----------DEBUG_HELPER_CODE_CPP_START----------

----------PRE_USER_CODE_START----------
#include <bits/stdc++.h>
using namespace std;
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_CPP_END----------

----------DEBUG_HELPER_CODE_PYTHON_START----------

----------PRE_USER_CODE_START----------
import sys
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_PYTHON_END----------

----------DEBUG_HELPER_CODE_JAVA_START----------

----------PRE_USER_CODE_START----------
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_JAVA_END----------

----------CODE_BASE64_CPP_START----------

#include <bits/stdc++.h>
#include <fstream>
#include <chrono>
#include <iomanip>
#include <sys/resource.h>
using namespace std;
using namespace std::chrono;

#include "solution.cpp"

long getPeakRSS() {
    struct rusage rusage;
    getrusage(RUSAGE_SELF, &rusage);
    return rusage.ru_maxrss;
}

int main(int argc, char* argv[]) {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    if (!(cin >> n)) return 0;

    solution sol;

    auto start = high_resolution_clock::now();
    // Capturing the returned integer count
    int ans = sol.countFriendsPairing(n);
    auto stop = high_resolution_clock::now();

    // Output the answer to stdout
    cout << ans << endl;

    long memory_used = getPeakRSS();
    auto duration = duration_cast<nanoseconds>(stop - start);
    double execution_time = duration.count() / 1e9;

    try {
        const char* file_path = argv[2];
        ofstream output_file(file_path);
        output_file << fixed << setprecision(9);
        output_file << "*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* " << execution_time << "\n";
        output_file << "*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* " << memory_used;
        output_file.close();
    } catch (...) {}

    return 0;
}

    
----------CODE_BASE64_CPP_END----------

----------CODE_BASE64_PYTHON_START----------

from solution import solution
import resource
import time
import sys

# Ensure sufficient arguments are provided
if len(sys.argv) < 3:
    sys.exit(1)

file_path = sys.argv[2]

data = sys.stdin.read().strip().split()
if not data:
    sys.exit(0)

n = int(data[0])

sol = solution()

start_time_ns = time.perf_counter_ns()
ans = sol.countFriendsPairing(n)
end_time_ns = time.perf_counter_ns()

# Output result
print(ans)

usage = resource.getrusage(resource.RUSAGE_SELF)
memory_used = usage.ru_maxrss
elapsed_time_seconds = (end_time_ns - start_time_ns) / 1e9

with open(file_path, "w") as output_file:
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* {elapsed_time_seconds:.9f}\n")
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* {memory_used}")

----------CODE_BASE64_PYTHON_END----------

----------CODE_BASE64_JAVA_START----------

import java.util.*;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;

public class Main {
    public static long getPeakRSS() {
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();
        return heapUsage.getUsed() / 1024; // KB
    }

    public static void main(String[] args) {
        if (args.length < 2) return;
        String filePath = args[1];
        Scanner scanner = new Scanner(System.in);

        if (!scanner.hasNextInt()) {
            scanner.close();
            return;
        }

        int n = scanner.nextInt();

        long startTime = System.nanoTime();
        // Fixed: Calling the correct method and passing 'n' instead of 'arr'
        int ans = Solution.countFriendsPairing(n);
        long endTime = System.nanoTime();

        // Print result to stdout
        System.out.println(ans);

        long memoryUsed = getPeakRSS();
        double executionTime = (endTime - startTime) / 1e9;

        try (FileWriter writer = new FileWriter(filePath)) {
            writer.write("*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* ");
            writer.write(String.format("%.9f", executionTime));
            writer.write("\n");
            writer.write("*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* ");
            writer.write(String.valueOf(memoryUsed));
        } catch (IOException e) {}
        scanner.close();
    }
}

----------CODE_BASE64_JAVA_END----------

----------CODE_BASE64_NODE_JS_START----------
const fs = require("fs");
const path = require("path");

const solutionPath = path.join(__dirname, "Solution.js");
if (!fs.existsSync(solutionPath)) process.exit(1);

const userCode = fs.readFileSync(solutionPath, "utf8");
const SolClass = eval(userCode + "\nSolution");

function main() {
  const filePath = process.argv[3];
  if (!filePath) process.exit(1);

  const input = fs.readFileSync(0, "utf-8").trim();
  const tokens = input.length ? input.split(/\s+/).map(Number) : [];
  if (tokens.length === 0) process.exit(0);

  const n = tokens[0];

  const startTime = process.hrtime.bigint();  
  // Calling the static method on SolClass
  const ans = SolClass.countFriendsPairing(n);
  const endTime = process.hrtime.bigint();

  process.stdout.write(ans + "\n");

  const elapsedTimeSeconds = Number(endTime - startTime) / 1e9;
  const memoryUsedKB = process.resourceUsage().maxRSS;

  const outputContent =
    `*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* ${elapsedTimeSeconds.toFixed(9)}\n` +
    `*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* ${memoryUsedKB}`;

  fs.writeFileSync(filePath, outputContent);
}
main();

----------CODE_BASE64_NODE_JS_END----------
----------SOLUTIONS_CPP_START----------
#include <bits/stdc++.h>
using namespace std;

class solution {
public:
    int countFriendsPairing(int n) {
        // Base cases: 1 way for 1 friend, 2 ways for 2 friends
        if (n <= 2) return n;

        // Recursive Step: 
        // 1. Friend remains single: countFriendsPairing(n - 1)
        // 2. Friend pairs with any of (n-1) others: (n - 1) * countFriendsPairing(n - 2)
        return countFriendsPairing(n - 1) + (n - 1) * countFriendsPairing(n - 2);
    }
};
----------SOLUTIONS_CPP_END----------

----------SOLUTIONS_PYTHON_START----------
class solution:
    def countFriendsPairing(self, n):
        # Base cases
        if n <= 2:
            return n
        
        # Recursive relation: f(n) = f(n-1) + (n-1) * f(n-2)
        return self.countFriendsPairing(n - 1) + (n - 1) * self.countFriendsPairing(n - 2)
----------SOLUTIONS_PYTHON_END----------


----------SOLUTIONS_JAVA_START----------
import java.util.*;

class Solution {
    // Declared as static to avoid "non-static method" compiler errors
    public static int countFriendsPairing(int n) {
        // Base Case: 1 way for 1 friend, 2 ways for 2 friends
        if (n <= 2) {
            return n;
        }

        // Recursive step implementing branching recursion with a multiplier
        return countFriendsPairing(n - 1) + (n - 1) * countFriendsPairing(n - 2);
    }
}
----------SOLUTIONS_JAVA_END----------

----------SOLUTIONS_NODE_JS_START----------


class Solution {
  // Use static to match the driver's SolClass.countFriendsPairing(n) call
  static countFriendsPairing(n) {
    // Base cases for recursion
    if (n <= 2) {
      return n;
    }

    // Branching recursion: Stay single OR pair with any of the (n-1) others
    return this.countFriendsPairing(n - 1) + (n - 1) * this.countFriendsPairing(n - 2);
  }
}
----------SOLUTIONS_NODE_JS_END----------




