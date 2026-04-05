import java.util.*;
import java.io.*;
class Solution {
    public List<Integer> locateResonancePair(List<Integer> sequence, int requiredTotal) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < sequence.size(); i++) {
            int num = sequence.get(i);
            int complement = requiredTotal - num;
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
        String next() throws IOException {
            StringBuilder sb = new StringBuilder();
            int c;
            do {
                c = read();
                if (c == -1) return null;
            } while (c <= ' ');
            while (c > ' ') {
                sb.append((char) c);
                c = read();
            }
            return sb.toString();
        }
        int nextInt() throws IOException {
            String s = this.next();
            return s == null ? Integer.MIN_VALUE : Integer.parseInt(s);
        }
    }
    public static void main(String[] args) throws Exception {
        FastReader fr = new FastReader();
        int n = fr.nextInt();
        List<Integer> sequence = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            sequence.add(fr.nextInt());
        }
        int requiredTotal = fr.nextInt();
        Solution sol = new Solution();
        List<Integer> result = sol.locateResonancePair(sequence, requiredTotal);
        if (!result.isEmpty()) {
            System.out.println(result.get(0) + " " + result.get(1));
        } else {
            System.out.println(-1);
        }
    }
}