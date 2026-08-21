current project:

1. takes two files raw problem and full solution code with main function logic as well 
2. generated description, title, difficulty, solutions in all four languages with proper variable names and function names as defined in the generated description.
3. next it should take generated_description.md and python code from generated_solutions.json and use these for genearating testcases following the input and output format as in the description and solution logic from the python code in the generated_solutions.json (it should not generate a new solution and use it for generating the output, it should only use the python code from the generated_solutions.json file only)
4. enrichments content like hints, real life examples and followup questions using the generated_description.md & can take one of the solutions from the generated_solutions.json




next steps:

now in the generated solutions.json file i need to extract four content related things:

1. main (driver code) file for each language
2. default code creation (it is like template of what user sees initially)
3. Solutions code for each language
4. debugggers code for each language except for Javascript (NodeJS) -> this is not required as of now, we will work on it later

check the contentfiles folder where you see three subfolders which contains standard, linkedtype & binarytype codes.

for standard type

the full codes can be:
1. libraries
2. Class solution and any other code which is used in the class solution, for example create a new class outside the solution class to use in the class solution then it is required to include in the solution code along with class solution
3. main function and other functions which are required for main to work and support for input/output


what is the driver code??

- the libraries and main & other functions codes should be added in driver codes 


what is the solution code?

- class solution will be separated in solutions code and libraries 
    libraries - cpp -> bits/std one and using namespace
                for python -> depending on libraries required for class solution (not the main), for example if class solution code uses
                for java -> import java.util.*; and anyother libraries which are required in the class solution but in very rare cases it is required 
                similar for node Js, any libraries which are relevant for class solution, it should be added in the solution code 

    the libraries are not moved, it is just repeated in both solution code and driver codes

what is the default code??
the solution code which only logic part is completely remove and only function which user need to complete is shown with comment "Write Your Code Here ..." and it also include the libraries for cpp and java only 

cpp -> bits & using namespace & for java -> import java.util.*;

Now similar for binary tree & linked list type question:

all are similar to standard, but just one change is that the Node class is shown to the user in comments between class solution and libraries for them to understand the class node details and variables declared.

with these, lets create four files (for each language - cpp, python, java and nodeJS) which contains the codes divided with the rules mentioned above


refer the prompt below which takes a full working code of JS and provides three things:

1. default code (only function with comment "Write Your Code Here ...")
2. solution code (class solution + libraries)
3. driver code (main + other functions + libraries)

Now similar to this and improvise this to work for generating all such files for all four languages (cpp, python, java and nodeJS) using the codes from generated_solutions.json file

this generation should be done for each language separately and the output should be stored in the contentfiles folder in the respective language folder


basically there is a full working code in the generated_solutions.json file for each language, now i need to split that code into three parts as mentioned above and store them in the contentfiles folder in the respective language folder

You are given:
1️⃣ User’s Real Logic Code
Your task is to insert the user logic into the provided backend wrapper WITHOUT breaking performance tracking or backend structure.
📦 BACKEND WRAPPER CODE (DO NOT MODIFY STRUCTURE)
⚠️ You may only edit:
* `class Solution`
* The logic section inside `main()`
Everything else must remain unchanged.

```js
const fs = require("fs");
const path = require("path");

const solutionPath = path.join(__dirname, "Solution.js");

class Solution {
    // USER LOGIC WILL GO HERE
}

if (fs.existsSync(solutionPath)) {
    const userCode = fs.readFileSync(solutionPath, "utf8");
    eval(userCode + "\n; global.Solution = Solution;");
} else {
    console.error("Error: Solution.js not found at", solutionPath);
    process.exit(1);
}

// Helper to read all stdin as string
function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
    });
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node main.js <output_file_path>');
        process.exit(1);
    }

    // ===== INPUT PARSING AREA (YOU MAY EDIT THIS PART) =====


    // ===== END INPUT PARSING AREA =====

    const startTime = process.hrtime.bigint();

    // ===== FUNCTION CALL AREA (YOU MUST EDIT THIS PART) =====


    // ===== END FUNCTION CALL AREA =====

    const endTime = process.hrtime.bigint();

    console.log(result);

    const elapsedTimeSeconds = Number(endTime - startTime) / 1e9;
    const memoryUsedKB = process.resourceUsage().maxRSS;
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

```

👇 USER REAL CODE (PASTE BELOW)

```js
/* ===== PASTE USER REAL CODE HERE ===== */


/* ===== END USER REAL CODE ===== */

```

🔒 STRICT IMPLEMENTATION RULES
✅ 1. Move Logic into `Solution` Class
Convert all user functions into static methods
Example
User code:

```js
function digitSumToSingle(n) { ... }

```

Backend version:

```js
class Solution {
    static digitSumToSingle(n) { ... }
}

```

❌ No global functions allowed
✅ 2. Function Call Must Be Inside Timer Block ONLY

```js
const startTime = process.hrtime.bigint();

// CALL USER FUNCTION HERE
const result = Solution.functionName(arguments);

const endTime = process.hrtime.bigint();

```

✅ 3. Printing Must Be AFTER `endTime`

```js
const endTime = process.hrtime.bigint();
console.log(result);

```

✅ 4. Input Parsing Must Happen Before Timer
Example:

```js
const input = fs.readFileSync(0, "utf8").trim();
const n = Number(input);

```

✅ 5. Remove User `main()` if Present
Only backend `main()` should exist.
❌ NEVER MODIFY
* Performance timers
* Memory tracking
* File writing
* `readStdin()`
* Backend structure