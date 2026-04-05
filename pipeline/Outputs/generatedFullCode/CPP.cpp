#include <bits/stdc++.h>
#include <sys/resource.h>
using namespace std;
class solution {
public:
    vector<int> two_sum(vector<int>& nums, int target) {
        unordered_map<int,int> seen;
        for (int i = 0; i < (int)nums.size(); i++) {
            int num = nums[i];
            int complement = target - num;
            if (seen.find(complement) != seen.end()) {
                return {seen[complement], i};
            }
            seen[num] = i;
        }
        return {};
    }
};
int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    int n;
    cin >> n;
    vector<int> nums(n);
    for (int i = 0; i < n; i++) cin >> nums[i];
    int target;
    cin >> target;
    solution sol;
    vector<int> result = sol.two_sum(nums, target);
    if (!result.empty()) {
        cout << result[0] << " " << result[1] << "\n";
    } else {
        cout << -1 << "\n";
    }
    return 0;
}