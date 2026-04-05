#include <bits/stdc++.h>
#include <sys/resource.h>
using namespace std;
class solution {
public:
    vector<int> locateResonancePair(vector<int>& sequence, int requiredTotal) {
        unordered_map<int, int> seen;
        for (int i = 0; i < (int)sequence.size(); i++) {
            int num = sequence[i];
            int complement = requiredTotal - num;
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
    vector<int> sequence(n);
    for (int i = 0; i < n; i++) cin >> sequence[i];
    int requiredTotal;
    cin >> requiredTotal;
    solution sol;
    vector<int> result = sol.locateResonancePair(sequence, requiredTotal);
    if (!result.empty()) {
        cout << result[0] << " " << result[1] << "\n";
    } else {
        cout << -1 << "\n";
    }
    return 0;
}