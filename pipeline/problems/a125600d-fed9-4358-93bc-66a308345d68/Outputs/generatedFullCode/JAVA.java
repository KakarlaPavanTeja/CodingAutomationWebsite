import java.util.*;
import java.io.*;
class Solution {
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
    public int nextInt() throws IOException {
        int c;
        do {
            c = this.read();
        } while (c <= ' ' && c != -1);
        int sign = 1;
        if (c == '-') {
            sign = -1;
            c = this.read();
        }
        int val = 0;
        while (c > ' ') {
            val = val * 10 + (c - '0');
            c = this.read();
        }
        return val * sign;
    }
}
public class Main {
    public static void main(String[] args) throws Exception {
        FastReader fr = new FastReader();
        int n = fr.nextInt();
        int[] nums = new int[n];
        for (int i = 0; i < n; i++) nums[i] = fr.nextInt();
        int target = fr.nextInt();
        Solution sol = new Solution();
        List<Integer> result = sol.locatePairPositions(nums, target);
        StringBuilder sb = new StringBuilder();
        if (!result.isEmpty()) {
            sb.append(result.get(0)).append(" ").append(result.get(1));
        } else {
            sb.append(-1);
        }
        System.out.println(sb.toString());
    }
}