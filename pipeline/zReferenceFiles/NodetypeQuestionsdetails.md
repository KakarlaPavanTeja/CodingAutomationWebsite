we have other type of coding question node type for linked list or binary tree type questions 

for both of these questions we have class Node defined across all languages which should not be changed 

Binary tree class Node:

CPP:
class Node {
    int data;
    Node* left;
    Node* right;
    Node(int data) : data(data), left(nullptr), right(nullptr) {}
};

Python:

 class Node:
    def __init__(self, data):
        self.data = data
        self.left = None
        self.right = None    


Java:

class Node {
    int data;
    Node left, right;

    Node(int data) {
        this.data = data;
        this.left = null;
        this.right = null;
    }
}


JS:

class Node {
    constructor(data) {
        this.data = data;
        this.left = null;
        this.right = null;
    }
}


Linked List:

CPP:

class Node {
public:
    int data;
    Node* next;
    Node(int data, Node* next) : data(data), next(next) {}
    Node(int data) : data(data), next(nullptr) {}
};

Python:

class Node:
    def __init__(self, data, next=None):
        self.data = data
        self.next = next

Java:

class Node {
    int data;
    Node next;

    public Node(int data, Node next) {
        this.data = data;
        this.next = next;
    }

    public Node(int data) {
        this(data, null);
    }
}

JS:

class Node {
  constructor(data, next = null) {
    this.data = data;
    this.next = next;
  }
}


Differences:

Default code:

All languages will have this class Node in comments defined after libraries and below the class solution

same works for linked list and binary tree 

CPP:

libraries

/*
class Node (full class )
*/

class solution

Python:

if any libraries

"""
class Node (full class )
"""

class solution

Java:

libraries

/*
class Node (full class )
*/

class Solution

JS:

if any libraries

/*
class Node (full class )
*/

class Solution


Next:

Base64s:

the CPP has class Node defined separately in a node.h file and added in lines between 

node.h file

---

#ifndef NODE_CPP
#define NODE_CPP

class Node (same for linked list and binary tree)

#endif

---


Python:

it will be defined in the base64 file itself right after the libraries

Java:
it will be defined in the base64 file itself right after the libraries

JS:
it will be defined in the base64 file itself right after the libraries


debuggers:

As JS has no debug ignore it

for CPP:
the class node will be defined in the pre user code along with libraries

for python:
the class node will be defined in the pre user code along with libraries

for java:
the class node will be defined in the post user code along with libraries (only difference)

Solutions:
it is not required to add the class node logic in the solutions 

Last but not least:
In python: always pass the Node class as argument to the function in the class solution

Example:

class solution:
    def leftviewofBinarytree(self, Node, root):

print(sol.leftviewofBinarytree(Node, root))

this apply for solution code, default code, debuggers and base64 as well (it should be not removed)



always use below buildtree function for building binary tree and binary search tree questions (typical ones) but if needed, can modify it according to the problem

CPP:

Node* buildTree(string str) {
    if (str.length() == 0 || str == "null") {
        return nullptr;
    }

    stringstream ss(str);
    string item;
    getline(ss, item, ' ');
    Node* root = new Node(stoi(item));
    queue<Node*> nodeQueue;
    nodeQueue.push(root);

    while (!nodeQueue.empty()) {
        Node* node = nodeQueue.front();
        nodeQueue.pop();

        // Process left child
        if (!getline(ss, item, ' ') || item == "null") {
            node->left = nullptr;
        } else {
            node->left = new Node(stoi(item));
            nodeQueue.push(node->left);
        }

        // Process right child
        if (!getline(ss, item, ' ') || item == "null") {
            node->right = nullptr;
        } else {
            node->right = new Node(stoi(item));
            nodeQueue.push(node->right);
        }
    }

    return root;
}


Python:


def buildTree(str):
    if not str or str.strip() == "null":
        return None
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
        if i >= len(ip):
            break
        currVal = ip[i]
        if currVal != "null":
            currNode.right = Node(int(currVal))
            queue.append(currNode.right)
        i += 1
    return root


Java in main class:

static Node buildTree(String str) {
    if (str.length() == 0 || str.equals("null")) {
        return null;
    }
    String[] parts = str.split(" ");
    Queue<Node> nodeQueue = new LinkedList<>();
    Node root = new Node(Integer.parseInt(parts[0]));
    nodeQueue.add(root);
    int i = 1;
    while (!nodeQueue.isEmpty() && i < parts.length) {
        Node node = nodeQueue.remove();
        if (!parts[i].equals("null")) {
            node.left = new Node(Integer.parseInt(parts[i]));
            nodeQueue.add(node.left);
        }
        i++;
        if (i >= parts.length) break;
        if (!parts[i].equals("null")) {
            node.right = new Node(Integer.parseInt(parts[i]));
            nodeQueue.add(node.right);
        }
        i++;
    }
    return root;
}


JS:

function buildTree(str) {
  if (!str || str === "null") return null;

  const parts = str.split(" ");
  const root = new Node(parseInt(parts[0]));
  const queue = [root];
  let i = 1;

  while (queue.length > 0 && i < parts.length) {
    const node = queue.shift();

    if (parts[i] !== "null") {
      node.left = new Node(parseInt(parts[i]));
      queue.push(node.left);
    }
    i++;

    if (i >= parts.length) break;

    if (parts[i] !== "null") {
      node.right = new Node(parseInt(parts[i]));
      queue.push(node.right);
    }
    i++;
  }

  return root;
}




All remember the input format in the description for binary tree or BST type questions will be always be mentioned as well 

**Input Format:**
 
- The first line contains space-separated values, representing the data elements of the nodes.

- Where `null` represents the null value or no node.


for linked list type questions:

example the input format will be as follows:

**Input Format:**

- The first line contains an integer `n` representing the number of nodes in the singly linked list.

- The second line contains `n` space-separated values representing the data elements of the nodes in the singly linked list.


but depending on the problem, the format can be changed accordingly with the above as reference 


template for LUA file :

----------QUESTION_DESCRIPTION_START----------

----------QUESTION_DESCRIPTION_END----------

----------SHORT_TEXT_START----------

----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------

----------QUESTION_LEVEL_END----------

----------COMPANIES_START----------

----------COMPANIES_END----------

----------DEFAULT_TAGS_START----------

----------DEFAULT_TAGS_END----------

----------BEGINNER_TOPICS_START----------

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

----------CODE_CONTENT_CPP_END----------

----------CODE_CONTENT_PYTHON_START----------

----------CODE_CONTENT_PYTHON_END----------

----------CODE_CONTENT_JAVA_START----------

----------CODE_CONTENT_JAVA_END----------

----------CODE_CONTENT_NODE_JS_START----------

----------CODE_CONTENT_NODE_JS_END----------

----------DEBUG_HELPER_CODE_CPP_START----------

----------PRE_USER_CODE_START----------

----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------

----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_CPP_END----------

----------DEBUG_HELPER_CODE_PYTHON_START----------

----------PRE_USER_CODE_START----------

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

----------CODE_BASE64_CPP_END----------

----------NODE_H_CONTENT_START----------

----------NODE_H_CONTENT_END----------

----------CODE_BASE64_PYTHON_START----------

----------CODE_BASE64_PYTHON_END----------

----------CODE_BASE64_JAVA_START----------

----------CODE_BASE64_JAVA_END----------

----------CODE_BASE64_NODE_JS_START----------

----------CODE_BASE64_NODE_JS_END----------

----------SOLUTIONS_CPP_START----------

----------SOLUTIONS_CPP_END----------

----------SOLUTIONS_PYTHON_START----------

----------SOLUTIONS_PYTHON_END----------

----------SOLUTIONS_JAVA_START----------

----------SOLUTIONS_JAVA_END----------

----------SOLUTIONS_NODE_JS_START----------

----------SOLUTIONS_NODE_JS_END----------



template with content:

----------QUESTION_DESCRIPTION_START----------
Given two integer arrays, `inorder` and `postorder`, representing the inorder and postorder traversals of a binary tree, respectively, construct and return the corresponding binary tree.

**Example 1:**

Given a Tree:
<img src="https://new-assets.ccbp.in/frontend/content/dsa/PreorderInorderTreeBuild_ex1.png", alt="PreorderInorderTreeBuild_ex1", height="30%", width="300px"/>


**Input:**

``` 
inorder = [10,5,25,20,30], postorder = [10,25,30,20,5]
```

**Output:**

```
5 10 20 null null 25 30
```

**Explanation:**

- The reconstructed binary tree's level-order traversal is `5 10 20 null null 25 30`, matching the given inorder and postorder sequences.

**Example 2:**

**Input:**

```
inorder = [1], postorder = [1]
```

**Output:**

```
1
```

**Explanation:**


- The reconstructed binary tree's level-order traversal is `1`, matching the given inorder and postorder sequences.

**Your Task**

- Complete the provided function `buildBinaryTree` that takes two arguments:
  
  - `inorder`: An array of integers representing the inorder traversal of a binary tree.
  
  - `postorder`: An array of integers representing the postorder traversal of the binary tree.

- The function should return the root node of the constructed binary tree.

**Constraints:**

- `1` <= `inorder.length` <= `2000`

- `inorder.length` == `postorder.length`

- `-2000` <= `inorder[i]`, `postorder[i]` <= `2000`

- `inorder` and `postorder` consist of unique values.

- Each value of `inorder` also appears in `postorder`.

- `inorder` is guaranteed to be the inorder traversal of the tree.

- `postorder` is guaranteed to be the postorder traversal of the tree.


**Input Format:**

- The first line contains an integer `n` representing the number of elements in the inorder and postorder arrays.

- The second line contains `n` space-separated integers representing the elements of the inorder traversal.

- The third line contains `n` space-separated integers representing the elements of the postorder traversal.


**Output Format:**

- The output is a single line containing the level-order traversal of the binary tree.
----------QUESTION_DESCRIPTION_END----------

----------SHORT_TEXT_START----------
Inorder Postorder Tree Build
----------SHORT_TEXT_END----------

----------QUESTION_LEVEL_START----------
MEDIUM
----------QUESTION_LEVEL_END----------

----------COMPANIES_START----------
WALMARTLABS, GOOGLE, MICROSOFT, AMAZON, BLOOMBERG, ADOBE, APPLE
----------COMPANIES_END----------

----------DEFAULT_TAGS_START----------

----------DEFAULT_TAGS_END----------

----------BEGINNER_TOPICS_START----------
Array
----------BEGINNER_TOPICS_END----------

----------INTERMEDIATE_TOPICS_START----------

----------INTERMEDIATE_TOPICS_END----------

----------ADVANCED_TOPICS_START----------
Trees
----------ADVANCED_TOPICS_END----------

----------REAL_LIFE_EXAMPLES_START----------
1. Fun Fact: This problem is directly relevant in the world of computer graphics and rendering
2. Particularly, it's used in algorithms for "Binary Space Partitioning" - a method often employed in 3D computer graphics for rendering scenes with a large number of overlapping objects
3. Constructing binary trees using preorder and inorder traversals is crucial in defining the ordering and space divisions
4. Not to forget, such problems also have substantial uses in designing compilers and databases
----------REAL_LIFE_EXAMPLES_END----------

----------FOLLOW_UP_QUESTIONS_START----------

----------FOLLOW_UP_QUESTION_START_1----------

----------QUESTION_START----------
Where might the principles of reconstructing a binary tree from traversals be applied in practical scenarios?
----------QUESTION_END----------

----------ANSWER_START----------
This technique is useful in deserializing tree structures for data transfer or storage, and in compilers for reconstructing Abstract Syntax Trees (ASTs) from token streams.
----------ANSWER_END----------

----------FOLLOW_UP_QUESTION_END_1----------

----------FOLLOW_UP_QUESTIONS_END----------

----------HINTS_START----------

----------HINTS_START_1----------
The last element of the postorder traversal represents the root of the current subtree. Find this root in the inorder traversal to identify its left and right subtrees.
----------HINTS_END_1----------

----------HINTS_START_2----------
Recursively construct the left and right subtrees by applying the same logic to their respective subarrays from the postorder and inorder traversals.
----------HINTS_END_2----------

----------HINTS_END----------

----------CODE_CONTENT_CPP_START----------
#include <bits/stdc++.h>
using namespace std;
/*
class Node {
    int data;
    Node* left;
    Node* right;
    Node(int data) : data(data), left(nullptr), right(nullptr) {}
};
*/

class solution {
public:
    Node* buildBinaryTree(vector<int>& inorder, vector<int>& postorder) {
        //Write your code here...
        
        
    }
};
----------CODE_CONTENT_CPP_END----------

----------CODE_CONTENT_PYTHON_START----------
'''       
 class Node:
    def __init__(self, data):
        self.data = data
        self.left = None
        self.right = None       
 '''
 
class solution:
    def buildBinaryTree(self, inorder, postorder):
        #Write your code here...
        pass
----------CODE_CONTENT_PYTHON_END----------

----------CODE_CONTENT_JAVA_START----------
import java.util.*;
/*
class Node {
    int data;
    Node left, right;

    Node(int data) {
        this.data = data;
        this.left = null;
        this.right = null;
    }
}
*/

public class Solution {
    public static Node buildBinaryTree(List<Integer> inorder, List<Integer> postorder) {
        //Write your code here...
        
        
    }
}
----------CODE_CONTENT_JAVA_END----------

----------CODE_CONTENT_NODE_JS_START----------
/*
class Node {
    constructor(data) {
        this.data = data;
        this.left = null;
        this.right = null;
    }
}
*/

class Solution {
    static buildBinaryTree(inorder, postorder) {
        //Write your code here...
        
        
    }
}
----------CODE_CONTENT_NODE_JS_END----------

----------DEBUG_HELPER_CODE_CPP_START----------

----------PRE_USER_CODE_START----------
Cpp pre user code
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
Cpp post user code
----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_CPP_END----------

----------DEBUG_HELPER_CODE_PYTHON_START----------

----------PRE_USER_CODE_START----------
Python pre user code
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
Python post user code
----------POST_USER_CODE_END----------

----------DEBUG_HELPER_CODE_PYTHON_END----------

----------DEBUG_HELPER_CODE_JAVA_START----------

----------PRE_USER_CODE_START----------
Java pre user code
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
Java post user code
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
#include "node.h"
using namespace std;
using namespace std::chrono;
#include "solution.cpp"



long getPeakRSS() {
    struct rusage rusage;
    getrusage(RUSAGE_SELF, &rusage);
    return rusage.ru_maxrss; // Return peak memory usage in kilobytes
}


// Function to print level-order traversal
void printLevelOrder(Node* root) {
    if (!root) return;

    queue<Node*> q;
    q.push(root);

    while (!q.empty()) {
        int levelSize = q.size();
        bool isAnyChildNodePresent = false; // Flag to check if there's at least one real child

        for (int i = 0; i < levelSize; i++) {
            Node* node = q.front();
            q.pop();

            if (node) {
                cout << node->data << " ";
                q.push(node->left);
                q.push(node->right);
                if (node->left || node->right) {
                    isAnyChildNodePresent = true; // If node has children, continue processing next level
                }
            } else {
                cout << "null ";
            }
        }

        // If no children exist in the next level, stop printing additional nulls
        if (!isAnyChildNodePresent) {
            break;
        }
    }
}

int main(int argc, char* argv[]) {
    
    int n;
    cin >> n;

    vector<int> inorder(n), postorder(n);
    for (int i = 0; i < n; i++) cin >> inorder[i];
    for (int i = 0; i < n; i++) cin >> postorder[i];



    solution sol;
    
    auto start = high_resolution_clock::now();
    Node* root = sol.buildBinaryTree(inorder, postorder);
    auto stop = high_resolution_clock::now();
    
    printLevelOrder(root);
    long memory_used = getPeakRSS();
    auto duration = duration_cast<nanoseconds>(stop - start);
    float execution_time = duration.count()/1e9;
    
      try{
         const char* file_path = argv[2];
         std::ofstream output_file(file_path);
         output_file << std::fixed << std::setprecision(9);
         output_file << "*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* " << execution_time;
         output_file << "\n";
         output_file << "*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* " << memory_used;
         output_file.close();
      }
     catch(...){
     }
    return 0;
}
----------CODE_BASE64_CPP_END----------

----------NODE_H_CONTENT_START----------
class Node {
    int data;
    Node* left;
    Node* right;
    Node(int data) : data(data), left(nullptr), right(nullptr) {}
};
----------NODE_H_CONTENT_END----------

----------CODE_BASE64_PYTHON_START----------
from solution import solution
import time
import sys
import resource
from collections import deque

class Node:
    def __init__(self, data):
        self.data = data
        self.left = None
        self.right = None


        
        

# Function to print level-order traversal
def printLevelOrder(root):
    if not root:
        return

    queue = deque([root])

    while queue:
        levelSize = len(queue)
        isAnyChildNodePresent = False  # Flag to check if there's at least one real child

        for _ in range(levelSize):
            node = queue.popleft()

            if node:
                print(node.data, end=" ")
                queue.append(node.left)
                queue.append(node.right)
                if node.left or node.right:
                    isAnyChildNodePresent = True  # If node has children, continue processing next level
            else:
                print("null", end=" ")

        if not isAnyChildNodePresent:
            break



if __name__ == "__main__":        
    file_path = sys.argv[2]
    n = int(input())
    inorder = list(map(int, input().split()))
    postorder = list(map(int, input().split()))

    start_time_ns = time.perf_counter_ns()
    sol = solution()
    root = sol.buildBinaryTree(inorder, postorder)
    end_time_ns = time.perf_counter_ns()
    
    printLevelOrder(root)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    memory_used = usage.ru_maxrss  # Maximum resident set size used (in kilobytes)
        
    elapsed_time_ns = end_time_ns - start_time_ns
    elapsed_time_seconds = elapsed_time_ns / 1e9
    with open(file_path, 'w') as output_file:
        output_file.write(f"*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* {elapsed_time_seconds:.9f}")
        output_file.write("\n")
        output_file.write(
            f"*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* {str(memory_used)}")
----------CODE_BASE64_PYTHON_END----------

----------CODE_BASE64_JAVA_START----------
import java.util.*;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;

class Node {
    int data;
    Node left, right;

    Node(int data) {
        this.data = data;
        this.left = null;
        this.right = null;
    }
}



public class Main {
    public static long getPeakRSS() {
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();
        return heapUsage.getUsed() / 1024; // Convert bytes to kilobytes
    }

    // Function to print level-order traversal
    public static void printLevelOrder(Node root) {
        if (root == null) {
            return;
        }
    
        Queue<Node> queue = new LinkedList<>();
        queue.add(root);
    
        while (!queue.isEmpty()) {
            int levelSize = queue.size();
            boolean isAnyChildNodePresent = false;  // Flag to check if there's at least one real child
    
            for (int i = 0; i < levelSize; i++) {
                Node node = queue.poll();
    
                if (node != null) {
                    System.out.print(node.data + " ");
                    queue.add(node.left);
                    queue.add(node.right);
                    if (node.left != null || node.right != null) {
                        isAnyChildNodePresent = true;  // If node has children, continue processing next level
                    }
                } else {
                    System.out.print("null ");
                }
            }
    
            if (!isAnyChildNodePresent) {
                break;
            }
        }
    }

    
    public static void main(String[] args) {
        if (args.length < 2) {
            System.out.println("Usage: java Main <file_path>");
            return;
        }

        String filePath = args[1];
        Scanner scanner = new Scanner(System.in);

        int n = scanner.nextInt();
        List<Integer> preorder = new ArrayList<>();
        List<Integer> inorder = new ArrayList<>();

        for (int i = 0; i < n; i++) {
            preorder.add(scanner.nextInt());
        }
        for (int i = 0; i < n; i++) {
            inorder.add(scanner.nextInt());
        }



        Solution sol = new Solution();
        long startTime = System.nanoTime();
        Node root = sol.buildBinaryTree(preorder, inorder);
        long endTime = System.nanoTime();
        printLevelOrder(root);
        long memory_used = getPeakRSS();
        scanner.close();
        double executionTime = (endTime - startTime) / 1e9;
        
        try (FileWriter writer = new FileWriter(filePath)) {
            writer.write("*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* " + executionTime);
            writer.write("\n");
            writer.write("*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* " + memory_used);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
----------CODE_BASE64_JAVA_END----------

----------CODE_BASE64_NODE_JS_START----------
const fs = require("fs");
const path = require("path");

class Node {
    constructor(data) {
        this.data = data;
        this.left = null;
        this.right = null;
    }
}

const solutionPath = path.join(__dirname, "Solution.js");

if (fs.existsSync(solutionPath)) {
    const userCode = fs.readFileSync(solutionPath, "utf8");
    eval(userCode + "\n; global.Solution = Solution;");
} else {
    console.error("Error: Solution.js not found at", solutionPath);
    process.exit(1);
}

// Function to print level-order traversal
function printLevelOrder(root) {
    if (!root) return;

    const queue = [root];

    while (queue.length > 0) {
        const levelSize = queue.length;
        let isAnyChildNodePresent = false;

        for (let i = 0; i < levelSize; i++) {
            const node = queue.shift();

            if (node) {
                process.stdout.write(node.data + " ");
                queue.push(node.left);
                queue.push(node.right);
                if (node.left || node.right) {
                    isAnyChildNodePresent = true;
                }
            } else {
                process.stdout.write("null ");
            }
        }

        if (!isAnyChildNodePresent) {
            break;
        }
    }
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node Main.js <output_file_path>');
        process.exit(1);
    }

    const input = fs.readFileSync(0, "utf8").trim().split(/\s+/);
    let idx = 0;

    const n = parseInt(input[idx++]);
    const inorder = [];
    const postorder = [];

    for (let i = 0; i < n; i++) {
        inorder.push(parseInt(input[idx++]));
    }
    for (let i = 0; i < n; i++) {
        postorder.push(parseInt(input[idx++]));
    }

    const startTime = process.hrtime.bigint();
    const root = Solution.buildBinaryTree(inorder, postorder);
    const endTime = process.hrtime.bigint();

    printLevelOrder(root);

    const memoryUsedKB = process.resourceUsage().maxRSS;
    const elapsedTimeNs = endTime - startTime;
    const elapsedTimeSeconds = Number(elapsedTimeNs) / 1e9;

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
Cpp solution code
----------SOLUTIONS_CPP_END----------

----------SOLUTIONS_PYTHON_START----------
Python solution code
----------SOLUTIONS_PYTHON_END----------

----------SOLUTIONS_JAVA_START----------
Java solution code
----------SOLUTIONS_JAVA_END----------

----------SOLUTIONS_NODE_JS_START----------
Node JS solution code
----------SOLUTIONS_NODE_JS_END----------