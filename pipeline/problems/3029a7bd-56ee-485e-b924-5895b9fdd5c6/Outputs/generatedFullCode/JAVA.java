import java.util.*;
import java.io.*;
class Solution {
    public String compileDiagonalLedger(int m, int n, int[][] vaultGrid) {
        HashMap<Integer, ArrayList<Integer>> diagonals = new HashMap<>();
        for (int r = 0; r < m; r++) {
            if (r % 2 == 0) {
                for (int c = 0; c < n; c++) {
                    int key = r + c;
                    if (!diagonals.containsKey(key)) diagonals.put(key, new ArrayList<>());
                    diagonals.get(key).add(vaultGrid[r][c]);
                }
            } else {
                for (int c = n - 1; c >= 0; c--) {
                    int key = r + c;
                    if (!diagonals.containsKey(key)) diagonals.put(key, new ArrayList<>());
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
class FastReader {
    private final InputStream in;
    private final byte[] buffer;
    private int ptr;
    private int len;
    public FastReader() {
        in = System.in;
        buffer = new byte[1 << 16];
        ptr = 0;
        len = 0;
    }
    private int read() throws IOException {
        if (ptr >= len) {
            len = in.read(buffer);
            ptr = 0;
            if (len <= 0) return -1;
        }
        return buffer[ptr++];
    }
    public Integer nextInt() throws IOException {
        int c;
        do {
            c = read();
            if (c == -1) return null;
        } while (c <= ' ');
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
public class Main {
    public static void main(String[] args) throws Exception {
        FastReader fr = new FastReader();
        Integer mObj = fr.nextInt();
        Integer nObj = fr.nextInt();
        if (mObj == null || nObj == null) {
            System.out.print("");
            return;
        }
        int m = mObj;
        int n = nObj;
        int[][] vaultGrid = new int[m][n];
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                Integer v = fr.nextInt();
                vaultGrid[i][j] = v == null ? 0 : v;
            }
        }
        Solution sol = new Solution();
        String ans = sol.compileDiagonalLedger(m, n, vaultGrid);
        System.out.print(ans);
    }
}