import java.util.*;
import java.io.*;
class Solution {
    public List<Integer> locatePairPositions(List<Integer> values, int goal) {
        HashMap<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < values.size(); i++) {
            int num = values.get(i);
            int complement = goal - num;
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
public class Main {
    static class FastReader {
        private final InputStream in;
        private final byte[] buffer;
        private int ptr;
        private int len;
        FastReader() {
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
        int n = fr.nextInt();
        List<Integer> values = new ArrayList<>();
        for (int i = 0; i < n; i++) values.add(fr.nextInt());
        int goal = fr.nextInt();
        Solution sol = new Solution();
        List<Integer> result = sol.locatePairPositions(values, goal);
        if (!result.isEmpty()) {
            System.out.println(result.get(0) + " " + result.get(1));
        } else {
            System.out.println(-1);
        }
    }
}