const fs = require("fs");
class Solution {
  summarizeDiagonalEchoes(gridData) {
    const m = gridData.length;
    const n = m > 0 ? gridData[0].length : 0;
    const diagonals = new Map();
    for (let r = 0; r < m; r++) {
      if (r % 2 === 0) {
        for (let c = 0; c < n; c++) {
          const key = r + c;
          if (!diagonals.has(key)) {
            diagonals.set(key, []);
          }
          diagonals.get(key).push(gridData[r][c]);
        }
      } else {
        for (let c = n - 1; c >= 0; c--) {
          const key = r + c;
          if (!diagonals.has(key)) {
            diagonals.set(key, []);
          }
          diagonals.get(key).push(gridData[r][c]);
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
        result.push(Number(median).toFixed(2));
      } else {
        let total = 0;
        for (let j = 0; j < size; j++) {
          total += group[j];
        }
        const avg = total / size;
        result.push(avg.toFixed(2));
      }
    }
    return result.join(" ");
  }
}
const input = fs.readFileSync(0, "utf-8").trim();
if (input.length === 0) {
  process.stdout.write("");
} else {
  const tokens = input.split(/\s+/).map(Number);
  let idx = 0;
  const m = tokens[idx++];
  const n = tokens[idx++];
  const matrix = [];
  for (let i = 0; i < m; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      row.push(tokens[idx++]);
    }
    matrix.push(row);
  }
  const sol = new Solution();
  const result = sol.summarizeDiagonalEchoes(matrix);
  process.stdout.write(result + "\n");
}