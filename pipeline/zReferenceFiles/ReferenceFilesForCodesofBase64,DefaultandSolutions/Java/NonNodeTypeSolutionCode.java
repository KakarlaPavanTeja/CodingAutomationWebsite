import java.util.*;

public class Solution {
    public static long findMaxMinRuntime(int numAPIs, int[] runtimes, int numApps) {
        long low = 0;
        long sum = 0;
        for (int r : runtimes) sum += r;
        long high = sum; 

        long ans = 0;
        while (low <= high) {
            long mid = low + (high - low) / 2;
            if (mid == 0) {
                low = 1;
                continue;
            }

            long totalProvided = 0;
            for (int r : runtimes) {
                totalProvided += Math.min((long) r, mid);
            }

            if (totalProvided >= (long) mid * numApps) {
                ans = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return ans;
    }
}
