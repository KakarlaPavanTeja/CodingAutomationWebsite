----------PRE_USER_CODE_START----------
import java.util.*;
import java.io.*;
----------PRE_USER_CODE_END----------

----------POST_USER_CODE_START----------
// [INSERT CLASS NODE DEFINITION HERE IF APPLICABLE]

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

    public static void main(String[] args) throws IOException {
        Solution sol = new Solution();
        FastReader sc = new FastReader();

        // Dont Remove the code of above lines in the main function or dont modify them
        // or dont change the order of the lines.

        // Input Area Start
        int m = sc.nextInt();
        int n = sc.nextInt();
        int[][] gridData = new int[m][n];
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                gridData[i][j] = sc.nextInt();
            }
        }
        // Input Area End

        // Function Call Area Start
        String result = sol.summarizeDiagonalEchoes(gridData);
        // Function Call Area End

        // Output Area Start
        System.out.println(result);
        // Output Area End

    }
    // [INSERT buildTree LOGIC HERE IF APPLICABLE]
}
----------POST_USER_CODE_END----------