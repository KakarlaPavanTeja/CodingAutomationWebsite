----------PRE_USER_CODE_START----------
#include <bits/stdc++.h>
using namespace std;
----------PRE_USER_CODE_END----------



----------POST_USER_CODE_START----------
int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    solution sol;
    // Dont change or modify any lines before this point
    
    // Input Area Start

    int numAPIs;
    cin >> numAPIs;
    vector<int> runtimes(numAPIs);
    for (int i = 0; i < numAPIs; i++) {
        cin >> runtimes[i];
    }
    int numApps;
    cin >> numApps;
    
    // Input Area End

    // Function Call Area which should be done between start and stop with no other operations done (only function call should be done)

    // Function call Area Start

    long long result = sol.findMaxMinRuntime(numAPIs, runtimes, numApps);

    // Function call Area End

    // Output Area Start

    cout << result;

    // Output Area End

    // Dont change or modify any lines below this line
    return 0;
}

----------POST_USER_CODE_END----------
