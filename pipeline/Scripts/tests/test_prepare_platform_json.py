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
