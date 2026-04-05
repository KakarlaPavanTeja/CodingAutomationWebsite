import java.util.*;
import java.io.*;
class Solution {
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
public class Main {
    static class FastReader {
        private final InputStream in;
        private final byte[] buffer = new byte[1 << 16];
        private int ptr = 0, len = 0;
        FastReader() {
            in = System.in;
        }
        private int read() throws IOException {
            if (ptr >= len) {
                len = in.read(buffer);
                ptr = 0;
                if (len <= 0) return -1;
            }
            return buffer[ptr++];
        }
        int nextInt() throws IOException {
            int c;
            do {
                c = read();
            } while (c <= ' ' && c != -1);
            int sign = 1;
            if (c == '-') {
                sign = -1;
                c = read();
            }
            int val = 0;
            while (c > ' ') {
                val = val * 10 + (c - '0');
                c = read();
            }
            return val * sign;
        }
    }
    public static void main(String[] args) throws Exception {
        FastReader fr = new FastReader();
        int m = fr.nextInt();
        int n = fr.nextInt();
        int[][] gridData = new int[m][n];
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                gridData[i][j] = fr.nextInt();
            }
        }
        Solution sol = new Solution();
        String ans = sol.summarizeDiagonalEchoes(gridData);
        System.out.println(ans);
    }
}