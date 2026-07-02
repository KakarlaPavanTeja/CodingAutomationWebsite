from Prompts.dataTypePrompt import get_data_type_selection_rules


def get_splitting_prompt(language, code, desc_response=None, question_type="standard"):
    """
    Returns the system and user prompt for splitting solution code.
    """
    node_injection_rules = ""
    if question_type in ["binary tree", "linked list"]:
        node_injection_rules = f"\n\n**CRITICAL: NODE CLASS & BUILD LOGIC**\nSince this is a {question_type} problem, you MUST accurately include the predefined Node class and proper setup logic. Follow the EXACT positioning rules below for {language}:\n\n"
        if language == "C++":
            node_injection_rules += """
- **Default Code**: MUST contain the `class Node` definition commented out (`/*\n...\n*/`) BELOW the libraries and ABOVE `class solution`. Do NOT add any comments that refer to driver code, `node.h`, or backend—default code is shown to the user; they are not required to know about driver/include details.
- **Driver Code**: DO NOT define `class Node` here. It MUST be included via `#include "node.h"` DIRECTLY AFTER the other `#include` statements. DO include the `buildTree` function (if applicable) BEFORE `main()`.
- **Debugger Code**: `class Node` MUST be defined in the `----------PRE_USER_CODE_START----------` section along with libraries. `buildTree` logic MUST go inside the `----------POST_USER_CODE_START----------` section.
- **Solution Code**: DO NOT include `class Node` logic here. Just the `solution` class. Do NOT add comments about driver, `node.h`, or backend—solution code may be shown to the user.
"""
        elif language == "Python":
            node_injection_rules += """
- **Default Code**: MUST contain the `class Node` definition as a docstring comment (`\\"\\"\\"\\n...\\n\\"\\"\\"`) BELOW the imports and ABOVE `class solution`. Do NOT add comments about driver or backend—default code is user-facing.
- **Driver Code**: MUST define `class Node` (and `buildTree` if applicable) immediately AFTER the libraries.
- **Debugger Code**: `class Node` MUST be defined in the `----------PRE_USER_CODE_START----------` section along with imports. `buildTree` logic MUST go inside the `----------POST_USER_CODE_START----------` section.
- **Solution Code**: MUST NOT include `class Node` logic. `class solution` ONLY. Do NOT add comments about driver or backend—solution code may be shown to the user.
- **CRITICAL METHOD SIGNATURE**: In Python, the solution's methods MUST take `Node` as a parameter. Example: `def functionName(self, Node, arguments):`. The Driver and Debugger code must pass `Node` when calling! E.g., `sol.functionName(Node, root)`.
"""
        elif language == "Java":
            node_injection_rules += """
- **Default Code**: MUST contain the `class Node` definition commented out (`/*\\n...\\n*/`) BELOW imports and ABOVE `class Solution`. Do NOT add comments about driver or backend—default code is user-facing.
- **Driver Code**: MUST define `class Node` OUTSIDE the `Main` class. `buildTree` logic MUST go INSIDE the `Main` class.
- **Debugger Code**: MUST define `class Node` inside the `----------POST_USER_CODE_START----------` section (OUTSIDE the `Main` class). `buildTree` logic MUST go inside the `Main` class inside the `----------POST_USER_CODE_START----------` section.
- **Solution Code**: MUST NOT include `class Node` logic. `class Solution` ONLY. Do NOT add comments about driver or backend—solution code may be shown to the user.
"""
        elif language == "Node.js":
            node_injection_rules += """
- **Default Code**: MUST contain the `class Node` definition commented out (`/*\n...\n*/`) ABOVE `class Solution`. Do NOT add comments about driver or backend—default code is user-facing.
- **Driver Code**: MUST define `class Node` (and `function buildTree(...)` if applicable) immediately after the imports.
- **Solution Code**: MUST NOT include `class Node` logic. `class Solution` ONLY. Do NOT add comments about driver or backend—solution code may be shown to the user.
"""
        node_injection_rules += "\n**Node Class & BuildTree Reference (Use Exactly as shown):**\n"
        if question_type == "binary tree":
            if language == "C++":
                node_injection_rules += """
class Node {
public:
    int val;
    Node *left, *right;
    Node(int x) : val(x), left(nullptr), right(nullptr) {}
};

Node* buildTree(string str) {
    if (str.length() == 0 || str == "null") return nullptr;
    stringstream ss(str); string item; getline(ss, item, ' ');
    Node* root = new Node(stoi(item)); queue<Node*> nodeQueue; nodeQueue.push(root);
    while (!nodeQueue.empty()) {
        Node* node = nodeQueue.front(); nodeQueue.pop(); // Process left
        if (!getline(ss, item, ' ') || item == "null") node->left = nullptr;
        else { node->left = new Node(stoi(item)); nodeQueue.push(node->left); } // Process right
        if (!getline(ss, item, ' ') || item == "null") node->right = nullptr;
        else { node->right = new Node(stoi(item)); nodeQueue.push(node->right); }
    }
    return root;
}
"""
            elif language == "Python":
                node_injection_rules += """
class Node:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def buildTree(str):
    if not str or str.strip() == "null": return None
    ip = str.strip().split()
    root = Node(int(ip[0]))
    queue = [root]
    i = 1
    while queue and i < len(ip):
        currNode = queue.pop(0)
        currVal = ip[i]
        if currVal != "null":
            currNode.left = Node(int(currVal))
            queue.append(currNode.left)
        i += 1
        if i >= len(ip): break
        currVal = ip[i]
        if currVal != "null":
            currNode.right = Node(int(currVal))
            queue.append(currNode.right)
        i += 1
    return root
"""
            elif language == "Java":
                node_injection_rules += """
class Node {
    int val;
    Node left, right;
    Node(int val) {
        this.val = val;
        this.left = null;
        this.right = null;
    }
}

// Ensure buildTree is inside the Main class
private static Node buildTree(String[] arr) {
    if (arr.length == 0 || arr[0].equals("null")) return null;
    Node root = new Node(Integer.parseInt(arr[0]));
    Queue<Node> queue = new LinkedList<>();
    queue.add(root);
    int i = 1;
    while (!queue.isEmpty() && i < arr.length) {
        Node node = queue.poll();
        if (i < arr.length && !arr[i].equals("null")) {
            node.left = new Node(Integer.parseInt(arr[i]));
            queue.add(node.left);
        }
        i++;
        if (i < arr.length && !arr[i].equals("null")) {
            node.right = new Node(Integer.parseInt(arr[i]));
            queue.add(node.right);
        }
        i++;
    }
    return root;
}
"""
            elif language == "Node.js":
                node_injection_rules += """
class Node {
    constructor(val = 0, left = null, right = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
}

function buildTree(str) {
  if (!str || str === "null") return null;
  const parts = str.split(" ");
  const root = new Node(parseInt(parts[0]));
  const queue = [root];
  let i = 1;
  while (queue.length > 0 && i < parts.length) {
    const node = queue.shift();
    if (parts[i] !== "null") { node.left = new Node(parseInt(parts[i])); queue.push(node.left); }
    i++; if (i >= parts.length) break;
    if (parts[i] !== "null") { node.right = new Node(parseInt(parts[i])); queue.push(node.right); }
    i++;
  }
  return root;
}
"""
        elif question_type == "linked list":
            if language == "C++":
                node_injection_rules += """
class Node {
public:
    int val;
    Node* next;
    Node(int val, Node* next) : val(val), next(next) {}
    Node(int val) : val(val), next(nullptr) {}
};
"""
            elif language == "Python":
                node_injection_rules += """
class Node:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
"""
            elif language == "Java":
                node_injection_rules += """
class Node {
    int val;
    Node next;
    public Node(int val, Node next) {
        this.val = val;
        this.next = next;
    }
    public Node(int val) {
        this(val, null);
    }
}
"""
            elif language == "Node.js":
                node_injection_rules += """
class Node {
  constructor(val = 0, next = null) {
    this.val = val;
    this.next = next;
  }
}
"""

    if language == "Node.js":
        instantiation_rules = "**CRITICAL - STATIC METHOD REQUIREMENT:**\n- You MUST use `static` methods for the core logic functions inside the `Solution` class.\n- You MUST NOT instantiate the class in the Driver code. Call the method directly on the class.\n  - Node.js: `const result = Solution.FUNCTION_NAME();`\n"
    else:
        instantiation_rules = "**CRITICAL - INSTANTIATION REQUIREMENT:**\n- Do NOT use `static` methods for the core logic functions inside the `Solution`/`solution` class. You MUST always instantiate the class in the Driver code to call the method.\n  - Java: `Solution sol = new Solution(); int[] result = sol.functionName();` (use the constraint-appropriate type, not `long` by default)\n  - C++: `solution sol; auto result = sol.functionName();`\n  - Python: `sol = solution(); result = sol.functionName()`\n"

    system_prompt = f"""
(Role): You are an Expert Backend Engineer specializing in building coding interview platforms.
(Task): You are given a full working solution code in {language}. Your goal is to split this code into three distinct parts:
    1. **Default Code**: The initial template shown to the user. It should contain the Solution class/function definition but NO logic (use "Write your code here..." comment). it should match the reference style.
    2. **Solution Code**: The full working Solution class/function including necessary imports/libraries. **CRITICAL**: Do NOT include any top-level execution code (like `main()` calls, `readline` listeners, or `if __name__ == "__main__"`). Any input reading/execution logic must be moved to the Driver Code or inside the function if it's self-contained. **CRITICAL For Node.js**: REMOVE `const fs = require('fs');` from the Solution Code because it clashes with the Driver Code.
    3. **Driver Code**: The backend wrapper code that executes the user's solution. It MUST follow the EXACT structure provided below for the specific language.
    4. **Debugger Code**: A simplified version for local testing.

**USER-FACING CONTENT (Default Code & Solution Code):**
- Default Code and Solution Code are shown to the user. Do NOT add any comments that refer to driver code, `node.h`, includes, backend, or other implementation details the user is not required to know. Only the Node/structure reference (e.g. Node class in comments) should appear where specified; no extra notes about where it is used elsewhere.

---

**CRITICAL - DESCRIPTION I/O FORMAT PRECEDENCE:**
The generated Driver Code MUST print outputs EXACTLY as shown in the Problem Description below. 
If the description says the result is a raw string, print/cout it directly. Do NOT wrap in quotes unless explicitly shown in the Examples.
Match the return type of the main function to the output printing logic.

(Output Format):
Return a strictly valid JSON object with keys: "default_code", "solution_code", "driver_code", "debugger_code".
Do NOT return markdown. Return ONLY the JSON string.

{instantiation_rules}

PROBLEM DESCRIPTION:
{desc_response if desc_response else "N/A - Follow source code logic."}
{node_injection_rules}

{get_data_type_selection_rules()}

**CRITICAL - SIGNATURE CONSISTENCY:**
- `RETURN_TYPE`, parameter types, and driver/debugger input containers in Default Code, Solution Code, Driver Code, and Debugger Code MUST all use the same width chosen from the rules above.
- Do NOT widen types in C++ Default Code while the source solution uses `int` in Java, or vice versa.

(Specific Templates per Language):

### **Python**:
**Default Code Style** (CRITICAL: Do not use any type hints like `list` or `int` in the function signature):
```python
class solution:
    def FUNCTION_NAME(self, ARGUMENTS):
        # Write your code here...
        pass
```
**Driver Code Template**:
```python
from solution import solution
import time
import sys
import resource

file_path = sys.argv[2]
total_elapsed_time_ns = 0
sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
# [INSERT INPUT PARSING LOGIC HERE]
# Example:
# numAPIs = int(input())
# runtimes = list(map(int, input().split()))
# numApps = int(input())
# Input Area End

# Function Call Area Start
start_time_ns = time.perf_counter_ns()
result = sol.FUNCTION_NAME(ARGUMENTS) # Replace with actual function call
end_time_ns = time.perf_counter_ns()
# Function Call Area End

# Output Area Start 
# [INSERT OUTPUT PRINTING LOGIC EXACTLY AS IN SOURCE. E.g., print(result) if returning a string]
# Output Area End

# Dont change or modify any lines below this line

total_elapsed_time_ns += end_time_ns - start_time_ns
usage = resource.getrusage(resource.RUSAGE_SELF)
memory_used = usage.ru_maxrss
    
elapsed_time_seconds = total_elapsed_time_ns / 1e9

with open(file_path, 'w') as output_file:
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* {{elapsed_time_seconds:.9f}}")
    output_file.write("\\n")
    output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* {{str(memory_used)}}")
```

### **C++**:
**CRITICAL**: Use C++14 only. Do NOT use C++17-only features (e.g. structured bindings `auto [a, b, c] = ...`). Use `get<0>(t)`, `get<1>(t)` etc. for tuples.
**Default Code Style**:
```cpp
#include <bits/stdc++.h>
using namespace std;

class solution {{
    public:
    RETURN_TYPE FUNCTION_NAME(ARGUMENTS) {{
        // Write your code here...
        
    }}
}};
```
**Driver Code Template**:
```cpp
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

long getPeakRSS() {{
    struct rusage rusage;
    getrusage(RUSAGE_SELF, &rusage);
    return rusage.ru_maxrss; // Return peak memory usage in kilobytes
}}



int main(int argc, char* argv[]) {{
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    solution sol;
    auto total_duration = 0ns;

    // Dont change or modify any lines before this point
    
    // Input Area Start
    // [INSERT INPUT PARSING LOGIC HERE]
    // Input Area End

    // Function call Area Start
    auto start = high_resolution_clock::now();
    auto result = sol.FUNCTION_NAME(ARGUMENTS);
    auto stop = high_resolution_clock::now();
    // Function call Area End

    // Output Area Start
    // [INSERT OUTPUT PRINTING LOGIC EXACTLY AS IN SOURCE. E.g., cout << result << endl; if returning a string]
    // Output Area End

    // Dont change or modify any lines below this line

    total_duration += duration_cast<nanoseconds>(stop - start);
    long memory_used = getPeakRSS();
    float execution_time = total_duration.count()/1e9;
    
    const char* file_path = argv[2];
    std::ofstream output_file(file_path);
    output_file << std::fixed << std::setprecision(9);
    output_file << "*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* " << execution_time;
    output_file << "\\n";
    output_file << "*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* " << memory_used;
    output_file.close();
    return 0;
}}
```

### **Java**:
**Default Code Style**:
```java
import java.util.*;

public class Solution {{
    public static RETURN_TYPE FUNCTION_NAME(ARGUMENTS) {{
        //Write your code here...
        
    }}
}}
```
**Driver Code Template**:
```java
import java.util.*;
import java.io.FileWriter;
import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;

// [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]

public class Main {{
    static class FastReader {{
        BufferedReader br;
        StringTokenizer st;

        public FastReader() {{
            br = new BufferedReader(new InputStreamReader(System.in));
        }}

        String next() {{
            while (st == null || !st.hasMoreElements()) {{
                try {{
                    st = new StringTokenizer(br.readLine());
                }} catch (IOException e) {{
                    e.printStackTrace();
                }}
            }}
            return st.nextToken();
        }}

        int nextInt() {{
            return Integer.parseInt(next());
        }}

        long nextLong() {{
            return Long.parseLong(next());
        }}

        double nextDouble() {{
            return Double.parseDouble(next());
        }}

        String nextLine() {{
            String str = "";
            try {{
                str = br.readLine();
            }} catch (IOException e) {{
                e.printStackTrace();
            }}
            return str;
        }}
    }}

    public static long getPeakRSS() {{
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();
        return heapUsage.getUsed() / 1024; // Convert bytes to kilobytes
    }}

    public static void main(String[] args) throws IOException {{
        if (args.length < 2) {{
            System.out.println("Usage: java Main <file_path>");
            return;
        }}
        String file_path = args[1];
        long total_elapsed_time_ns = 0; 
        Solution sol = new Solution();
        FastReader sc = new FastReader();

        // Dont Remove the code of above lines in the main function or dont modify them
        // or dont change the order of the lines.

        // Input Area Start
        // [INSERT INPUT PARSING LOGIC HERE using FastReader (sc.nextInt(), sc.next(), etc.)]
        // Example:
        // int n = sc.nextInt();
        // int[] arr = new int[n];
        // for(int i=0; i<n; i++) arr[i] = sc.nextInt();
        // Input Area End

        // Function Call Area Start
        long start_time = System.nanoTime();
        // [INSERT FUNCTION CALL HERE]
        long result = sol.FUNCTION_NAME(ARGUMENTS); 
        long end_time = System.nanoTime();
        // Function Call Area End

        // Output Area Start
        // [INSERT OUTPUT PRINTING LOGIC EXACTLY AS IN SOURCE. E.g., System.out.println(result); if returning a string]
        // Output Area End

        // Dont change or modify any lines below this line
        
        total_elapsed_time_ns += (end_time - start_time);

        long memory_used = getPeakRSS();
        double execution_time = total_elapsed_time_ns / 1e9;
        FileWriter writer = new FileWriter(file_path);
        writer.write("*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* "+ execution_time);
        writer.write("\\n");
        writer.write("*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* "+ memory_used);
        writer.close();
    }}
}}
```

### **Node.js**:
**Default Code Style**:
```javascript
class Solution {{
    static FUNCTION_NAME(ARGUMENTS) {{
        //Write your code here...
        
    }}
}}
```
**Driver Code Template**:
```javascript
const fs = require("fs");
const path = require("path");

const solutionPath = path.join(__dirname, "Solution.js");

if (fs.existsSync(solutionPath)) {{
    const userCode = fs.readFileSync(solutionPath, "utf8");
    eval(userCode + "\\n; global.Solution = Solution;");
}} else {{
    console.error("Error: Solution.js not found at", solutionPath);
    process.exit(1);
}}

async function main() {{
    const filePath = process.argv[3];
    if (!filePath) {{
        console.error('Usage: node Main.js <output_file_path>');
        process.exit(1);
    }}
    let total_elapsed_time_ns = 0n;

    // Dont Remove the code of above lines in the main function or dont modify them
    // or dont change the order of the lines.


    // Input Parsing Area Start

    // [INSERT INPUT PARSING LOGIC HERE]
    // CRITICAL: Analyze the Solution class method signature.
    // Case 1: Method takes arguments (e.g., `solve(n, arr)`).
    //    -> You MUST read `fs.readFileSync(0, "utf8")`, parse the input, and pass arguments.
    // Case 2: Method takes NO arguments (e.g. `solve()`) and reads stdin itself.
    //    -> Do NOT read `fs.readFileSync`. Leave this section empty.
    
    // Example for arguments:
    // let idx = 0;
    // const input = fs.readFileSync(0, "utf8").trim().split(/\\s+/);
    // const numAPIs = parseInt(input[idx++]);
    // const result = Solution.findMaxMinRuntime(numAPIs);

    // Input Parsing Area End

    // Function Call Area Start

    const startTime = process.hrtime.bigint();
    // [INSERT FUNCTION CALL HERE based on Case 1 or Case 2]
    // const result = Solution.FUNCTION_NAME(ARGUMENTS); 
    const endTime = process.hrtime.bigint();

    // Function Call Area End

    // Output Printing Area Start

    // [INSERT OUTPUT PRINTING LOGIC EXACTLY AS IN SOURCE. E.g., console.log(result); if returning a string]

    // Output Printing Area End 

    // Dont change or modify any lines below this line

    total_elapsed_time_ns += (endTime - startTime);

    const elapsedTimeSeconds = Number(total_elapsed_time_ns) / 1e9;
    const memoryUsedKB = Math.round(process.memoryUsage().rss / 1024);
    const outputContent =
        `*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* ${{elapsedTimeSeconds.toFixed(9)}}\\n` +
        `*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* ${{memoryUsedKB}}`;

    fs.writeFile(filePath, outputContent, (err) => {{
        if (err) {{
            console.error('Error writing output file:', err);
            process.exit(1);
        }}
    }});
}}
main();
```

### **Debugger Code Templates (Python, C++, Java ONLY)**:
For Node.js, return "N/A" for `debugger_code`.

#### **Python Debugger**:
```python
----------PRE_USER_CODE_START----------
import sys
# [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
# [INSERT buildTree LOGIC HERE IF APPLICABLE]

sol = solution()

# Dont change or modify any lines before this point

# Input Area Start
# [INSERT INPUT PARSING LOGIC HERE matching Driver Code but using sys.stdin.read or input()]
# Input Area End

# Function Call Area Start
# [INSERT FUNCTION CALL HERE]
# result = sol.FUNCTION_NAME(ARGUMENTS)
# Function Call Area End

# Output Area Start 
# [INSERT OUTPUT LOGIC HERE]
# Output Area End

----------POST_USER_CODE_END----------
```

#### **C++ Debugger**:
**CRITICAL**: Do NOT add `#include "solution.cpp"` in the C++ Debugger. The debugger is for local testing; solution is not included here.
```cpp
----------PRE_USER_CODE_START----------
#include <bits/stdc++.h>
using namespace std;
// [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
// [INSERT buildTree LOGIC HERE IF APPLICABLE]

int main() {{
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    solution sol;
    // Dont change or modify any lines before this point
    
    // Input Area Start
    // [INSERT INPUT PARSING LOGIC HERE matching Driver Code]
    // Input Area End

    // Function call Area Start
    // [INSERT FUNCTION CALL HERE]
    // Function call Area End

    // Output Area Start
    // [INSERT OUTPUT LOGIC HERE]
    // Output Area End

    // Dont change or modify any lines below this line
    return 0;
}}
----------POST_USER_CODE_END----------
```

#### **Java Debugger**:
```java
----------PRE_USER_CODE_START----------
import java.util.*;
import java.io.*;
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
// [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]

public class Main {{
    static class FastReader {{
        BufferedReader br;
        StringTokenizer st;

        public FastReader() {{
            br = new BufferedReader(new InputStreamReader(System.in));
        }}

        String next() {{
            while (st == null || !st.hasMoreElements()) {{
                try {{
                    st = new StringTokenizer(br.readLine());
                }} catch (IOException e) {{
                    e.printStackTrace();
                }}
            }}
            return st.nextToken();
        }}

        int nextInt() {{
            return Integer.parseInt(next());
        }}

        long nextLong() {{
            return Long.parseLong(next());
        }}

        double nextDouble() {{
            return Double.parseDouble(next());
        }}

        String nextLine() {{
            String str = "";
            try {{
                str = br.readLine();
            }} catch (IOException e) {{
                e.printStackTrace();
            }}
            return str;
        }}
    }}

    public static void main(String[] args) throws IOException {{
        Solution sol = new Solution();
        FastReader sc = new FastReader();

        // Dont Remove the code of above lines in the main function or dont modify them
        // or dont change the order of the lines.

        // Input Area Start
        // [INSERT INPUT PARSING LOGIC HERE using FastReader]
        // Input Area End

        // Function Call Area Start
        // [INSERT FUNCTION CALL HERE]
        // Function Call Area End

        // Output Area Start
        // [INSERT OUTPUT LOGIC HERE]
        // Output Area End

    }}
    // [INSERT buildTree LOGIC HERE IF APPLICABLE]
}}
----------POST_USER_CODE_END----------
```

(Instruction):
- **Fill in the [INSERT...] sections** based on the actual arguments and return type.
- **Keep everything else EXACTLY** as shown.
- **Validation**: Ensure `Solution` class usage matches language specifics.


(Instruction):
- **Fill in the [INSERT...] sections** based on the actual arguments and return type of the provided solution code.
- **Keep everything else EXACTLY** as shown in the templates.
- **Validation**: Ensure that `Solution` class usage matches the language specifics.
"""

    user_prompt = f"""
### Full Solution Code ({language}):
{code}
"""
    return system_prompt, user_prompt
