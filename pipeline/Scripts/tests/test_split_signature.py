"""The split must MOVE the entry point, never re-declare it.

A Java split turned `solve(int N, int[] arr, int V)` into `solve(int[] arr, int v)` while
Python and C++ kept all three parameters. It passed every check, because the split writes
the driver that calls it.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from problem_flags import entry_point_params, signature_defects


JAVA_SOURCE = """\
import java.util.*;

class Solution {
    public Integer solve(int N, int[] arr, int V) {
        int total = 0;
        for (int i = 0; i < arr.length; i++) { total += arr[i]; if (total >= V) return i + 1; }
        return -1;
    }
}
"""

JAVA_DROPPED_N = {
    "solution_code": "public class Solution {\n    public int solve(int[] arr, int v) {\n"
                     "        return 0;\n    }\n}",
    "default_code": "public class Solution {\n    public int solve(int[] arr, int v) {\n"
                    "        //Write your code here...\n    }\n}",
}

JAVA_PRESERVED = {
    "solution_code": "public class Solution {\n    public int solve(int N, int[] arr, int V) {\n"
                     "        return 0;\n    }\n}",
    "default_code": "public class Solution {\n    public int solve(int N, int[] arr, int V) {\n"
                    "        //Write your code here...\n    }\n}",
}


class TestEntryPointParams(unittest.TestCase):
    def test_java_types_are_not_mistaken_for_names(self):
        self.assertEqual(entry_point_params("Java", JAVA_SOURCE, "solve"), ["N", "arr", "V"])

    def test_python_drops_the_receiver_and_annotations(self):
        src = "class solution:\n    def solve(self, N: int, arr: list, V: int = 0):\n        pass\n"
        self.assertEqual(entry_point_params("Python", src, "solve"), ["N", "arr", "V"])

    def test_a_template_comma_is_not_a_parameter_separator(self):
        src = "int solve(int N, map<int, vector<int>>& adj, int V) { return 0; }"
        self.assertEqual(entry_point_params("C++", src, "solve"), ["N", "adj", "V"])

    def test_a_recursive_call_does_not_shadow_the_declaration(self):
        src = ("int solve(int N, vector<int>& arr, int V) {\n"
               "    if (N == 0) return 0;\n"
               "    return solve(N - 1, arr, V);\n}")
        self.assertEqual(entry_point_params("C++", src, "solve"), ["N", "arr", "V"])

    def test_a_missing_declaration_reads_as_absent_not_empty(self):
        self.assertIsNone(entry_point_params("Java", "class Solution {}", "solve"))


class TestSignatureDefects(unittest.TestCase):
    def test_the_java_regression_is_caught_in_both_user_facing_files(self):
        defects = signature_defects("Java", "solve", JAVA_SOURCE, JAVA_DROPPED_N)
        self.assertEqual(len(defects), 2, defects)
        self.assertTrue(all("solve(N, arr, V) became solve(arr, v)" in d for d in defects))

    def test_a_preserved_signature_is_clean(self):
        self.assertEqual(signature_defects("Java", "solve", JAVA_SOURCE, JAVA_PRESERVED), [])

    def test_a_renamed_entry_point_is_a_defect(self):
        renamed = {"solution_code": "public class Solution {\n    public int run(int[] arr) {}\n}",
                   "default_code": JAVA_PRESERVED["default_code"]}
        defects = signature_defects("Java", "solve", JAVA_SOURCE, renamed)
        self.assertEqual(len(defects), 1)
        self.assertIn("declares no solve(...)", defects[0])

    def test_a_case_change_alone_is_a_defect(self):
        recased = {
            "solution_code": JAVA_PRESERVED["solution_code"].replace("int V", "int v"),
            "default_code": JAVA_PRESERVED["default_code"],
        }
        self.assertEqual(len(signature_defects("Java", "solve", JAVA_SOURCE, recased)), 1)

    def test_no_function_name_means_no_gate(self):
        """Non-function problems have no description_signature.json."""
        self.assertEqual(signature_defects("Java", "", JAVA_SOURCE, JAVA_DROPPED_N), [])

    def test_an_unreadable_source_signature_never_fails_a_split(self):
        self.assertEqual(signature_defects("Java", "solve", "class Solution {}",
                                           JAVA_DROPPED_N), [])


if __name__ == "__main__":
    unittest.main()
