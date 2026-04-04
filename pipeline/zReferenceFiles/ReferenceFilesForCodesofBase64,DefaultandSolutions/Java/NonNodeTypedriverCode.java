import java.util.*;
import java.io.FileWriter;
import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;

public class Main {
    static class FastReader {
        BufferedReader br;
        StringTokenizer st;

        public FastReader() {
            br = new BufferedReader(new InputStreamReader(System.in));
        }

        String next() {
            while (st == null || !st.hasMoreElements()) {
                try {
                    st = new StringTokenizer(br.readLine());
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
            return st.nextToken();
        }

        int nextInt() {
            return Integer.parseInt(next());
        }

        long nextLong() {
            return Long.parseLong(next());
        }

        double nextDouble() {
            return Double.parseDouble(next());
        }

        String nextLine() {
            String str = "";
            try {
                str = br.readLine();
            } catch (IOException e) {
                e.printStackTrace();
            }
            return str;
        }
    }

    public static long getPeakRSS() {
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();
        return heapUsage.getUsed() / 1024; // Convert bytes to kilobytes
    }

    public static void main(String[] args) throws IOException {
        if (args.length < 2) {
            System.out.println("Usage: java Main <file_path>");
            return;
        }
        String file_path = args[1];
        long total_elapsed_time_ns = 0; 
        Solution sol = new Solution();
        FastReader sc = new FastReader();

        // Dont Remove the code of above lines in the main function or dont modify them
        // or dont change the order of the lines.

        // Input Area Start
        // [INSERT INPUT PARSING LOGIC HERE using FastReader (sc.nextInt(), sc.next(), etc.)]
        // Example:
        // int n = sc.nextInt();
        // int[] arr = new int[n];
        // for(int i=0; i<n; i++) arr[i] = sc.nextInt();
        // Input Area End

        // Function Call Area Start
        long start_time = System.nanoTime();
        // [INSERT FUNCTION CALL HERE]
        long result = sol.FUNCTION_NAME(ARGUMENTS); 
        long end_time = System.nanoTime();
        // Function Call Area End

        // Output Area Start
        System.out.println(result);
        // Output Area End

        // Dont change or modify any lines below this line
        
        total_elapsed_time_ns += (end_time - start_time);

        long memory_used = getPeakRSS();
        double execution_time = total_elapsed_time_ns / 1e9;
        FileWriter writer = new FileWriter(file_path);
        writer.write("*-SUBMISSION::USER_CODE_FUNCTION_EXECUTION_TIME_KEY-* "+ execution_time);
        writer.write("\\n");
        writer.write("*-SUBMISSION::USER_CODE_FUNCTION_MEMORY_USAGE_KEY-* "+ memory_used);
        writer.close();
    }
}