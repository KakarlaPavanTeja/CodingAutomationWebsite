#include <bits/stdc++.h>
#include <fstream>
#include <cstdlib>
#include <ctime>
#include <chrono>
#include <iomanip>
#include <sys/resource.h>
/* IF IT IS A BINARY TREE OR LINKED LIST PROBLEM, YOU MUST INCLUDE #include "node.h" HERE. OTHERWISE DO NOT. */
using namespace std;
using namespace std::chrono;
#include "solution.cpp"
// [INSERT ANY EXTRA HELPER FUNCTIONS PARSED FROM SOURCE HERE E.g. buildTree, linkedListToList]

long getPeakRSS() {
    struct rusage rusage;
    getrusage(RUSAGE_SELF, &rusage);
    return rusage.ru_maxrss; // Return peak memory usage in kilobytes
}



int main(int argc, char* argv[]) {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    solution sol;
    auto total_duration = 0ns;

    // Dont change or modify any lines before this point
    
    // Input Area Start
    int m, n;
    cin >> m >> n;
    vector<vector<int>> vaultGrid(m, vector<int>(n));
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            cin >> vaultGrid[i][j];
        }
    }
    // Input Area End

    // Function call Area Start
    auto start = high_resolution_clock::now();
    auto result = sol.compileDiagonalLedger(m, n, vaultGrid);
    auto stop = high_resolution_clock::now();
    // Function call Area End

    // Output Area Start
    cout << result << "\n";
    // Output Area End

    // Dont change or modify any lines below this line

    total_duration += duration_cast<nanoseconds>(stop - start);
    long memory_used = getPeakRSS();
    float execution_time = total_duration.count()/1e9;
    
    const char* file_path = argv[2];
    std::ofstream output_file(file_path);
    output_file << std::fixed << std::setprecision(9);
    output_file << "*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* " << execution_time;
    output_file << "\n";
    output_file << "*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* " << memory_used;
    output_file.close();
    return 0;
}
