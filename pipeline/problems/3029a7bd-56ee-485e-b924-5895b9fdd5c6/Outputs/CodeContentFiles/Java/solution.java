import java.util.*;

public class Solution {
    public String compileDiagonalLedger(int m, int n, int[][] vaultGrid) {
        HashMap<Integer, ArrayList<Integer>> diagonals = new HashMap<>();

        for (int r = 0; r < m; r++) {
            if (r % 2 == 0) {
                for (int c = 0; c < n; c++) {
                    int key = r + c;
                    diagonals.putIfAbsent(key, new ArrayList<>());
                    diagonals.get(key).add(vaultGrid[r][c]);
                }
            } else {
                for (int c = n - 1; c >= 0; c--) {
                    int key = r + c;
                    diagonals.putIfAbsent(key, new ArrayList<>());
                    diagonals.get(key).add(vaultGrid[r][c]);
                }
            }
        }

        ArrayList<Integer> keys = new ArrayList<>(diagonals.keySet());
        Collections.sort(keys);

        StringBuilder result = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            int d = keys.get(i);
            ArrayList<Integer> group = diagonals.get(d);
            Collections.sort(group);

            int size = group.size();
            String val;
            if (size % 2 == 1) {
                int median = group.get(size / 2);
                val = String.format(Locale.US, "%.2f", (double) median);
            } else {
                long sum = 0;
                for (int x : group) sum += x;
                double avg = (double) sum / size;
                val = String.format(Locale.US, "%.2f", avg);
            }

            if (i > 0) result.append(" ");
            result.append(val);
        }

        return result.toString();
    }
}