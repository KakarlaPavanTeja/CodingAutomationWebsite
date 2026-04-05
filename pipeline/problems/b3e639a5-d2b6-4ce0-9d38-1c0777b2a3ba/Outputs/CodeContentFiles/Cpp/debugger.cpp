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
    int m, n;
    cin >> m >> n;
    vector<vector<int> > matrix(m, vector<int>(n));
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            cin >> matrix[i][j];
        }
    }
    // Input Area End

    // Function call Area Start
    string result = sol.summarizeDiagonalEchoes(matrix);
    // Function call Area End

    // Output Area Start
    cout << result << "\n";
    // Output Area End

    // Dont change or modify any lines below this line
    return 0;
}
----------POST_USER_CODE_END----------