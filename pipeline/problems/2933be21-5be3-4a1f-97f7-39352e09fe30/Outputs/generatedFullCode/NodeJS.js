const fs = require("fs");
class Solution {
  identifyRitualPair(elements, goal) {
    const seen = {};
    for (let i = 0; i < elements.length; i++) {
      const num = elements[i];
      const complement = goal - num;
      if (Object.prototype.hasOwnProperty.call(seen, complement)) {
        return [seen[complement], i];
      }
      seen[num] = i;
    }
    return [];
  }
}
const input = fs.readFileSync(0, "utf-8").trim().split(/\s+/);
let idx = 0;
const n = Number(input[idx++]);
const elements = [];
for (let i = 0; i < n; i++) {
  elements.push(Number(input[idx++]));
}
const goal = Number(input[idx++]);
const sol = new Solution();
const result = sol.identifyRitualPair(elements, goal);
if (result.length > 0) {
  process.stdout.write(result[0] + " " + result[1] + "\n");
} else {
  process.stdout.write("-1\n");
}