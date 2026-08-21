"""A function-based editorial must ship its driver commented out.

The generator relied purely on the prompt for this, and shipped live `main()`s.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from editorial_code_guard import comment_out_driver, comment_out_editorial_drivers


LIVE_MD = """\
Prose about the approach.

```pseudocode
/* untouched: pseudocode is not a MultiLanguageCodeBlock */
FUNCTION main()
```

<MultiLanguageCodeBlock>
```cpp
#include <bits/stdc++.h>
using namespace std;

class solution {
public:
    int f(int n) { return n; }
};

int main() {
    int n;
    cin >> n;
    solution sol;
    cout << sol.f(n);
    return 0;
}
```
```python
class solution:
    def f(self, n):
        return n

n = int(input())
sol = solution()
print(sol.f(n))
```
```java
import java.util.*;

class Solution {
    public static int f(int n) { return n; }
}

class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.println(Solution.f(scanner.nextInt()));
    }
}
```
```js
class Solution {
    static f(n) { return n; }
}

function main() {
    const fs = require("fs");
    const data = fs.readFileSync(0, "utf8").trim().split(/\\s+/);
    console.log(Solution.f(Number(data[0])));
}
main();
```
</MultiLanguageCodeBlock>
"""


class TestCommentOutDriver(unittest.TestCase):
    def test_every_language_gets_its_live_driver_commented(self):
        out, fixed = comment_out_editorial_drivers(LIVE_MD)
        self.assertEqual(fixed, 4, out)
        self.assertIn("/*\nint main() {", out)
        self.assertIn("'''\nn = int(input())", out)
        self.assertIn("/*\nclass Main {", out)
        self.assertIn("/*\nfunction main() {", out)
        # The trailing `main();` call rides along inside the comment.
        self.assertIn("main();\n*/", out)
        # The solution class itself is never swallowed.
        self.assertIn("class solution {\npublic:", out)
        self.assertIn("class solution:\n    def f(self, n):", out)

    def test_pseudocode_fences_are_left_alone(self):
        out, _ = comment_out_editorial_drivers(LIVE_MD)
        self.assertIn("```pseudocode\n/* untouched", out)
        self.assertIn("FUNCTION main()\n```", out)

    def test_already_commented_is_a_no_op(self):
        once, first = comment_out_editorial_drivers(LIVE_MD)
        twice, second = comment_out_editorial_drivers(once)
        self.assertEqual((first, second), (4, 0))
        self.assertEqual(once, twice)

    def test_module_level_constant_above_the_class_is_not_the_driver(self):
        """`MOD = ...` must not be mistaken for the driver — that would comment out
        the whole solution. Only stdin-reading statements after the last def do."""
        code = "MOD = 10 ** 9 + 7\n\nclass solution:\n    def f(self, n):\n        return n % MOD\n"
        out, changed = comment_out_driver(code, "python")
        self.assertFalse(changed)
        self.assertEqual(out, code)

    def test_a_python_fence_with_no_driver_is_untouched(self):
        code = "class solution:\n    def f(self, n):\n        return n\n"
        self.assertEqual(comment_out_driver(code, "python"), (code, False))

    def test_a_main_mentioned_in_a_line_comment_is_not_a_driver(self):
        code = "class solution {\n};\n// int main() lives in the driver\n"
        self.assertEqual(comment_out_driver(code, "cpp"), (code, False))


class TestJavaScriptDrivers(unittest.TestCase):
    """A JS driver does not need a `main` at all — the real regression was a bare
    top-level `readFileSync` block after the class, which no `main` pattern sees."""

    SOLUTION = "class Solution {\n    static solve(N) {\n        return N;\n    }\n}\n"
    BARE_DRIVER = ('const fs = require("fs");\n'
                   'const N = Number(fs.readFileSync(0, "utf8").trim());\n'
                   "console.log(Solution.solve(N));\n")

    def test_a_bare_top_level_driver_is_commented(self):
        out, changed = comment_out_driver(self.SOLUTION + "\n" + self.BARE_DRIVER, "js")
        self.assertTrue(changed)
        self.assertIn('/*\nconst fs = require("fs");', out)
        self.assertTrue(out.rstrip().endswith("*/"))
        self.assertIn("class Solution {", out.split("/*")[0])

    def test_wrapping_a_bare_driver_is_idempotent(self):
        once, _ = comment_out_driver(self.SOLUTION + "\n" + self.BARE_DRIVER, "js")
        self.assertEqual(comment_out_driver(once, "js"), (once, False))

    def test_a_live_main_call_below_a_commented_main_is_commented(self):
        code = (self.SOLUTION + "\n/*\nfunction main() {\n"
                '    const fs = require("fs");\n    console.log(1);\n}\n*/\nmain();\n')
        out, changed = comment_out_driver(code, "js")
        self.assertTrue(changed)
        self.assertIn("/*\nmain();\n*/", out)

    def test_a_solution_only_fence_is_untouched(self):
        self.assertEqual(comment_out_driver(self.SOLUTION, "js"), (self.SOLUTION, False))

    def test_a_top_level_const_above_the_class_is_not_the_driver(self):
        """`const MOD = ...` before the class must not swallow the solution."""
        code = "const MOD = 1000000007;\n\n" + self.SOLUTION
        self.assertEqual(comment_out_driver(code, "js"), (code, False))

    def test_a_helper_const_after_the_class_needs_stdin_to_count(self):
        code = self.SOLUTION + "\nconst LIMIT = 100000;\n"
        self.assertEqual(comment_out_driver(code, "js"), (code, False))


if __name__ == "__main__":
    unittest.main()
