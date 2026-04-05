import java.util.*;
import java.io.*;
class Solution {
    public List<Integer> two_sum(int[] nums, int target) {
        HashMap<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int num = nums[i];
            int complement = target - num;
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
            String s = next();
            return s == null ? Integer.MIN_VALUE : Integer.parseInt(s);
        }
    }
    public static void main(String[] args) throws Exception {
        FastReader fr = new FastReader();
        int n = fr.nextInt();
        int[] nums = new int[n];
        for (int i = 0; i < n; i++) nums[i] = fr.nextInt();
        int target = fr.nextInt();
        Solution sol = new Solution();
        List<Integer> result = sol.two_sum(nums, target);
        StringBuilder out = new StringBuilder();
        if (!result.isEmpty()) {
            out.append(result.get(0)).append(" ").append(result.get(1));
        } else {
            out.append(-1);
        }
        System.out.print(out.toString());
    }
}