"""Revision notes: editorial parsing, faithfulness to the editorial, and
validation of the LLM's JSON.

The LLM calls are stubbed; these cover everything that decides whether a reply
is accepted, retried, or failed — and that the code fields (names, TC/SC) come
from the editorial and the code steps use only the editorial's names.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import revision_notes_manager as rn
from revision_notes_manager import (
    assign_labels,
    clean_steps,
    code_names_in_prose,
    compact_pseudocode,
    editorial_identifiers,
    extract_big_o,
    fix_steps,
    parse_llm_json,
    split_solutions,
    steps_problems,
    strip_code_blocks,
    validate_notes,
)


# Written the way the editorial generator writes (see Prompts/editorialPrompt.py):
# comment above every block, braces, 4-space indents, backticked complexities.
EDITORIAL = """\
# Union of Two Sorted Arrays

## Solution 1: Ordered Set

### Intuition
- A set removes duplicates.

### Approach
- Put everything in a set.

### Pseudocode
<CodeBlock language={customtext} showNumberOfLines={15} fontStyle={Normal Code}>

```pseudocode
findUnion(a, b) {
    /* Collect every value; the set keeps them sorted and unique */
    st = ordered_set()

    /* Insert all values of the first array */
    for x in a {
        st.insert(x)
    }

    /* Insert all values of the second array */
    for x in b {
        st.insert(x)
    }

    /* Copy the set into the answer */
    return list(st)
}
```

</CodeBlock>

### Code Implementation
<MultiLanguageCodeBlock>
```cpp
vector<int> findUnion(vector<int>& a, vector<int>& b) { set<int> st; return {}; }
```
</MultiLanguageCodeBlock>

### Complexity Analysis
* **Time Complexity: `O((M + N) log(M + N))`**
  * Every insert costs a log.
* **Space Complexity: `O(M + N)`**
  * The set holds every value.

## Solution 2: Two Pointers

### Pseudocode
<CodeBlock language={customtext} showNumberOfLines={15} fontStyle={Normal Code}>

```pseudocode
findUnion(a, b) {
    /* Start both pointers at the front */
    i = 0
    j = 0
    result = []

    /* Walk while both arrays have values left */
    while i < n and j < m {
        /* Take the smaller value */
        if a[i] <= b[j] {
            x = a[i]  /* from the first array */
            i = i + 1
        } else {
            x = b[j]
            j = j + 1
        }

        /* Skip duplicates <edge case> */
        if result is empty or result.back() != x {
            result.push(x)
        }
    }
    return result
}
```

</CodeBlock>

### Complexity Analysis
* **Time Complexity: `O(M + N)`**
  * One pass.
* **Space Complexity: `O(1)`**
  * Only pointers.
"""


# Code steps written from each solution's editorial pseudocode, same names.
# Short revision cues: verb first, key names only, ≤ 70 characters.
BRUTE_STEPS = [
    "st.insert(x) for every x in a and b",
    "Return list(st)",
]
OPTIMAL_STEPS = [
    "Walk i over a and j over b, taking the smaller as x",
    "result.push(x) unless result.back() == x",
    "Return result",
]


def approach(**overrides):
    base = {
        "solutionIndex": 1,
        "intuition": "An ordered set removes duplicates and sorts.",
        "steps": list(BRUTE_STEPS),
        "takeaway": "Ignores that the arrays are sorted.",
        "whyBetter": "",
    }
    base.update(overrides)
    return base


def notes(approaches=None, **overrides):
    base = {
        "title": "Union of Two Sorted Arrays",
        "oneLiner": "Return all distinct values of both arrays in ascending order.",
        "example": "a = [1, 2], b = [2, 3] → [1, 2, 3]",
        "approaches": approaches
        if approaches is not None
        else [
            approach(),
            approach(
                solutionIndex=2,
                intuition="Both arrays are sorted, so the smaller front value is next.",
                steps=list(OPTIMAL_STEPS),
                takeaway="Compare with result.back() to skip duplicates.",
                whyBetter="The set re-sorts sorted data; one merge pass does it.",
            ),
        ],
        "tags": ["Arrays", "Two Pointers"],
        "constraintsHint": "M, N up to 10^5 -> O(M + N) is ideal",
        "recognize": ["Two sorted inputs + union -> two pointers."],
        "edgeCases": ["One array empty.", "Duplicates inside one array."],
        "pitfalls": ["Pushing both copies when a[i] == b[j].", "Not checking result.back() on the tail."],
        "dryRun": {
            "input": "a = [1, 2], b = [2, 3]",
            "columns": ["i, j", "x", "result"],
            "rows": [["0, 0", "1", "[1]"], ["1, 0", "2", "[1, 2]"], ["2, 1", "3", "[1, 2, 3]"]],
            "result": "[1, 2, 3]",
        },
    }
    base.update(overrides)
    return base


class EditorialParsing(unittest.TestCase):
    def setUp(self):
        self.sols = split_solutions(EDITORIAL)

    def test_split_solutions_names_and_complexity(self):
        self.assertEqual([s["name"] for s in self.sols], ["Ordered Set", "Two Pointers"])
        self.assertEqual([s["tc"] for s in self.sols], ["O((M + N) log(M + N))", "O(M + N)"])
        self.assertEqual([s["sc"] for s in self.sols], ["O(M + N)", "O(1)"])

    def test_pseudocode_is_the_editorials_own_code_compacted(self):
        self.assertEqual(
            self.sols[0]["pseudocode"],
            "findUnion(a, b)\n  st = ordered_set()\n  for x in a\n    st.insert(x)\n"
            "  for x in b\n    st.insert(x)\n  return list(st)",
        )

    def test_compaction_only_removes_comments_blanks_and_braces(self):
        code = self.sols[1]["pseudocode"]
        self.assertIn("      x = a[i]", code)  # inline comment stripped
        self.assertIn("    else", code)  # "} else {" -> "else"
        self.assertIn("    if result is empty or result.back() != x", code)  # <edge case> dropped
        for bad in ("/*", "{", "}"):
            self.assertNotIn(bad, code)

    def test_compact_handles_else_if(self):
        raw = "if x {\n  y = 1\n} else if z {\n  y = 2\n}\n"
        self.assertEqual(compact_pseudocode(raw), "if x\n  y = 1\nelse if z\n  y = 2")

    def test_identifiers_per_solution_and_overall(self):
        self.assertIn("st", self.sols[0]["identifiers"])
        self.assertNotIn("st", self.sols[1]["identifiers"])
        ids = editorial_identifiers(EDITORIAL)
        for name in ("findUnion", "st", "result", "i", "j", "x", "a", "b"):
            self.assertIn(name, ids)
        self.assertNotIn("Collect", ids, "comments are not identifiers")

    def test_extract_big_o_normalizes_latex_and_backticks(self):
        self.assertEqual(extract_big_o("`O((M + N) \\log(M + N))`"), ["o((m+n)log(m+n))"])

    def test_strip_code_blocks_keeps_pseudocode(self):
        stripped = strip_code_blocks(EDITORIAL)
        self.assertNotIn("vector<int>", stripped)
        self.assertIn("ordered_set()", stripped)


class Labels(unittest.TestCase):
    def test_positions_and_equal_optimal_tc(self):
        self.assertEqual(assign_labels(["O(1)"]), ["Optimal"])
        self.assertEqual(assign_labels(["O(N^2)", "O(N)"]), ["Brute", "Optimal"])
        self.assertEqual(assign_labels(["O(N^2)", "O(N log N)", "O(N)"]), ["Brute", "Better", "Optimal"])
        self.assertEqual(
            assign_labels(["O(N^3)", "O(N^2)", "O(N log N)", "O(N)"]),
            ["Brute", "Better 1", "Better 2", "Optimal"],
        )
        self.assertEqual(assign_labels(["O(N^2)", "O(N)", "O(N)"]), ["Brute", "Optimal 1", "Optimal 2"])


class Steps(unittest.TestCase):
    def setUp(self):
        self.sols = split_solutions(EDITORIAL)

    def test_clean_steps_strips_numbering_and_accepts_a_string(self):
        self.assertEqual(clean_steps(["1. Do a", "- Do b", "  ", "3) Do c"]), ["Do a", "Do b", "Do c"])
        self.assertEqual(clean_steps("Do a\n2. Do b"), ["Do a", "Do b"])
        self.assertEqual(clean_steps(None), [])

    def test_faithful_steps_have_no_problems(self):
        self.assertEqual(steps_problems(OPTIMAL_STEPS, self.sols[1]), [])
        self.assertEqual(steps_problems(BRUTE_STEPS, self.sols[0]), [])

    def test_renamed_or_invented_names_are_flagged(self):
        problems = steps_problems(["Set l = 0, r = 0", "ans.push(x) unless ans.back() == x", "Return merge_unique(a, b)"], self.sols[1])
        self.assertTrue(any("steps use ans, merge_unique" in p for p in problems), problems)

    def test_names_from_another_solution_are_flagged(self):
        problems = steps_problems(["st.insert(x) for each x", "Walk i and j", "Return result"], self.sols[1])
        self.assertTrue(any("steps use st" in p for p in problems), problems)

    def test_plain_english_is_not_a_name(self):
        steps = ["Build the answer by scanning both arrays", "Compare the fronts and take the smaller", "Return result"]
        self.assertEqual(steps_problems(steps, self.sols[1]), [])

    def test_count_and_length_limits(self):
        self.assertTrue(any("limit 5" in p for p in steps_problems(["Return result"] * 6, self.sols[1])))
        self.assertTrue(any("only 1 step" in p for p in steps_problems(["Return result"], self.sols[1])))
        long = ["Walk i over a and j over b, taking the smaller value as x and advancing it", "Return result"]
        self.assertTrue(any("over 70 characters" in p for p in steps_problems(long, self.sols[1])))
        self.assertEqual(steps_problems([], self.sols[1]), ["missing 'steps'"])



class ProseNames(unittest.TestCase):
    def test_finds_code_like_names_only(self):
        found = code_names_in_prose("Push a[i] when result.back() differs; left_ptr and maxSum move. The end.")
        self.assertEqual(found, {"a", "result", "back", "left_ptr", "maxSum"})


class FixSteps(unittest.TestCase):
    def setUp(self):
        self.sols = split_solutions(EDITORIAL)
        self.ids = editorial_identifiers(EDITORIAL)
        check = mock.patch.object(rn, "check_steps_faithful", return_value=[])
        self.faithful = check.start()
        self.addCleanup(check.stop)

    def notes_with(self, steps):
        data = notes()
        data["approaches"][1]["steps"] = steps
        result, errors, _ = validate_notes(data, self.sols, self.ids)
        self.assertEqual(errors, [])
        return result

    def test_good_steps_make_no_rewrite_calls_but_are_checked(self):
        n = self.notes_with(list(OPTIMAL_STEPS))
        with mock.patch.object(rn, "_steps_call") as call:
            fix_steps(n, self.sols)
        call.assert_not_called()
        self.assertEqual(self.faithful.call_count, 2)  # both notes checked

    def test_renamed_steps_get_a_focused_rewrite(self):
        n = self.notes_with(["Set l = 0", "ans.push(x)", "Return ans"])
        with mock.patch.object(rn, "_steps_call", return_value=list(OPTIMAL_STEPS)) as call:
            fix_steps(n, self.sols)
        self.assertEqual(n["approaches"][1]["steps"], OPTIMAL_STEPS)
        self.assertIn("steps use ans", call.call_args.args[2][0])

    def test_missing_step_found_by_the_reviewer_is_sent_back(self):
        dropped = ["Start i = 0, j = 0", "Push the smaller of a[i] and b[j] into result", "Return result"]
        n = self.notes_with(dropped)
        self.faithful.side_effect = [[], ["drops 'if result is empty or result.back() != x'"], []]
        with mock.patch.object(rn, "_steps_call", return_value=list(OPTIMAL_STEPS)) as call:
            fix_steps(n, self.sols)
        self.assertEqual(n["approaches"][1]["steps"], OPTIMAL_STEPS)
        self.assertIn("drops 'if result is empty or result.back() != x'", call.call_args.args[2])

    def test_reviewer_feedback_triggers_a_rewrite(self):
        n = self.notes_with(list(OPTIMAL_STEPS))
        with mock.patch.object(rn, "_steps_call", return_value=list(OPTIMAL_STEPS)) as call:
            fix_steps(n, self.sols, {2: ["step 2 hides the tail loop"]})
        self.assertEqual(call.call_count, 1)
        self.assertIn("step 2 hides the tail loop", call.call_args.args[2])

    def test_keeps_the_best_attempt_when_none_is_perfect(self):
        n = self.notes_with(["Set l = 0", "ans.push(x)", "Return ans"])  # 1 problem (names)
        attempts = [["Return result"], ["Start i", "Walk j", "Return result"]]  # 2 problems, then 0 hard + ...
        self.faithful.side_effect = lambda sol, steps: ["still misses the duplicate check"] if sol["index"] == 2 else []
        with mock.patch.object(rn, "_steps_call", side_effect=attempts + [["Return result"]]):
            fix_steps(n, self.sols)
        self.assertEqual(n["approaches"][1]["steps"], ["Start i", "Walk j", "Return result"])

    def test_unavailable_check_does_not_block(self):
        n = self.notes_with(list(OPTIMAL_STEPS))
        self.faithful.return_value = None
        with mock.patch.object(rn, "_steps_call") as call:
            fix_steps(n, self.sols)
        call.assert_not_called()


class ReplyParsing(unittest.TestCase):
    def test_accepts_fenced_json_with_prose(self):
        self.assertEqual(parse_llm_json('Here:\n```json\n{"a": 1}\n```'), {"a": 1})

    def test_rejects_reply_without_object(self):
        with self.assertRaises(ValueError):
            parse_llm_json("sorry, no")


class Validation(unittest.TestCase):
    def setUp(self):
        self.sols = split_solutions(EDITORIAL)
        self.ids = editorial_identifiers(EDITORIAL)

    def validate(self, data):
        return validate_notes(data, self.sols, self.ids)

    def test_valid_notes_pass_cleanly(self):
        result, errors, soft = self.validate(notes())
        self.assertEqual((errors, soft), ([], []))
        self.assertEqual(result["version"], 2)
        self.assertEqual([a["label"] for a in result["approaches"]], ["Brute", "Optimal"])
        self.assertEqual(result["approaches"][1]["steps"], OPTIMAL_STEPS)
        self.assertNotIn("pseudocode", result["approaches"][1])
        self.assertNotIn("approach", result["approaches"][1])

    def test_name_tc_sc_and_label_come_from_the_editorial(self):
        tampered = notes()
        tampered["approaches"][1].update(name="Merge Walk", tc="O(N)", sc="O(N)", label="Best")
        result, errors, _ = self.validate(tampered)
        self.assertEqual(errors, [])
        a = result["approaches"][1]
        self.assertEqual((a["name"], a["tc"], a["sc"], a["label"]), ("Two Pointers", "O(M + N)", "O(1)", "Optimal"))

    def test_bad_steps_are_soft(self):
        data = notes()
        data["approaches"][1]["steps"] = ["ans.push(x) and return ans"]
        result, errors, soft = self.validate(data)
        self.assertEqual(errors, [])
        self.assertTrue(any("approach 2: steps use ans" in s for s in soft), soft)
        self.assertTrue(any("approach 2: only 1 step(s)" in s for s in soft), soft)

    def test_skipping_a_solution_is_structural(self):
        result, errors, _ = self.validate(notes([approach()]))
        self.assertIsNone(result)
        self.assertTrue(any("editorial has 2 solutions" in e for e in errors))

    def test_reordering_solutions_is_structural(self):
        swapped = notes([approach(solutionIndex=2), approach(solutionIndex=1)])
        result, errors, _ = self.validate(swapped)
        self.assertIsNone(result)
        self.assertTrue(any("editorial's order" in e for e in errors))

    def test_missing_prose_is_structural(self):
        data = notes()
        data["approaches"][0]["intuition"] = ""
        result, errors, _ = self.validate(data)
        self.assertIsNone(result)
        self.assertTrue(any("intuition" in e for e in errors))

    def test_renamed_variables_in_prose_are_flagged(self):
        renamed = notes()
        renamed["approaches"][1]["takeaway"] = "Compare with ans.back() before pushing."
        renamed["pitfalls"] = ["Reading ans.back() while ans is empty.", "Pushing both copies."]
        result, errors, soft = self.validate(renamed)
        self.assertEqual(errors, [])
        self.assertTrue(any("approach 2 'takeaway' uses ans" in s for s in soft), soft)
        self.assertTrue(any("'pitfalls' item uses ans" in s for s in soft), soft)

    def test_dry_run_columns_must_be_editorial_variables(self):
        bad = notes()
        bad["dryRun"]["columns"] = ["l, r", "x", "ans"]
        _, _, soft = self.validate(bad)
        self.assertTrue(any("dryRun columns use ans, l, r" in s for s in soft), soft)

    def test_dry_run_traces_the_last_solution(self):
        result, _, _ = self.validate(notes())
        self.assertEqual(result["dryRun"]["approach"], "Optimal")

    def test_first_approach_never_has_why_better(self):
        data = notes()
        data["approaches"][0]["whyBetter"] = "nothing came before me"
        result, _, _ = self.validate(data)
        self.assertEqual(result["approaches"][0]["whyBetter"], "")

    def test_missing_why_better_is_soft(self):
        data = notes()
        data["approaches"][1]["whyBetter"] = ""
        _, errors, soft = self.validate(data)
        self.assertEqual(errors, [])
        self.assertTrue(any("whyBetter" in s for s in soft))

    def test_overlong_fields_are_soft(self):
        data = notes()
        data["approaches"][0]["intuition"] = "x" * 400
        _, errors, soft = self.validate(data)
        self.assertEqual(errors, [])
        self.assertTrue(any("intuition" in s for s in soft))

    def test_ragged_dry_run_is_dropped_not_fatal(self):
        bad = notes()
        bad["dryRun"]["rows"][1] = ["1, 0", "2"]
        result, errors, soft = self.validate(bad)
        self.assertEqual(errors, [])
        self.assertIsNone(result["dryRun"])
        self.assertTrue(any("dry run dropped" in s for s in soft))

    def test_dry_run_result_checked_against_example(self):
        wrong = notes()
        wrong["dryRun"]["result"] = "[1, 2]"
        _, _, soft = self.validate(wrong)
        self.assertTrue(any("does not match the example output" in s for s in soft))

    def test_null_dry_run_is_allowed(self):
        result, errors, soft = self.validate(notes(dryRun=None))
        self.assertEqual((errors, soft), ([], []))
        self.assertIsNone(result["dryRun"])

    def test_lists_are_trimmed_to_their_limits(self):
        result, _, soft = self.validate(notes(pitfalls=[f"pitfall {i}" for i in range(9)]))
        self.assertEqual(len(result["pitfalls"]), 4)
        self.assertTrue(any("extras dropped" in s for s in soft))

    def test_unparsed_editorial_falls_back_to_model_fields(self):
        data = notes([approach(name="Ordered Set", tc="O(N)", sc="O(N)")])
        result, errors, _ = validate_notes(data, [], set())
        self.assertEqual(errors, [])
        self.assertEqual(result["approaches"][0]["name"], "Ordered Set")
        self.assertEqual(result["approaches"][0]["label"], "Optimal")


if __name__ == "__main__":
    unittest.main()
