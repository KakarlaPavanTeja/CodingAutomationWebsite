import java.util.*;

public class Solution {
    public String summarizeDiagonalEchoes(int[][] gridData) {
        int m = gridData.length;
        int n = m > 0 ? gridData[0].length : 0;
        Map<Integer, ArrayList<Integer>> diagonals = new HashMap<>();

        for (int r = 0; r < m; r++) {
            if (r % 2 == 0) {
                for (int c = 0; c < n; c++) {
                    int key = r + c;
                    diagonals.computeIfAbsent(key, k -> new ArrayList<>()).add(gridData[r][c]);
                }
            } else {
                for (int c = n - 1; c >= 0; c--) {
                    int key = r + c;
                    diagonals.computeIfAbsent(key, k -> new ArrayList<>()).add(gridData[r][c]);
                }
            }
        }

        ArrayList<Integer> keys = new ArrayList<>(diagonals.keySet());
        Collections.sort(keys);

        ArrayList<String> result = new ArrayList<>();
        for (int d : keys) {
            ArrayList<Integer> group = diagonals.get(d);
            Collections.sort(group);
            int size = group.size();

            if (size % 2 == 1) {
                double median = group.get(size / 2);
                result.add(String.format(Locale.US, "%.2f", median));
            } else {
                long sum = 0;
                for (int v : group) sum += v;
                double avg = (double) sum / size;
                result.add(String.format(Locale.US, "%.2f", avg));
            }
        }

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < result.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(result.get(i));
        }
        return sb.toString();
    }
}