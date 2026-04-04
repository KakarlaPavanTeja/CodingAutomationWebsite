#include <bits/stdc++.h>
#include <fstream>
#include <cstdlib>
#include <ctime>
#include <chrono>
#include <iomanip>
using namespace std;
using namespace std::chrono;
#include "solution.cpp"
#include <sys/resource.h>

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

    auto start = high_resolution_clock::now();
    long long result = sol.findMaxMinRuntime(numAPIs, runtimes, numApps);
    auto stop = high_resolution_clock::now();

    // Function call Area End

    // Output Area Start

    cout << result;

    // Output Area End

    // Dont change or modify any lines below this line

    total_duration += duration_cast<nanoseconds>(stop - start);
    long memory_used = getPeakRSS();
    float execution_time = total_duration.count()/1e9;
    
    try{
         const char* file_path = argv[2];
         std::ofstream output_file(file_path);
         output_file << std::fixed << std::setprecision(9);
         output_file << "*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* " << execution_time;
         output_file << "\n";
         output_file << "*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* " << memory_used;
         output_file.close();
      }
     catch(...){
     }
    return 0;
}
