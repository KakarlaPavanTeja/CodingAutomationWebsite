"""Regression tests for prepare_platform_json.py helpers."""

import os
import sys
import unittest
import uuid

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

import prepare_platform_json as ppj  # noqa: E402


MINIMAL_LUA = """
----------QUESTION_DESCRIPTION_START----------
Test problem
----------QUESTION_DESCRIPTION_END----------
----------SHORT_TEXT_START----------
Two Sum
----------SHORT_TEXT_END----------
----------QUESTION_LEVEL_START----------
EASY
----------QUESTION_LEVEL_END----------
----------CODE_CONTENT_CPP_START----------
int main() {}
----------CODE_CONTENT_CPP_END----------
----------CODE_CONTENT_PYTHON_START----------
print(1)
----------CODE_CONTENT_PYTHON_END----------
----------CODE_BASE64_CPP_START----------
int main() {}
----------CODE_BASE64_CPP_END----------
----------CODE_BASE64_PYTHON_START----------
print(1)
----------CODE_BASE64_PYTHON_END----------
"""

MINIMAL_CONTAINER = {
    "test_cases": [
        {"input": "1", "output": "1", "tags": []},
        {"input": "2", "output": "2", "tags": []},
    ]
}

PRACTICE_CONTAINER = {
    "test_cases": [
        {"input": "1", "output": "1", "tags": [], "weightage": 1, "order": 1},
        {"input": "2", "output": "2", "tags": [], "weightage": 1, "order": 2},
    ]
}


class TestPreparePlatformJson(unittest.TestCase):
    def setUp(self):
        self._env_backup = os.environ.copy()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env_backup)

    def test_get_question_id_uses_env_uuid(self):
        pid = str(uuid.uuid4())
        os.environ["PIPELINE_PROBLEM_ID"] = pid
        self.assertEqual(ppj.get_question_id(), pid)

    def test_parse_enabled_langs_filters(self):
        langs = ppj.parse_enabled_langs("python,cpp")
        self.assertEqual(langs, ["python", "cpp"])

    def test_exam_json_uses_problem_uuid_and_topic_tag_names(self):
        pid = str(uuid.uuid4())
        os.environ["PIPELINE_PROBLEM_ID"] = pid
        data = ppj.build_exam_json(MINIMAL_LUA, MINIMAL_CONTAINER, "EASY", ["python", "cpp"])
        q = data[0]["question"]
        self.assertEqual(q["question_id"], pid)
        self.assertEqual(q["topic_tag_names"], {})
        self.assertIsNone(q["metadata"])
        langs = {d["language"] for d in data[0]["coding_question_details"]}
        self.assertEqual(langs, {"PYTHON39", "CPP"})

    def test_exam_non_function_empty_repos(self):
        os.environ["PIPELINE_QUESTION_TYPE"] = "nonfunction"
        data = ppj.build_exam_json(MINIMAL_LUA, MINIMAL_CONTAINER, "EASY", ["python"])
        self.assertFalse(data[0]["coding_question_details"][0]["is_function_based"])
        self.assertEqual(data[0]["language_code_repository_details"], [])

    def test_default_tags_from_env(self):
        os.environ["PIPELINE_DEFAULT_TAGS"] = "arrays\ntwo-pointers"
        data = ppj.build_exam_json(MINIMAL_LUA, MINIMAL_CONTAINER, "EASY", ["python"])
        self.assertEqual(data[0]["question"]["default_tag_names"], ["arrays", "two-pointers"])

    def test_practice_json_structure(self):
        pid = str(uuid.uuid4())
        os.environ["PIPELINE_PROBLEM_ID"] = pid
        data = ppj.build_practice_json(MINIMAL_LUA, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"])
        q = data[0]["question"]
        self.assertEqual(q["question_id"], pid)
        self.assertIn("metadata", q)
        langs = {d["language"] for d in data[0]["coding_question_details"]}
        self.assertIn("PYTHON", langs)
        self.assertTrue(data[0]["coding_question_details"][0]["is_function_based"])

    def test_practice_non_function_default_codes(self):
        os.environ["PIPELINE_QUESTION_TYPE"] = "nonfunction"
        empty_python_lua = MINIMAL_LUA.replace("print(1)", "")
        data = ppj.build_practice_json(empty_python_lua, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"])
        detail = data[0]["coding_question_details"][0]
        self.assertFalse(detail["is_function_based"])
        self.assertIn("write your code here", detail["code_content"].lower())
        self.assertIsNone(detail["debug_helper_code"])


    # ------------------------------------------------------------------
    # Regression tests for the overnight bug fixes
    # ------------------------------------------------------------------

    def test_exam_default_code_when_cpp_deselected(self):
        """Exactly one language is flagged default_code, even without C++ (P1-H1)."""
        data = ppj.build_exam_json(MINIMAL_LUA, MINIMAL_CONTAINER, "EASY", ["python", "java"])
        details = data[0]["coding_question_details"]
        defaults = [d for d in details if d["default_code"]]
        self.assertEqual(len(defaults), 1)
        # C++ absent -> Python becomes the default.
        self.assertEqual(defaults[0]["language"], "PYTHON39")

    def test_practice_default_code_when_cpp_deselected(self):
        """Practice coding details keep exactly one default without C++ (P1-H1)."""
        data = ppj.build_practice_json(
            MINIMAL_LUA, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["java", "python"]
        )
        details = data[0]["coding_question_details"]
        defaults = [d for d in details if d["default_code"]]
        self.assertEqual(len(defaults), 1)
        self.assertEqual(defaults[0]["language"], "PYTHON")

    def test_practice_solutions_default_when_cpp_deselected(self):
        """Solutions keep exactly one default among the enabled langs (P1-H1)."""
        lua = MINIMAL_LUA + (
            "\n----------SOLUTIONS_CPP_START----------\nint main(){}\n----------SOLUTIONS_CPP_END----------\n"
            "----------SOLUTIONS_PYTHON_START----------\nprint(1)\n----------SOLUTIONS_PYTHON_END----------\n"
        )
        data = ppj.build_practice_json(
            lua, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"]
        )
        sols = data[0]["solutions"]
        self.assertTrue(sols)
        code_details = sols[0]["code_details"]
        # C++ filtered out; Python remains and must be the sole default.
        langs = {cd["language"] for cd in code_details}
        self.assertEqual(langs, {"PYTHON"})
        self.assertEqual(sum(1 for cd in code_details if cd["default_code"]), 1)

    def test_nonfunction_practice_ships_solutions_without_repos(self):
        """Non-function practice: SOLUTIONS_<LANG> (the generated full program)
        reaches the JSON, and the empty CODE_BASE64 section yields no repos."""
        os.environ["PIPELINE_QUESTION_TYPE"] = "nonfunction"
        lua = (
            MINIMAL_LUA.replace(
                "----------CODE_BASE64_PYTHON_START----------\nprint(1)\n",
                "----------CODE_BASE64_PYTHON_START----------\n",
            )
            + "\n----------SOLUTIONS_PYTHON_START----------\nprint(input())\n----------SOLUTIONS_PYTHON_END----------\n"
        )
        data = ppj.build_practice_json(
            lua, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"]
        )
        sols = data[0]["solutions"]
        self.assertTrue(sols, "non-function practice must ship solutions")
        self.assertEqual(sols[0]["code_details"][0]["code_content"], "print(input())")
        self.assertEqual(data[0]["language_code_repository_details"], [])

    def test_function_practice_debug_helper_code(self):
        """Function-based practice surfaces DEBUG_HELPER_CODE_<LANG> (P1-H2)."""
        lua = MINIMAL_LUA + (
            "\n----------DEBUG_HELPER_CODE_PYTHON_START----------\n"
            "----------PRE_USER_CODE_START----------\npre()\n----------PRE_USER_CODE_END----------\n"
            "----------POST_USER_CODE_START----------\npost()\n----------POST_USER_CODE_END----------\n"
            "----------DEBUG_HELPER_CODE_PYTHON_END----------\n"
        )
        data = ppj.build_practice_json(
            lua, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"]
        )
        detail = data[0]["coding_question_details"][0]
        self.assertIsNotNone(detail["debug_helper_code"])
        self.assertIn("pre()", detail["debug_helper_code"])
        self.assertIn("post()", detail["debug_helper_code"])

    def test_parse_difficulty_falls_back_instead_of_crashing(self):
        """Blank QUESTION_LEVEL falls back rather than raising (P1-M11)."""
        blank_lua = MINIMAL_LUA.replace("EASY", "")
        self.assertEqual(ppj.parse_difficulty(blank_lua), "EASY")
        os.environ["PIPELINE_OWNER_DIFFICULTY"] = "MEDIUM"
        self.assertEqual(ppj.parse_difficulty(blank_lua), "MEDIUM")

    def test_node_based_without_cpp_does_not_crash(self):
        """Node-based + C++ deselected must not raise StopIteration (P1-C4)."""
        lua = MINIMAL_LUA + (
            "\n----------NODE_H_CONTENT_START----------\nstruct Node{};\n----------NODE_H_CONTENT_END----------\n"
        )
        # enabled_langs has no cpp -> no CPP repo to attach node.h to.
        data = ppj.build_practice_json(
            lua, PRACTICE_CONTAINER, "EASY", node_based=True, enabled_langs=["python"]
        )
        self.assertTrue(data)  # completed without raising

    def test_language_exclusion_across_all_keys(self):
        """A deselected language is absent from all three per-language keys (items 10/17)."""
        data = ppj.build_practice_json(
            MINIMAL_LUA, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python", "cpp"]
        )
        q = data[0]
        for key in ("coding_question_details", "language_code_repository_details", "test_case_evaluation_metrics"):
            langs = {entry["language"] for entry in q[key]}
            self.assertNotIn("JAVA", langs, f"JAVA leaked into {key}")
            self.assertNotIn("NODE_JS", langs, f"NODE_JS leaked into {key}")

    def test_python_key_casing_practice_vs_exam(self):
        """Practice uses PYTHON, exam uses PYTHON39 for the same input (item 11)."""
        practice = ppj.build_practice_json(
            MINIMAL_LUA, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"]
        )
        exam = ppj.build_exam_json(MINIMAL_LUA, MINIMAL_CONTAINER, "EASY", ["python"])
        practice_langs = {d["language"] for d in practice[0]["coding_question_details"]}
        exam_langs = {d["language"] for d in exam[0]["coding_question_details"]}
        self.assertIn("PYTHON", practice_langs)
        self.assertNotIn("PYTHON39", practice_langs)
        self.assertIn("PYTHON39", exam_langs)
        self.assertNotIn("PYTHON", exam_langs)

    def test_practice_metadata_is_stringified_with_expected_keys(self):
        """Practice metadata is a JSON string with the enrichment/topics keys (item 12)."""
        import json as _json
        data = ppj.build_practice_json(
            MINIMAL_LUA, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"]
        )
        meta = data[0]["question"]["metadata"]
        self.assertIsInstance(meta, str)
        parsed = _json.loads(meta)
        self.assertIn("real_life_example", parsed)
        self.assertIn("follow_up_questions", parsed)
        self.assertIn("topics", parsed)

    def test_exam_metadata_is_null_practice_is_not(self):
        """Exam metadata is None; practice metadata is a string (item 12)."""
        exam = ppj.build_exam_json(MINIMAL_LUA, MINIMAL_CONTAINER, "EASY", ["python"])
        practice = ppj.build_practice_json(
            MINIMAL_LUA, PRACTICE_CONTAINER, "EASY", node_based=False, enabled_langs=["python"]
        )
        self.assertIsNone(exam[0]["question"]["metadata"])
        self.assertIsNotNone(practice[0]["question"]["metadata"])

    def test_score_defaults_by_difficulty(self):
        """Exam total_score defaults to 20/25/30 for EASY/MEDIUM/HARD (item 2)."""
        for level, expected in (("EASY", 20), ("MEDIUM", 25), ("HARD", 30)):
            lua = MINIMAL_LUA.replace("EASY", level)
            data = ppj.build_exam_json(lua, MINIMAL_CONTAINER, level, ["python"])
            self.assertEqual(data[0]["total_score"], expected)

    def test_language_order_is_canonical(self):
        """Per-language arrays follow CPP, PYTHON, JAVA, NODE_JS regardless of input order."""
        lua = MINIMAL_LUA + (
            "\n----------CODE_CONTENT_JAVA_START----------\nclass Main{}\n----------CODE_CONTENT_JAVA_END----------\n"
            "----------CODE_CONTENT_NODE_JS_START----------\nmain()\n----------CODE_CONTENT_NODE_JS_END----------\n"
            "----------CODE_BASE64_JAVA_START----------\nclass Main{}\n----------CODE_BASE64_JAVA_END----------\n"
            "----------CODE_BASE64_NODE_JS_START----------\nmain()\n----------CODE_BASE64_NODE_JS_END----------\n"
        )
        # Intentionally pass in a non-canonical order.
        data = ppj.build_practice_json(
            lua, PRACTICE_CONTAINER, "EASY", node_based=False,
            enabled_langs=["nodejs", "python", "java", "cpp"],
        )
        q = data[0]
        for key in ("coding_question_details", "language_code_repository_details", "test_case_evaluation_metrics"):
            langs = [e["language"] for e in q[key]]
            ordered = [l for l in ["CPP", "PYTHON", "JAVA", "NODE_JS"] if l in langs]
            self.assertEqual(langs, ordered, f"{key} not in canonical order: {langs}")
        # Exam side too.
        exam = ppj.build_exam_json(lua, MINIMAL_CONTAINER, "EASY", ["nodejs", "java", "python", "cpp"])
        elangs = [e["language"] for e in exam[0]["coding_question_details"]]
        self.assertEqual(elangs, [l for l in ["CPP", "PYTHON39", "JAVA", "NODEJS"] if l in elangs])

    def test_parse_companies_splits_on_newlines_only(self):
        """Company names may contain commas; split only on newlines (UI-H2 / 3A)."""
        self.assertEqual(
            ppj.parse_companies("Alphabet, Inc.\nMeta\n  Amazon  "),
            ["Alphabet, Inc.", "Meta", "Amazon"],
        )
        self.assertEqual(ppj.parse_companies(""), [])

    def test_nonfunction_detection_falls_back_to_problem_md(self):
        """When PIPELINE_QUESTION_TYPE is unset, problem.md decides kind (P1-C5)."""
        import tempfile
        os.environ.pop("PIPELINE_QUESTION_TYPE", None)
        original = ppj.INPUTS_DIR
        tmp = tempfile.mkdtemp()
        try:
            with open(os.path.join(tmp, "problem.md"), "w") as f:
                f.write("# Question Type: non-function\n")
            ppj.INPUTS_DIR = tmp
            self.assertTrue(ppj.is_non_function())
        finally:
            ppj.INPUTS_DIR = original


if __name__ == "__main__":
    unittest.main()
