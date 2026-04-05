----------PRE_USER_CODE_START----------
#include <bits/stdc++.h>
using namespace std;
// [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
// [INSERT buildTree LOGIC HERE IF APPLICABLE]

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    solution sol;
    // Dont change or modify any lines before this point
    
    // Input Area Start
    int n;
    cin >> n;
    vector<int> values(n);
    for (int i = 0; i < n; i++) cin >> values[i];
    int required;
    cin >> required;
    // Input Area End

    // Function call Area Start
    vector<int> result = sol.locatePairPositions(values, required);
    // Function call Area End

    // Output Area Start
    if (!result.empty()) {
        cout << result[0] << " " << result[1] << "\n";
    } else {
        cout << -1 << "\n";
    }
    // Output Area End

    // Dont change or modify any lines below this line
    return 0;
}
----------POST_USER_CODE_END----------