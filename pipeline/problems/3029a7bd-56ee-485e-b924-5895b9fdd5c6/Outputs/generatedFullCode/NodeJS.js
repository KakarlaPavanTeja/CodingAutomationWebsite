const fs = require("fs");
class Solution {
    compileDiagonalLedger(m, n, vaultGrid) {
        const diagonals = new Map();
        for (let r = 0; r < m; r++) {
            if (r % 2 === 0) {
                for (let c = 0; c < n; c++) {
                    const key = r + c;
                    if (!diagonals.has(key)) {
                        diagonals.set(key, []);
                    }
                    diagonals.get(key).push(vaultGrid[r][c]);
                }
            } else {
                for (let c = n - 1; c >= 0; c--) {
                    const key = r + c;
                    if (!diagonals.has(key)) {
                        diagonals.set(key, []);
                    }
                    diagonals.get(key).push(vaultGrid[r][c]);
                }
            }
        }
        const keys = Array.from(diagonals.keys()).sort((a, b) => a - b);
        const result = [];
        for (let i = 0; i < keys.length; i++) {
            const d = keys[i];
            const group = diagonals.get(d).slice().sort((a, b) => a - b);
            const size = group.length;
            if (size % 2 === 1) {
                const median = group[Math.floor(size / 2)];
                result.push(median.toFixed(2));
            } else {
                let sum = 0;
                for (let j = 0; j < size; j++) {
                    sum += group[j];
                }
                const avg = sum / size;
                result.push(avg.toFixed(2));
            }
        }
        return result.join(" ");
    }
}
const input = fs.readFileSync(0, "utf-8").trim();
if (input.length > 0) {
    const tokens = input.split(/\s+/);
    let idx = 0;
    const m = parseInt(tokens[idx++], 10);
    const n = parseInt(tokens[idx++], 10);
    const matrix = [];
    for (let i = 0; i < m; i++) {
        const row = [];
        for (let j = 0; j < n; j++) {
            row.push(parseInt(tokens[idx++], 10));
        }
        matrix.push(row);
    }
    const sol = new Solution();
    const result = sol.compileDiagonalLedger(m, n, matrix);
    process.stdout.write(result + "\n");
}