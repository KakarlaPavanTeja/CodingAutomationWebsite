const fs = require("fs");
class Solution {
  locateResonancePair(sequence, requiredTotal) {
    const seen = new Map();
    for (let i = 0; i < sequence.length; i++) {
      const num = sequence[i];
      const complement = requiredTotal - num;
      if (seen.has(complement)) {
        return [seen.get(complement), i];
      }
      seen.set(num, i);
    }
    return [];
  }
}
const input = fs.readFileSync(0, "utf-8").trim().split(/\s+/);
let idx = 0;
const n = Number(input[idx++]);
const sequence = [];
for (let i = 0; i < n; i++) {
  sequence.push(Number(input[idx++]));
}
const requiredTotal = Number(input[idx++]);
const sol = new Solution();
const result = sol.locateResonancePair(sequence, requiredTotal);
if (result.length > 0) {
  process.stdout.write(result[0] + " " + result[1] + "\n");
} else {
  process.stdout.write("-1\n");
}