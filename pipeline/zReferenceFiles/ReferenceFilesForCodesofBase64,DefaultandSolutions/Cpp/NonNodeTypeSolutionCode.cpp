#include <bits/stdc++.h>
using namespace std;

class solution {
public:
    long long findMaxMinRuntime(int numAPIs, vector<int>& runtimes, int numApps) {
        long long low = 0;
        long long high = 0;
        for (int x : runtimes) high += x;
        high /= numApps;
        long long ans = 0;
        
        high = 2e14;
        auto check = [&](long long mid) {
            long long total_provided = 0;
            for (int r : runtimes) {
                total_provided += min((long long)r, mid);
            }
            return total_provided >= (mid * numApps);
        };

        while (low <= high) {
            long long mid = low + (high - low) / 2;
            if (mid == 0) {
                low = 1;
                continue;
            }
            if (check(mid)) {
                ans = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return ans;
    }
};
