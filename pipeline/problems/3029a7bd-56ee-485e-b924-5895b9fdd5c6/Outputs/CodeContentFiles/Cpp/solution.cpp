#include <bits/stdc++.h>
using namespace std;

class solution {
public:
    string compileDiagonalLedger(int m, int n, vector<vector<int>> &vaultGrid) {
        map<int, vector<int>> diagonals;
        for (int r = 0; r < m; r++) {
            if (r % 2 == 0) {
                for (int c = 0; c < n; c++) {
                    diagonals[r + c].push_back(vaultGrid[r][c]);
                }
            } else {
                for (int c = n - 1; c >= 0; c--) {
                    diagonals[r + c].push_back(vaultGrid[r][c]);
                }
            }
        }

        vector<string> result;
        for (map<int, vector<int>>::iterator it = diagonals.begin(); it != diagonals.end(); ++it) {
            vector<int> group = it->second;
            sort(group.begin(), group.end());
            int size = (int)group.size();

            ostringstream out;
            out << fixed << setprecision(2);
            if (size % 2 == 1) {
                double median = group[size / 2];
                out << median;
            } else {
                double sum = 0.0;
                for (int i = 0; i < size; i++) sum += group[i];
                double avg = sum / size;
                out << avg;
            }
            result.push_back(out.str());
        }

        ostringstream ans;
        for (size_t i = 0; i < result.size(); i++) {
            ans << result[i] << (i + 1 < result.size() ? " " : "");
        }
        return ans.str();
    }
};
