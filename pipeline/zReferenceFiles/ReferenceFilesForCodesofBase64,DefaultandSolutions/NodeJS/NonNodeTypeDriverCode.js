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
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node Main.js <output_file_path>');
        process.exit(1);
    }
    let total_elapsed_time_ns = 0n;

    // --- Input Parsing Area Start ---
    
    // Read the entire buffer from stdin (fd 0)
    const inputBuffer = fs.readFileSync(0);
    let offset = 0;

    // Fast integer parsing helper to avoid string splitting overhead
    function nextInt() {
        let num = 0;
        // Skip non-numeric characters
        while (offset < inputBuffer.length && (inputBuffer[offset] < 48 || inputBuffer[offset] > 57)) {
            offset++;
        }
        if (offset >= inputBuffer.length) return null;
        // Parse digits
        while (offset < inputBuffer.length && inputBuffer[offset] >= 48 && inputBuffer[offset] <= 57) {
            num = num * 10 + (inputBuffer[offset] - 48);
            offset++;
        }
        return num;
    }

    const numAPIs = nextInt();
    const runtimes = new Int32Array(numAPIs); // Using TypedArray for better memory performance
    for (let i = 0; i < numAPIs; i++) {
        runtimes[i] = nextInt();
    }
    const numApps = nextInt();

    // --- Input Parsing Area End ---

    // --- Function Call Area Start ---

    const startTime = process.hrtime.bigint();
    // Assuming findMaxMinRuntime can accept a TypedArray/Array
    const result = Solution.findMaxMinRuntime(numAPIs, runtimes, numApps);
    const endTime = process.hrtime.bigint();

    // --- Function Call Area End ---

    // --- Output Printing Area Start ---

    process.stdout.write(result.toString() + "\n");

    // --- Output Printing Area End ---

    // Dont change or modify any lines below this line
    total_elapsed_time_ns += (endTime - startTime);

    const elapsedTimeSeconds = Number(total_elapsed_time_ns) / 1e9;
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