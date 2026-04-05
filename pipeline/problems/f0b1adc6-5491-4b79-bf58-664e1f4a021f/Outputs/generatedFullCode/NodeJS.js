class Solution {
  locatePairPositions(values, required) {
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
const fs = require("fs");
const input = fs.readFileSync(0, "utf-8").trim().split(/\s+/);
let idx = 0;
const n = parseInt(input[idx++], 10);
const values = [];
for (let i = 0; i < n; i++) {
  values.push(parseInt(input[idx++], 10));
}
const required = parseInt(input[idx++], 10);
const sol = new Solution();
const result = sol.locatePairPositions(values, required);
if (result.length > 0) {
  process.stdout.write(result[0] + " " + result[1] + "\n");
} else {
  process.stdout.write("-1\n");
}