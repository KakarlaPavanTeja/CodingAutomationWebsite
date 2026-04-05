#include <bits/stdc++.h>
using namespace std;

class solution {
public:
    string summarizeDiagonalEchoes(vector<vector<int>>& gridData) {
        int m = (int)gridData.size();
        int n = m > 0 ? (int)gridData[0].size() : 0;
        map<int, vector<int> > diagonals;

        for (int r = 0; r < m; r++) {
            if (r % 2 == 0) {
                for (int c = 0; c < n; c++) {
                    diagonals[r + c].push_back(gridData[r][c]);
                }
            } else {
                for (int c = n - 1; c >= 0; c--) {
                    diagonals[r + c].push_back(gridData[r][c]);
                }
            }
        }

        vector<string> result;
        for (map<int, vector<int> >::iterator it = diagonals.begin(); it != diagonals.end(); ++it) {
            vector<int> group = it->second;
            sort(group.begin(), group.end());
            int size = (int)group.size();

            ostringstream oss;
            oss << fixed << setprecision(2);

            if (size % 2 == 1) {
                double median = group[size / 2];
                oss << median;
            } else {
                long long s = 0;
                for (int i = 0; i < size; i++) s += group[i];
                double avg = (double)s / (double)size;
                oss << avg;
            }
            result.push_back(oss.str());
        }

        string out = "";
        for (size_t i = 0; i < result.size(); i++) {
            out += result[i];
            if (i + 1 < result.size()) out += " ";
        }
        return out;
    }
};