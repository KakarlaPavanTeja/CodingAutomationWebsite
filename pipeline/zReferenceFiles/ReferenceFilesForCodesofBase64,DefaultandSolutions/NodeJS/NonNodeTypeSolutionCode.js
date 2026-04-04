class Solution {
    static findMaxMinRuntime(numAPIs, runtimes, numApps) {
        let low = 0;
        let high = runtimes.reduce((sum, r) => sum + r, 0);
        
        let ans = 0;
        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (mid === 0) {
                low = 1;
                continue;
            }
            
            let totalProvided = runtimes.reduce((sum, r) => sum + Math.min(r, mid), 0);
            
            if (totalProvided >= mid * numApps) {
                ans = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return ans;
    }
}
