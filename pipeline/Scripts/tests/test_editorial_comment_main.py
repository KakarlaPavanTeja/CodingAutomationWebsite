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


if __name__ == "__main__":
    unittest.main()
