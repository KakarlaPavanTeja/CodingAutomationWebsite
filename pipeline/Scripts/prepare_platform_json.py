"""Prepare the ready-to-upload coding_questions.json for the coding platform.

This is the FINAL pipeline step. It consumes the artifacts already produced by
the `package_platform` step (a tag-delimited `.lua` file plus a validated
testcases JSON, both under `Outputs/forJSONPreparation/`) and converts them into
the single-question `coding_questions.json` the platform expects.

The conversion logic is a faithful Python port of the two reference websites the
user previously used by hand:

  * Exam format    -> ported from `create_cq.py` (Python reference).
  * Practice format-> ported from the `create` branch of the LUA->JSON converter
                      in the practice website's `index.html` (`handleGenerate`).

The format is selected by the pipeline mode: practice mode -> practice JSON,
exam mode -> exam JSON (mirroring how `package_platform` branches on `--mode`).
"""

import argparse
import base64
import glob
import json
import os
import sys
import uuid
import random

_BASE = os.environ.get("PIPELINE_BASE_DIR") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
OUTPUTS_DIR = os.path.join(_BASE, "Outputs")
INPUTS_DIR = os.path.join(_BASE, "Inputs")
JSON_PREP_DIR = os.path.join(OUTPUTS_DIR, "forJSONPreparation")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def parse_section(content, start_marker, end_marker):
    """Extract and trim the text between two tag markers.

    Mirrors the reference `parse_section` / `parseSection`: returns "" if either
    marker is missing.
    """
    start_idx = content.find(start_marker)
    if start_idx == -1:
        return ""
    start_idx += len(start_marker)
    end_idx = content.find(end_marker, start_idx)
    if end_idx == -1:
        return ""
    return content[start_idx:end_idx].strip()


def encode_code_to_base64(code):
    return base64.b64encode(code.encode("utf-8")).decode("utf-8")


def get_problem_name():
    """Reconstruct the problem name exactly as `prepare_lua_and_testcases.py` does
    so we can locate the packaged file pair it wrote."""
    titles_path = os.path.join(OUTPUTS_DIR, "generated_titles.txt")
    if not os.path.exists(titles_path):
        return "ProblemName"
    with open(titles_path, "r") as f:
        title_line = f.readline().strip()
        if title_line.startswith("- "):
            title_line = title_line[2:]
        title_line = title_line.split("-")[0].strip()
        return "".join(word.capitalize() for word in title_line.split())


def get_question_type():
    """Determine node-vs-standard the same way `package_platform` does, from the
    `# Type:` line in the input problem statement."""
    problem_md_path = os.path.join(INPUTS_DIR, "problem.md")
    if not os.path.exists(problem_md_path):
        return "standard"
    with open(problem_md_path, "r") as f:
        for line in f:
            if line.startswith("# Type:"):
                return line.replace("# Type:", "").strip().lower().replace("_", " ")
    return "standard"


def is_node_based(question_type):
    return question_type in ["binary tree", "linked list"]


def js_number(value):
    """Mimic JavaScript number serialization: an integer-valued number is emitted
    without a decimal point (5, not 5.0); otherwise it stays a float.

    The practice website builds its JSON in JS, where `parseFloat("5")` becomes
    the Number `5` and `JSON.stringify` writes `5`. Python's `float("5")` would
    write `5.0`, so we down-cast integral values to keep the output byte-for-byte
    identical to the reference site.
    """
    f = float(value)
    if f.is_integer():
        return int(f)
    return f


def locate_pair(mode, problem_name):
    """Find the matching `.lua` + testcases JSON pair for the given mode."""
    suffix = "_exam" if mode == "exam" else ""
    lua_path = os.path.join(JSON_PREP_DIR, f"{problem_name}{suffix}.lua")
    tc_path = os.path.join(JSON_PREP_DIR, f"testcases_{problem_name}{suffix}.json")

    if os.path.exists(lua_path) and os.path.exists(tc_path):
        return lua_path, tc_path

    # Fallback: glob in case the reconstructed problem name differs from what
    # package_platform wrote.
    all_lua = sorted(glob.glob(os.path.join(JSON_PREP_DIR, "*.lua")))
    if mode == "exam":
        cand_lua = [p for p in all_lua if p.endswith("_exam.lua")]
        cand_tc = sorted(glob.glob(os.path.join(JSON_PREP_DIR, "testcases_*_exam.json")))
    else:
        cand_lua = [p for p in all_lua if not p.endswith("_exam.lua")]
        cand_tc = [
            p
            for p in sorted(glob.glob(os.path.join(JSON_PREP_DIR, "testcases_*.json")))
            if not p.endswith("_exam.json")
        ]

    if cand_lua and cand_tc:
        return cand_lua[0], cand_tc[0]

    raise FileNotFoundError(
        f"Could not locate the packaged .lua + testcases JSON pair for mode "
        f"'{mode}' in {JSON_PREP_DIR}. Run the 'Package for Platform' step first.\n"
        f"  expected lua: {lua_path}\n"
        f"  expected testcases: {tc_path}"
    )


def load_testcases(tc_path):
    with open(tc_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list) or len(data) == 0:
        raise ValueError(
            f"Testcases file {tc_path} must be a non-empty JSON array of objects."
        )
    container = data[0]
    if "test_cases" not in container or not isinstance(container["test_cases"], list):
        raise ValueError(
            f"Testcases file {tc_path} is missing a 'test_cases' list."
        )
    return container


def get_owner_total_score():
    """The problem owner's score is FINAL. When set (positive int) it is the
    total weightage for the question and overrides the difficulty-derived
    default. Returns None when the owner did not set a score."""
    raw = os.environ.get("PIPELINE_OWNER_SCORE", "").strip()
    if not raw:
        return None
    try:
        val = int(raw)
    except ValueError:
        return None
    return val if val >= 1 else None


def parse_difficulty(lua):
    difficulty = parse_section(
        lua,
        "----------QUESTION_LEVEL_START----------",
        "----------QUESTION_LEVEL_END----------",
    ).strip().upper()
    if difficulty not in ["EASY", "MEDIUM", "HARD"]:
        raise ValueError(
            f"Invalid QUESTION_LEVEL '{difficulty}': must be one of EASY/MEDIUM/HARD."
        )
    return difficulty


# ---------------------------------------------------------------------------
# Exam format (ported from create_cq.py)
# ---------------------------------------------------------------------------

def exam_parse_test_cases(container):
    test_cases = []
    order_update = 1
    for tc in container["test_cases"]:
        test_case = {
            "id": str(uuid.uuid4()),
            "input": tc["input"],
            "output": tc.get("output", ""),
            "is_hidden": order_update > 2,
            "weightage": None,
            "evaluation_type": "DEFAULT",
            "display_text": None,
            "criteria": None,
            "tags": [],
            "order": order_update,
        }
        if tc.get("multiple_possible_output"):
            test_case["multiple_possible_output"] = True
            test_case["outputs"] = tc["outputs"]
        test_cases.append(test_case)
        order_update += 1
    return test_cases


def exam_assign_weights(test_cases, difficulty_level, total_score_override=None):
    totals = {"EASY": 20, "MEDIUM": 25, "HARD": 30}
    level = difficulty_level.strip().upper()
    if level not in totals:
        raise ValueError(f"Unknown difficulty level: {difficulty_level}")
    total_score = total_score_override if total_score_override is not None else totals[level]
    n = len(test_cases)
    if n == 0:
        return test_cases
    # The owner-set total score is FINAL. If it is too small to give every test
    # case the usual 0.1 floor, shrink the floor so the distribution still sums
    # to exactly total_score instead of raising.
    min_weight = min(0.1, round(total_score / n, 2)) if total_score < n * 0.1 else 0.1
    weights = [min_weight] * n
    remaining = total_score - n * min_weight
    random_parts = [random.random() for _ in range(n)]
    total_parts = sum(random_parts) if sum(random_parts) > 0 else 1
    for i in range(n):
        extra = (random_parts[i] / total_parts) * remaining
        weights[i] = round(weights[i] + extra, 2)
    diff = round(total_score - sum(weights), 2)
    weights[-1] = round(weights[-1] + diff, 2)
    for i, tc in enumerate(test_cases):
        tc["weightage"] = weights[i]
    return test_cases


def build_exam_json(lua, container, difficulty):
    owner_total_score = get_owner_total_score()
    test_cases = exam_assign_weights(
        exam_parse_test_cases(container), difficulty, owner_total_score
    )
    total_score = (
        owner_total_score
        if owner_total_score is not None
        else {"EASY": 20, "MEDIUM": 25, "HARD": 30}[difficulty]
    )
    question_id = str(uuid.uuid4())
    coding_details_id = str(uuid.uuid4())

    def sec(start, end):
        return parse_section(lua, start, end)

    json_data = [
        {
            "test_cases": test_cases,
            "total_score": total_score,
            "question_type": "CODING",
            "question_asked_by_companies_info": [],
            "question": {
                "difficulty": difficulty,
                "content": sec(
                    "----------QUESTION_DESCRIPTION_START----------",
                    "----------QUESTION_DESCRIPTION_END----------",
                ),
                "short_text": sec(
                    "----------SHORT_TEXT_START----------",
                    "----------SHORT_TEXT_END----------",
                ),
                "multimedia": [],
                "language": "ENGLISH",
                "content_type": "MARKDOWN",
                "question_id": question_id,
                "default_tag_names": [],
                "concept_tag_names": [],
                "metadata": None,
            },
            "coding_question_details": [
                {
                    "code_content": sec(
                        "----------CODE_CONTENT_CPP_START----------",
                        "----------CODE_CONTENT_CPP_END----------",
                    ),
                    "default_code": True,
                    "language": "CPP",
                    "code_id": coding_details_id,
                    "is_function_based": True,
                },
                {
                    "code_content": sec(
                        "----------CODE_CONTENT_PYTHON_START----------",
                        "----------CODE_CONTENT_PYTHON_END----------",
                    ),
                    "default_code": False,
                    "language": "PYTHON39",
                    "code_id": coding_details_id,
                    "is_function_based": True,
                },
                {
                    "code_content": sec(
                        "----------CODE_CONTENT_JAVA_START----------",
                        "----------CODE_CONTENT_JAVA_END----------",
                    ),
                    "default_code": False,
                    "language": "JAVA",
                    "code_id": coding_details_id,
                    "is_function_based": True,
                },
            ],
            "language_code_repository_details": [
                {
                    "language": "CPP",
                    "file_path_to_execute": "main.cpp",
                    "default_file_path_to_submit_code": "solution.cpp",
                    "code_repository": [
                        {
                            "file_name": "main.cpp",
                            "file_type": "FILE",
                            "file_content": encode_code_to_base64(
                                sec(
                                    "----------CODE_BASE64_CPP_START----------",
                                    "----------CODE_BASE64_CPP_END----------",
                                )
                            ),
                        }
                    ],
                },
                {
                    "language": "PYTHON39",
                    "file_path_to_execute": "main.py",
                    "default_file_path_to_submit_code": "solution.py",
                    "code_repository": [
                        {
                            "file_name": "main.py",
                            "file_type": "FILE",
                            "file_content": encode_code_to_base64(
                                sec(
                                    "----------CODE_BASE64_PYTHON_START----------",
                                    "----------CODE_BASE64_PYTHON_END----------",
                                )
                            ),
                        }
                    ],
                },
                {
                    "language": "JAVA",
                    "file_path_to_execute": "Main.java",
                    "default_file_path_to_submit_code": "Solution.java",
                    "code_repository": [
                        {
                            "file_name": "Main.java",
                            "file_type": "FILE",
                            "file_content": encode_code_to_base64(
                                sec(
                                    "----------CODE_BASE64_JAVA_START----------",
                                    "----------CODE_BASE64_JAVA_END----------",
                                )
                            ),
                        }
                    ],
                },
            ],
            "solutions": [],
            "hints": [],
            "code_repository_details": None,
            "test_case_evaluation_metrics": [
                {"language": "CPP", "time_limit_to_execute_in_seconds": 1.0},
                {"language": "PYTHON39", "time_limit_to_execute_in_seconds": 4.0},
                {"language": "JAVA", "time_limit_to_execute_in_seconds": 2.0},
            ],
        }
    ]
    return json_data


# ---------------------------------------------------------------------------
# Practice format (ported from index.html handleGenerate `create` branch)
# ---------------------------------------------------------------------------

def parse_tags(s):
    if not s:
        return []
    return [t.strip() for t in s.split(",") if t.strip()]


def format_companies(tags):
    return [{"company_name": c.strip().upper()} for c in tags]


def practice_parse_hints(lua):
    block = parse_section(
        lua, "----------HINTS_START----------", "----------HINTS_END----------"
    )
    if not block:
        return []
    hints = []
    i = 1
    while True:
        description_text = parse_section(
            block, f"----------HINTS_START_{i}----------", f"----------HINTS_END_{i}----------"
        )
        if not description_text:
            break
        hints.append(
            {
                "duration_to_unlock_hint_in_seconds": 0,
                "order": i,
                "title": {"content": f"Hint {i}", "content_type": "TEXT"},
                "description": {"content": description_text, "content_type": "MARKDOWN"},
            }
        )
        i += 1
    return hints


def practice_parse_follow_up_questions(lua):
    block = parse_section(
        lua,
        "----------FOLLOW_UP_QUESTIONS_START----------",
        "----------FOLLOW_UP_QUESTIONS_END----------",
    )
    if not block:
        return []
    questions = []
    i = 1
    while True:
        b = parse_section(
            block,
            f"----------FOLLOW_UP_QUESTION_START_{i}----------",
            f"----------FOLLOW_UP_QUESTION_END_{i}----------",
        )
        if not b:
            break
        title_text = parse_section(
            b, "----------QUESTION_START----------", "----------QUESTION_END----------"
        )
        content_text = parse_section(
            b, "----------ANSWER_START----------", "----------ANSWER_END----------"
        )
        if title_text and content_text:
            questions.append(
                {
                    "title": title_text,
                    "content": {"content_type": "MARKDOWN", "content": content_text},
                }
            )
        i += 1
    return questions


def practice_parse_debug_helper_code(lua, lang):
    block = parse_section(
        lua,
        f"----------DEBUG_HELPER_CODE_{lang.upper()}_START----------",
        f"----------DEBUG_HELPER_CODE_{lang.upper()}_END----------",
    )
    if not block:
        return None
    return json.dumps(
        {
            "pre_user_code": parse_section(
                block,
                "----------PRE_USER_CODE_START----------",
                "----------PRE_USER_CODE_END----------",
            ),
            "post_user_code": parse_section(
                block,
                "----------POST_USER_CODE_START----------",
                "----------POST_USER_CODE_END----------",
            ),
        },
        indent=2,
        ensure_ascii=False,
    )


def practice_parse_test_cases(container):
    test_cases = []
    for i, tc in enumerate(container["test_cases"]):
        if tc.get("input") is None:
            raise ValueError(f"Test case at index {i} is missing 'input'.")
        if tc.get("weightage") is None:
            raise ValueError(f"Test case at index {i} is missing 'weightage'.")
        if tc.get("order") is None:
            raise ValueError(f"Test case at index {i} is missing 'order'.")

        is_multiple_output = tc.get("multiple_possible_output") is True
        if is_multiple_output and (
            not isinstance(tc.get("outputs"), list) or len(tc["outputs"]) == 0
        ):
            raise ValueError(f"Test case at index {i} missing 'outputs'.")
        if not is_multiple_output and tc.get("output") is None:
            raise ValueError(f"Test case at index {i} missing 'output'.")

        base = {
            "id": str(uuid.uuid4()),
            "input": tc["input"],
            "output": tc.get("output") or "",
            "is_hidden": (i + 1) > 2,
            "weightage": js_number(tc["weightage"]),
            "evaluation_type": "DEFAULT",
            "display_text": None,
            "criteria": None,
            "tags": [],
            "order": tc["order"],
        }
        if is_multiple_output:
            base["output"] = None
            base["multiple_possible_output"] = True
            base["outputs"] = tc["outputs"]
        test_cases.append(base)
    return test_cases


def practice_calculate_total_score(test_cases):
    total = sum(float(tc["weightage"]) for tc in test_cases)
    return js_number(round(total, 2))


def practice_parse_solutions(lua):
    solutions_code_id = str(uuid.uuid4())
    cpp = parse_section(
        lua, "----------SOLUTIONS_CPP_START----------", "----------SOLUTIONS_CPP_END----------"
    )
    python = parse_section(
        lua, "----------SOLUTIONS_PYTHON_START----------", "----------SOLUTIONS_PYTHON_END----------"
    )
    java = parse_section(
        lua, "----------SOLUTIONS_JAVA_START----------", "----------SOLUTIONS_JAVA_END----------"
    )
    node = parse_section(
        lua, "----------SOLUTIONS_NODE_JS_START----------", "----------SOLUTIONS_NODE_JS_END----------"
    )

    code_details = []
    if cpp:
        code_details.append(
            {"code_id": solutions_code_id, "code_content": cpp, "language": "CPP", "default_code": True}
        )
    if python:
        code_details.append(
            {"code_id": solutions_code_id, "code_content": python, "language": "PYTHON", "default_code": False}
        )
    if java:
        code_details.append(
            {"code_id": solutions_code_id, "code_content": java, "language": "JAVA", "default_code": False}
        )
    if node:
        code_details.append(
            {"code_id": solutions_code_id, "code_content": node, "language": "NODE_JS", "default_code": False}
        )

    if len(code_details) == 0:
        return []
    return [
        {
            "order": 1,
            "title": {"content": "Code", "content_type": "TEXT"},
            "description": {"content": "", "content_type": ""},
            "code_details": code_details,
            "complexity_analysis": {"content": "", "content_type": ""},
        }
    ]


def build_practice_json(lua, container, difficulty, node_based):
    parsed_test_cases = practice_parse_test_cases(container)
    owner_total_score = get_owner_total_score()
    total_score = (
        js_number(owner_total_score)
        if owner_total_score is not None
        else practice_calculate_total_score(parsed_test_cases)
    )

    def sec(start, end):
        return parse_section(lua, start, end)

    beginner_tags = parse_tags(
        sec("----------BEGINNER_TOPICS_START----------", "----------BEGINNER_TOPICS_END----------")
    )
    intermediate_tags = parse_tags(
        sec("----------INTERMEDIATE_TOPICS_START----------", "----------INTERMEDIATE_TOPICS_END----------")
    )
    advanced_tags = parse_tags(
        sec("----------ADVANCED_TOPICS_START----------", "----------ADVANCED_TOPICS_END----------")
    )
    tags = [*beginner_tags, *intermediate_tags, *advanced_tags]

    metadata_string = json.dumps(
        {
            "real_life_example": sec(
                "----------REAL_LIFE_EXAMPLES_START----------",
                "----------REAL_LIFE_EXAMPLES_END----------",
            ),
            "follow_up_questions": practice_parse_follow_up_questions(lua),
            "topics": tags,
        },
        indent=2,
        ensure_ascii=False,
    )

    code_content_id = str(uuid.uuid4())
    question_id = str(uuid.uuid4())

    def build_coding_details(lang, content_start, content_end):
        return {
            "code_content": sec(content_start, content_end),
            "default_code": lang == "CPP",
            "language": lang,
            "code_id": code_content_id,
            "is_function_based": True,
            "debug_helper_code": None
            if lang == "NODE_JS"
            else practice_parse_debug_helper_code(lua, lang),
        }

    def build_repo(lang, exec_file, def_file, key_start, key_end):
        return {
            "language": lang,
            "file_path_to_execute": exec_file,
            "default_file_path_to_submit_code": def_file,
            "code_repository": [
                {
                    "file_name": exec_file,
                    "file_type": "FILE",
                    "file_content": encode_code_to_base64(sec(key_start, key_end)),
                }
            ],
        }

    final_json = [
        {
            "test_cases": parsed_test_cases,
            "total_score": total_score,
            "question_type": "CODING",
            "question_asked_by_companies_info": format_companies(
                parse_tags(sec("----------COMPANIES_START----------", "----------COMPANIES_END----------"))
            ),
            "question": {
                "difficulty": difficulty,
                "content": sec(
                    "----------QUESTION_DESCRIPTION_START----------",
                    "----------QUESTION_DESCRIPTION_END----------",
                ),
                "short_text": sec(
                    "----------SHORT_TEXT_START----------",
                    "----------SHORT_TEXT_END----------",
                ),
                "multimedia": [],
                "language": "ENGLISH",
                "content_type": "MARKDOWN",
                "question_id": question_id,
                "default_tag_names": parse_tags(
                    sec("----------DEFAULT_TAGS_START----------", "----------DEFAULT_TAGS_END----------")
                ),
                "concept_tag_names": [],
                "concept_filter_tag_names": tags,
                "topic_tag_names": {
                    "beginner_tag_names": beginner_tags,
                    "intermediate_tag_names": intermediate_tags,
                    "advanced_tag_names": advanced_tags,
                },
                "metadata": metadata_string,
            },
            "coding_question_details": [
                build_coding_details(
                    "CPP", "----------CODE_CONTENT_CPP_START----------", "----------CODE_CONTENT_CPP_END----------"
                ),
                build_coding_details(
                    "PYTHON", "----------CODE_CONTENT_PYTHON_START----------", "----------CODE_CONTENT_PYTHON_END----------"
                ),
                build_coding_details(
                    "JAVA", "----------CODE_CONTENT_JAVA_START----------", "----------CODE_CONTENT_JAVA_END----------"
                ),
                build_coding_details(
                    "NODE_JS", "----------CODE_CONTENT_NODE_JS_START----------", "----------CODE_CONTENT_NODE_JS_END----------"
                ),
            ],
            "code_repository_details": None,
            "language_code_repository_details": [
                build_repo(
                    "CPP", "main.cpp", "solution.cpp",
                    "----------CODE_BASE64_CPP_START----------", "----------CODE_BASE64_CPP_END----------",
                ),
                build_repo(
                    "PYTHON", "main.py", "solution.py",
                    "----------CODE_BASE64_PYTHON_START----------", "----------CODE_BASE64_PYTHON_END----------",
                ),
                build_repo(
                    "JAVA", "Main.java", "Solution.java",
                    "----------CODE_BASE64_JAVA_START----------", "----------CODE_BASE64_JAVA_END----------",
                ),
                build_repo(
                    "NODE_JS", "Main.js", "Solution.js",
                    "----------CODE_BASE64_NODE_JS_START----------", "----------CODE_BASE64_NODE_JS_END----------",
                ),
            ],
            "solutions": practice_parse_solutions(lua),
            "hints": practice_parse_hints(lua),
            "test_case_evaluation_metrics": [
                {"language": "CPP", "time_limit_to_execute_in_seconds": 1.0},
                {"language": "PYTHON", "time_limit_to_execute_in_seconds": 4.0},
                {"language": "JAVA", "time_limit_to_execute_in_seconds": 2.0},
                {"language": "NODE_JS", "time_limit_to_execute_in_seconds": 2.0},
            ],
        }
    ]

    if node_based:
        node_h = sec(
            "----------NODE_H_CONTENT_START----------", "----------NODE_H_CONTENT_END----------"
        )
        if not node_h:
            raise ValueError(
                "Node-Based question requires NODE_H_CONTENT in the .lua file, but it "
                "was empty or missing."
            )
        cpp_repo = next(
            r for r in final_json[0]["language_code_repository_details"] if r["language"] == "CPP"
        )
        existing = next(
            (f for f in cpp_repo["code_repository"] if f["file_name"] == "node.h"), None
        )
        if existing:
            existing["file_content"] = encode_code_to_base64(node_h)
        else:
            cpp_repo["code_repository"].append(
                {"file_name": "node.h", "file_type": "FILE", "file_content": encode_code_to_base64(node_h)}
            )

    return final_json


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Prepare the platform-ready coding_questions.json from packaged outputs."
    )
    parser.add_argument(
        "--mode",
        choices=["practice", "exam"],
        default="practice",
        help="Which format to generate (default: practice).",
    )
    args = parser.parse_args()
    mode = args.mode

    problem_name = get_problem_name()
    question_type = get_question_type()
    node_based = is_node_based(question_type)

    print(f"Mode: {mode}")
    print(f"Problem Name: {problem_name}")
    print(f"Question Type: {question_type} (node-based: {node_based})")

    lua_path, tc_path = locate_pair(mode, problem_name)
    print(f"Using LUA file: {lua_path}")
    print(f"Using testcases file: {tc_path}")

    with open(lua_path, "r", encoding="utf-8") as f:
        lua = f.read()
    container = load_testcases(tc_path)
    difficulty = parse_difficulty(lua)
    print(f"Difficulty: {difficulty}")
    print(f"Test cases: {len(container['test_cases'])}")

    if mode == "exam":
        json_data = build_exam_json(lua, container, difficulty)
        out = json.dumps(json_data, indent=4)
    else:
        json_data = build_practice_json(lua, container, difficulty, node_based)
        out = json.dumps(json_data, indent=4, ensure_ascii=False)

    os.makedirs(JSON_PREP_DIR, exist_ok=True)
    out_path = os.path.join(JSON_PREP_DIR, "coding_questions.json")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(out)

    print(f"Wrote platform JSON to {out_path}")
    print(f"  total_score = {json_data[0]['total_score']}")
    print(f"  test_cases  = {len(json_data[0]['test_cases'])}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error in prepare_platform_json.py: {e}", file=sys.stderr)
        sys.exit(1)
