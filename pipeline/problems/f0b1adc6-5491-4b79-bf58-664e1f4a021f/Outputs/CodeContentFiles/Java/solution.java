import java.util.*;

public class Solution {
    public List<Integer> locatePairPositions(int[] values, int required) {
        HashMap<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < values.length; i++) {
            int complement = required - values[i];
            if (seen.containsKey(complement)) {
                List<Integer> res = new ArrayList<>();
                res.add(seen.get(complement));
                res.add(i);
                return res;
            }
            seen.put(values[i], i);
        }
        return new ArrayList<>();
    }
}