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