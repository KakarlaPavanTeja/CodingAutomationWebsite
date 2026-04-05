class Solution {
    static locatePairPositions(values, required) {
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
