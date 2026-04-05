import java.util.*;

public class Solution {
    public List<Integer> locatePairPositions(int[] values, int required) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < values.length; i++) {
            int num = values[i];
            int complement = required - num;
            if (seen.containsKey(complement)) {
                List<Integer> res = new ArrayList<>();
                res.add(seen.get(complement));
                res.add(i);
                return res;
            }
            seen.put(num, i);
        }
        return new ArrayList<>();
    }
}