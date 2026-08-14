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
import re
import sys
import uuid
import random

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from testcase_helpers import sync_size_tags_json_root  # noqa: E402

_BASE = os.environ.get("PIPELINE_BASE_DIR") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
OUTPUTS_DIR = os.path.join(_BASE, "Outputs")
INPUTS_DIR = os.path.join(_BASE, "Inputs")
JSON_PREP_DIR = os.path.join(OUTPUTS_DIR, "forJSONPreparation")
# Canonical testcases file, produced by the generate-testcases step. The JSON
# prep step reads it directly instead of a per-mode copy under forJSONPreparation/.
TESTCASES_SOURCE = os.path.join(OUTPUTS_DIR, "testcases.json")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

# INVARIANT: no test case may have weightage <= 0. WEIGHT_FLOOR is the smallest
# strictly-positive weight a case can be assigned/repaired to.
WEIGHT_FLOOR = 0.01


def _ensure_positive_weights(weights):
    """Guarantee every weight is strictly > 0 (the hard invariant).

    Any weight <= 0 (e.g. from a negative rounding residue) is lifted to WEIGHT_FLOOR
    and the cost is borrowed from the largest weight that can still stay >= WEIGHT_FLOOR
    afterwards, so the grand total is preserved whenever that is feasible. In the
    degenerate regime where the total is too small for every case to clear the floor
    (e.g. score 1 spread over 500 cases — impossible at 2-decimal precision), positivity
    is prioritized over the exact sum. Mutates and returns the list.
    """
    n = len(weights)
    if n == 0:
        return weights
    for i in range(n):
        if weights[i] <= 0:
            deficit = round(WEIGHT_FLOOR - weights[i], 2)
            weights[i] = WEIGHT_FLOOR
            # Borrow from the largest donor that remains >= WEIGHT_FLOOR after paying.
            for j in sorted((k for k in range(n) if k != i),
                            key=lambda k: weights[k], reverse=True):
                if round(weights[j] - deficit, 2) >= WEIGHT_FLOOR:
                    weights[j] = round(weights[j] - deficit, 2)
                    break
            # else: infeasible to preserve the sum — keep positivity, accept drift.
    return weights


def _scale_weights_to_total(test_cases, total_score):
    """Scale existing per-case weightage to sum exactly to total_score, preserving
    their RELATIVE proportions (the subtask/stress weighting baked into the generated
    suite). This is what makes EXAM scoring use the same mechanism as PRACTICE instead
    of a flat random spread. Guarantees every weight > 0.

    Returns True if it scaled from real generated weights; False if the suite carries
    no usable weights (some missing or <= 0), so the caller can fall back.
    """
    n = len(test_cases)
    if n == 0:
        return True
    raw = []
    for tc in test_cases:
        try:
            raw.append(float(tc.get("weightage")))
        except (TypeError, ValueError):
            raw.append(None)
    if any(w is None or w <= 0 for w in raw):
        return False
    s = sum(raw)
    if s <= 0:
        return False
    weights = [round(w / s * total_score, 2) for w in raw]
    # Absorb the rounding residual into the largest weight, then guarantee positivity.
    diff = round(total_score - sum(weights), 2)
    if diff:
        j = max(range(n), key=lambda k: weights[k])
        weights[j] = round(weights[j] + diff, 2)
    _ensure_positive_weights(weights)
    for tc, w in zip(test_cases, weights):
        tc["weightage"] = w
    return True


def _generated_weight_total(test_cases):
    """Sum of the generated per-case weights, or None if any is missing/<=0.

    Lets exam use the SAME total-score fallback as practice (sum of generated weights)
    when no owner score is set, instead of the difficulty default.
    """
    if not test_cases:
        return None
    total = 0.0
    for tc in test_cases:
        try:
            w = float(tc.get("weightage"))
        except (TypeError, ValueError):
            return None
        if w <= 0:
            return None
        total += w
    return round(total, 2)


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
    # Match prepare_lua: owner title wins, used verbatim (req 14).
    owner = os.environ.get("PIPELINE_OWNER_TITLE", "").strip()
    if owner:
        return "".join(word.capitalize() for word in owner.split())
    titles_path = os.path.join(OUTPUTS_DIR, "generated_titles.txt")
    if not os.path.exists(titles_path):
        return "ProblemName"
    with open(titles_path, "r") as f:
        title_line = f.readline().strip()
        if title_line.startswith("- "):
            title_line = title_line[2:]
        # Trailing "- 95%" only, matching prepare_lua_and_testcases — splitting
        # on the first "-" truncated hyphenated titles ("Two-Sum" -> "Two"), and
        # this name must equal the one prepare_lua used to write the .lua file.
        title_line = re.sub(r"\s*-\s*\d+(?:\.\d+)?%\s*$", "", title_line).strip()
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


def locate_lua(mode, problem_name):
    """Find the packaged `.lua` file for the given mode.

    Only the `.lua` is located here; the test cases are read directly from the
    canonical `Outputs/testcases.json` (see `load_source_testcases`) rather than a
    per-mode copy under forJSONPreparation/.
    """
    suffix = "_exam" if mode == "exam" else ""
    lua_path = os.path.join(JSON_PREP_DIR, f"{problem_name}{suffix}.lua")

    if os.path.exists(lua_path):
        return lua_path

    # Fallback: glob in case the reconstructed problem name differs from what
    # package_platform wrote.
    all_lua = sorted(glob.glob(os.path.join(JSON_PREP_DIR, "*.lua")))
    if mode == "exam":
        cand_lua = [p for p in all_lua if p.endswith("_exam.lua")]
    else:
        cand_lua = [p for p in all_lua if not p.endswith("_exam.lua")]

    if cand_lua:
        return cand_lua[0]

    raise FileNotFoundError(
        f"Could not locate the packaged .lua file for mode '{mode}' in "
        f"{JSON_PREP_DIR}. Run the 'Package for Platform' step first.\n"
        f"  expected lua: {lua_path}"
    )


def _validate_and_extract_container(data, source):
    """Structural validation shared by load_testcases / load_source_testcases."""
    if not isinstance(data, list) or len(data) == 0:
        raise ValueError(
            f"Testcases file {source} must be a non-empty JSON array of objects."
        )
    container = data[0]
    if "test_cases" not in container or not isinstance(container["test_cases"], list):
        raise ValueError(
            f"Testcases file {source} is missing a 'test_cases' list."
        )
    return container


def load_testcases(tc_path):
    with open(tc_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return _validate_and_extract_container(data, tc_path)


def load_source_testcases():
    """Read the canonical `Outputs/testcases.json`, apply the same validation and
    corrections the `package_platform` step used to bake into
    `forJSONPreparation/testcases_*.json`, and return the validated container.

    Reading the canonical file directly avoids maintaining a second on-disk copy;
    the corrections (dict->list, size_* tag sync, missing-key defaults, tag
    normalization, sequential order) are applied in-memory here instead.
    """
    src = TESTCASES_SOURCE
    if not os.path.exists(src):
        raise FileNotFoundError(
            f"Could not find {src}. Run the 'Generate Testcases' step first."
        )

    with open(src, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Auto-correct if root is a dictionary containing "test_cases".
    if isinstance(data, dict) and "test_cases" in data:
        print("Auto-correcting testcases.json structure from dictionary to list.")
        data = [data]

    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict) and "test_cases" in data[0]:
        container = data[0]
        desc_path = os.path.join(OUTPUTS_DIR, "generated_description.md")
        if os.path.exists(desc_path):
            with open(desc_path, "r", encoding="utf-8") as df:
                description = df.read()
            tags_fixed = sync_size_tags_json_root(data, description)
            if tags_fixed:
                print(f"Corrected size_* tags on {tags_fixed} case(s) from derived input sizes.")
        tc_list = container["test_cases"]
        print(f"Validating {len(tc_list)} test cases...")
        for idx, tc in enumerate(tc_list, 1):
            # Ensure all keys are present.
            for key in ["input", "output", "weightage", "order"]:
                if key not in tc:
                    if key == "weightage":
                        tc[key] = 5
                    elif key == "order":
                        tc[key] = idx
                    else:
                        tc[key] = ""  # fallback for input/output

            # Preserve the v4 subtask/scenario tags so they survive into the
            # platform JSON. Normalize to a list of strings.
            raw_tags = tc.get("tags", [])
            if isinstance(raw_tags, str):
                raw_tags = [raw_tags]
            elif not isinstance(raw_tags, list):
                raw_tags = []
            tc["tags"] = [str(t) for t in raw_tags]

            # Fix order if incorrect.
            if tc["order"] != idx:
                tc["order"] = idx

    return _validate_and_extract_container(data, src)


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


def get_question_id():
    """Use the problem UUID when available for traceability."""
    pid = os.environ.get("PIPELINE_PROBLEM_ID", "").strip()
    return pid if pid else str(uuid.uuid4())


def get_pipeline_question_kind():
    return os.environ.get("PIPELINE_QUESTION_TYPE", "function").strip().lower()


def get_question_kind_from_md():
    """Read the question kind from the input `problem.md` `# Question Type:` line,
    mirroring `prepare_lua_and_testcases.get_question_kind_from_md` so the LUA
    builder and JSON builder agree on function-vs-non-function (req 7/8/10)."""
    problem_md_path = os.path.join(INPUTS_DIR, "problem.md")
    if not os.path.exists(problem_md_path):
        return ""
    with open(problem_md_path, "r") as f:
        for line in f:
            if line.startswith("# Question Type:"):
                val = line.replace("# Question Type:", "").strip().lower()
                return "nonfunction" if "non" in val else "function"
    return ""


def is_non_function():
    if get_pipeline_question_kind() in ("nonfunction", "non-function", "non_function"):
        return True
    # When the env var is unset/empty, fall back to problem.md so this builder
    # does not diverge from the LUA builder (which also consults problem.md).
    if not os.environ.get("PIPELINE_QUESTION_TYPE", "").strip():
        return get_question_kind_from_md() == "nonfunction"
    return False


def parse_enabled_langs(cli_langs=None):
    raw = cli_langs or os.environ.get("PIPELINE_ENABLED_LANGS", "python,cpp,java,nodejs")
    if isinstance(raw, list):
        langs = [str(l).strip().lower() for l in raw if str(l).strip()]
    else:
        langs = [l.strip().lower() for l in str(raw).split(",") if l.strip()]
    return langs or ["python", "cpp", "java", "nodejs"]


# Canonical language order for every per-language array in the JSON
# (coding_question_details, repos, solutions, metrics): CPP, Python, Java, Node.js.
LANG_CANONICAL_ORDER = ["cpp", "python", "java", "nodejs"]


def order_langs_canonically(enabled_langs):
    rank = {l: i for i, l in enumerate(LANG_CANONICAL_ORDER)}
    return sorted(enabled_langs, key=lambda l: rank.get(l, 99))


def pick_default_lang_id(enabled_langs):
    """The platform expects exactly one language flagged `default_code: true`.
    Prefer C++ (historical default), then Python, Java, Node.js; fall back to the
    first enabled language so deselecting C++ still yields a valid default (req 10/17)."""
    for l in ("cpp", "python", "java", "nodejs"):
        if l in enabled_langs:
            return l
    return enabled_langs[0] if enabled_langs else None


def get_default_tag_names_from_env():
    raw = os.environ.get("PIPELINE_DEFAULT_TAGS", "").strip()
    if not raw:
        return []
    return [line.strip() for line in raw.split("\n") if line.strip()]


NON_FUNCTION_DEFAULT_CODES = {
    "CPP": '#include<bits/stdc++.h>\nusing namespace std;\n \nint main() {\n    // write your code here...\n    return 0;\n}',
    "PYTHON39": "# write your code here...",
    "PYTHON": "# write your code here...",
    "JAVA": 'class Main {\n    public static void main(String[] args) {\n        // write your code here...\n        System.out.println("");\n    }\n}',
    "NODEJS": 'const fs = require(\'fs\');\n\nfunction main() {\n    // Write your code here...\n    console.log("Hello, World!");\n}\n\nmain();',
    "NODE_JS": 'const fs = require(\'fs\');\n\nfunction main() {\n    // Write your code here...\n    console.log("Hello, World!");\n}\n\nmain();',
}

LANG_PLATFORM = {
    "cpp": {
        "practice": "CPP",
        "exam": "CPP",
        "content_markers": ("----------CODE_CONTENT_CPP_START----------", "----------CODE_CONTENT_CPP_END----------"),
        "base64_markers": ("----------CODE_BASE64_CPP_START----------", "----------CODE_BASE64_CPP_END----------"),
        "exec_file": "main.cpp",
        "submit_file": "solution.cpp",
        "metrics_sec": 1.0,
        "solution_marker": ("----------SOLUTIONS_CPP_START----------", "----------SOLUTIONS_CPP_END----------"),
    },
    "python": {
        "practice": "PYTHON",
        "exam": "PYTHON39",
        "content_markers": ("----------CODE_CONTENT_PYTHON_START----------", "----------CODE_CONTENT_PYTHON_END----------"),
        "base64_markers": ("----------CODE_BASE64_PYTHON_START----------", "----------CODE_BASE64_PYTHON_END----------"),
        "exec_file": "main.py",
        "submit_file": "solution.py",
        "metrics_sec": 4.0,
        "solution_marker": ("----------SOLUTIONS_PYTHON_START----------", "----------SOLUTIONS_PYTHON_END----------"),
    },
    "java": {
        "practice": "JAVA",
        "exam": "JAVA",
        "content_markers": ("----------CODE_CONTENT_JAVA_START----------", "----------CODE_CONTENT_JAVA_END----------"),
        "base64_markers": ("----------CODE_BASE64_JAVA_START----------", "----------CODE_BASE64_JAVA_END----------"),
        "exec_file": "Main.java",
        "submit_file": "Solution.java",
        "metrics_sec": 2.0,
        "solution_marker": ("----------SOLUTIONS_JAVA_START----------", "----------SOLUTIONS_JAVA_END----------"),
    },
    "nodejs": {
        "practice": "NODE_JS",
        "exam": "NODEJS",
        "content_markers": ("----------CODE_CONTENT_NODE_JS_START----------", "----------CODE_CONTENT_NODE_JS_END----------"),
        "base64_markers": ("----------CODE_BASE64_NODE_JS_START----------", "----------CODE_BASE64_NODE_JS_END----------"),
        "exec_file": "Main.js",
        "submit_file": "Solution.js",
        "metrics_sec": 2.0,
        "solution_marker": ("----------SOLUTIONS_NODE_JS_START----------", "----------SOLUTIONS_NODE_JS_END----------"),
    },
}


def parse_difficulty(lua):
    difficulty = parse_section(
        lua,
        "----------QUESTION_LEVEL_START----------",
        "----------QUESTION_LEVEL_END----------",
    ).strip().upper()
    if difficulty in ["EASY", "MEDIUM", "HARD"]:
        return difficulty
    # Fall back to the owner-set difficulty, then EASY, instead of crashing the
    # final packaging step on a blank/invalid QUESTION_LEVEL (req 3).
    owner = os.environ.get("PIPELINE_OWNER_DIFFICULTY", "").strip().upper()
    if owner in ["EASY", "MEDIUM", "HARD"]:
        return owner
    print(
        f"Warning: invalid/blank QUESTION_LEVEL '{difficulty}'; defaulting to EASY.",
        file=sys.stderr,
    )
    return "EASY"


# ---------------------------------------------------------------------------
# Exam format (ported from create_cq.py)
# ---------------------------------------------------------------------------

def _tag_display_name(name_enum):
    """Human-readable label for a tag enum: "subtask_1" -> "Subtask 1",
    "stress" -> "Stress", "size_large" -> "Size Large"."""
    return " ".join(word.capitalize() for word in str(name_enum).split("_") if word)


def normalize_tags(tc, subtask_names=None):
    """Carry the v4 subtask/scenario tags through to the platform JSON.

    v4 emits a per-case `tags` list of strings (e.g. ["subtask_3", "stress"]).
    The platform expects each tag as an object with both an enum and a label:
    `{"name_enum": "subtask_1", "display_name": "Subtask 1"}`, so we wrap every
    tag accordingly. Already-wrapped dict tags are passed through, keeping any
    display_name they already carry (idempotent). Empty/blank tags are dropped;
    default to [] when absent.

    `subtask_names` is the suite's root-level map (`{"subtask_5": "Max Constraint
    Performance"}`). Only the LABEL takes the semantic name — the enum stays
    `subtask_<n>` because `tier_from_tags`/`_scenario_of` read it positionally.
    Suites written before the map existed just fall back to "Subtask 5".
    """
    raw = tc.get("tags", [])
    if isinstance(raw, str):
        raw = [raw]
    elif not isinstance(raw, list):
        raw = []

    out = []
    seen = set()
    for t in raw:
        if isinstance(t, dict):
            name = str(t.get("name_enum", "")).strip()
            display = str(t.get("display_name", "")).strip()
        else:
            name = str(t).strip()
            display = ""
        if not name or name in seen:
            continue
        seen.add(name)
        if not display and subtask_names:
            display = str(subtask_names.get(name, "")).strip()
        out.append({"name_enum": name, "display_name": display or _tag_display_name(name)})
    return out


def exam_parse_test_cases(container):
    subtask_names = container.get("subtask_names") or {}
    test_cases = []
    order_update = 1
    for tc in container["test_cases"]:
        test_case = {
            "id": str(uuid.uuid4()),
            "input": tc["input"],
            "output": tc.get("output", ""),
            "is_hidden": order_update > 2,
            # Preserve the generated subtask/stress weight so exam can reuse the same
            # scoring mechanism as practice (scaled to total_score in build_exam_json).
            "weightage": tc.get("weightage"),
            "evaluation_type": "DEFAULT",
            "display_text": None,
            "criteria": None,
            "tags": normalize_tags(tc, subtask_names),
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
    # INVARIANT: every test case ends with weightage > 0 (never <= 0).
    # If the owner-set total is too small to give every case the usual 0.1 floor,
    # shrink the floor but keep it strictly positive (>= WEIGHT_FLOOR).
    min_weight = 0.1
    if total_score < n * min_weight:
        min_weight = max(round(total_score / n, 2), WEIGHT_FLOOR)
    weights = [min_weight] * n
    remaining = max(round(total_score - n * min_weight, 2), 0.0)
    random_parts = [random.random() for _ in range(n)]
    total_parts = sum(random_parts) if sum(random_parts) > 0 else 1
    for i in range(n):
        extra = (random_parts[i] / total_parts) * remaining
        weights[i] = round(weights[i] + extra, 2)
    # Absorb the rounding residual into the LARGEST weight (not the last case) so a
    # negative residual can never drive a small case to <= 0.
    diff = round(total_score - sum(weights), 2)
    if diff:
        j = max(range(n), key=lambda k: weights[k])
        weights[j] = round(weights[j] + diff, 2)
    _ensure_positive_weights(weights)
    for i, tc in enumerate(test_cases):
        tc["weightage"] = weights[i]
    return test_cases


def build_exam_json(lua, container, difficulty, enabled_langs=None):
    enabled_langs = order_langs_canonically(parse_enabled_langs(enabled_langs))
    non_fn = is_non_function()
    fn_based = not non_fn
    owner_total_score = get_owner_total_score()
    # Use the SAME subtask/stress scoring as practice: preserve the generated per-case
    # weights, scaled to total_score. Total-score resolution also mirrors practice:
    # owner score if set, else the sum of the generated weights, else (no usable
    # weights) the difficulty default with a flat fallback distribution.
    test_cases = exam_parse_test_cases(container)
    if owner_total_score is not None:
        total_score = owner_total_score
    else:
        total_score = _generated_weight_total(test_cases) or {
            "EASY": 20, "MEDIUM": 25, "HARD": 30
        }[difficulty]
    if not _scale_weights_to_total(test_cases, total_score):
        test_cases = exam_assign_weights(test_cases, difficulty, owner_total_score)
    question_id = get_question_id()
    coding_details_id = str(uuid.uuid4())

    def sec(start, end):
        return parse_section(lua, start, end)

    # Default tags: prefer owner/env value, fall back to the LUA DEFAULT_TAGS
    # section so exam matches practice behaviour (req 16).
    default_tags = get_default_tag_names_from_env() or parse_tags(
        sec("----------DEFAULT_TAGS_START----------", "----------DEFAULT_TAGS_END----------")
    )

    default_lang_id = pick_default_lang_id(enabled_langs)

    coding_question_details = []
    language_code_repository_details = []
    test_case_evaluation_metrics = []

    for lang_id in enabled_langs:
        cfg = LANG_PLATFORM.get(lang_id)
        if not cfg:
            continue
        plat = cfg["exam"]
        c_start, c_end = cfg["content_markers"]
        content = sec(c_start, c_end)
        if non_fn and not content.strip():
            content = NON_FUNCTION_DEFAULT_CODES.get(plat, content)
        coding_question_details.append(
            {
                "code_content": content,
                "default_code": lang_id == default_lang_id,
                "language": plat,
                "code_id": coding_details_id,
                # Exam mode never ships debug helper code (req 7).
                "debug_helper_code": None,
                "is_function_based": fn_based,
            }
        )
        b_start, b_end = cfg["base64_markers"]
        repo_content = sec(b_start, b_end)
        if not non_fn and repo_content.strip():
            language_code_repository_details.append(
                {
                    "language": plat,
                    "file_path_to_execute": cfg["exec_file"],
                    "default_file_path_to_submit_code": cfg["submit_file"],
                    "code_repository": [
                        {
                            "file_name": cfg["exec_file"],
                            "file_type": "FILE",
                            "file_content": encode_code_to_base64(repo_content),
                        }
                    ],
                }
            )
        test_case_evaluation_metrics.append(
            {"language": plat, "time_limit_to_execute_in_seconds": cfg["metrics_sec"]}
        )

    if non_fn:
        language_code_repository_details = []

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
                "default_tag_names": default_tags,
                "concept_tag_names": [],
                "topic_tag_names": {},
                "metadata": None,
            },
            "coding_question_details": coding_question_details,
            "language_code_repository_details": language_code_repository_details,
            "solutions": [],
            "hints": [],
            "code_repository_details": None,
            "test_case_evaluation_metrics": test_case_evaluation_metrics,
        }
    ]
    return json_data


# ---------------------------------------------------------------------------
# Practice format (ported from index.html handleGenerate `create` branch)
# ---------------------------------------------------------------------------

def parse_tags(s):
    if not s:
        return []
    items = []
    for line in s.split("\n"):
        for part in line.split(","):
            part = part.strip()
            if part:
                items.append(part)
    return items


def parse_companies(s):
    """Companies are one-per-line (a single name may contain a comma, e.g.
    "Alphabet, Inc."), so split ONLY on newlines — unlike parse_tags (UI-H2)."""
    if not s:
        return []
    return [line.strip() for line in s.split("\n") if line.strip()]


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
    subtask_names = container.get("subtask_names") or {}
    test_cases = []
    for i, tc in enumerate(container["test_cases"]):
        if tc.get("input") is None:
            raise ValueError(f"Test case at index {i} is missing 'input'.")
        if tc.get("weightage") is None:
            raise ValueError(f"Test case at index {i} is missing 'weightage'.")
        if float(tc["weightage"]) <= 0:
            raise ValueError(
                f"Test case at index {i} has non-positive weightage "
                f"{tc['weightage']}; every test case must have weightage > 0."
            )
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
            "tags": normalize_tags(tc, subtask_names),
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

    # All default_code flags start false; the caller marks exactly one default
    # after filtering to the enabled languages (req 10/17).
    code_details = []
    if cpp:
        code_details.append(
            {"code_id": solutions_code_id, "code_content": cpp, "language": "CPP", "default_code": False}
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


def build_practice_json(lua, container, difficulty, node_based, enabled_langs=None):
    enabled_langs = order_langs_canonically(parse_enabled_langs(enabled_langs))
    non_fn = is_non_function()
    fn_based = not non_fn
    parsed_test_cases = practice_parse_test_cases(container)
    owner_total_score = get_owner_total_score()
    total_score = (
        js_number(owner_total_score)
        if owner_total_score is not None
        else practice_calculate_total_score(parsed_test_cases)
    )
    # Scale the per-case weights onto total_score, exactly as the exam path does.
    # Without this an owner score is applied to the header only: once selection has
    # trimmed the pool the generated weights sum to less than the declared total, so
    # a fully correct submission can never reach it. A no-op when no owner score is
    # set, because total_score is then the sum of these same weights.
    _scale_weights_to_total(parsed_test_cases, total_score)

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
    question_id = get_question_id()
    env_default_tags = get_default_tag_names_from_env()
    lua_default_tags = parse_tags(
        sec("----------DEFAULT_TAGS_START----------", "----------DEFAULT_TAGS_END----------")
    )
    default_tag_names = env_default_tags if env_default_tags else lua_default_tags

    default_lang_id = pick_default_lang_id(enabled_langs)
    default_plat = (
        LANG_PLATFORM[default_lang_id]["practice"]
        if default_lang_id in LANG_PLATFORM
        else None
    )

    def build_coding_details(lang, content_start, content_end):
        content = sec(content_start, content_end)
        if non_fn and not content.strip():
            content = NON_FUNCTION_DEFAULT_CODES.get(lang, content)
        return {
            "code_content": content,
            "default_code": lang == default_plat,
            "language": lang,
            "code_id": code_content_id,
            "is_function_based": fn_based,
            # Function-based practice ships debug helper code from the LUA
            # DEBUG_HELPER_CODE_<LANG> section; non-function is always null (req 7).
            "debug_helper_code": None if non_fn else practice_parse_debug_helper_code(lua, lang),
        }

    def build_repo(lang, exec_file, def_file, key_start, key_end):
        repo_body = sec(key_start, key_end)
        if not repo_body.strip():
            return None
        return {
            "language": lang,
            "file_path_to_execute": exec_file,
            "default_file_path_to_submit_code": def_file,
            "code_repository": [
                {
                    "file_name": exec_file,
                    "file_type": "FILE",
                    "file_content": encode_code_to_base64(repo_body),
                }
            ],
        }

    coding_question_details = []
    language_code_repository_details = []
    test_case_evaluation_metrics = []

    for lang_id in enabled_langs:
        cfg = LANG_PLATFORM.get(lang_id)
        if not cfg:
            continue
        plat = cfg["practice"]
        c_start, c_end = cfg["content_markers"]
        coding_question_details.append(build_coding_details(plat, c_start, c_end))
        b_start, b_end = cfg["base64_markers"]
        repo = build_repo(plat, cfg["exec_file"], cfg["submit_file"], b_start, b_end)
        if repo:
            language_code_repository_details.append(repo)
        test_case_evaluation_metrics.append(
            {"language": plat, "time_limit_to_execute_in_seconds": cfg["metrics_sec"]}
        )

    # Both kinds ship solutions: function-based from the split solution files,
    # non-function from the generated full program. prepare_lua_and_testcases
    # writes either into SOLUTIONS_<LANG>, so read it the same way for both.
    solutions = practice_parse_solutions(lua)
    if enabled_langs and solutions:
        allowed = {LANG_PLATFORM[l]["practice"] for l in enabled_langs if l in LANG_PLATFORM}
        sol_default_pref = {"CPP": 0, "PYTHON": 1, "JAVA": 2, "NODE_JS": 3}
        for sol_block in solutions:
            if sol_block.get("code_details"):
                kept = [
                    cd for cd in sol_block["code_details"] if cd.get("language") in allowed
                ]
                # Mark exactly one default among the surviving solutions so a
                # deselected C++ does not leave zero defaults.
                for cd in kept:
                    cd["default_code"] = False
                if kept:
                    primary = min(
                        kept, key=lambda cd: sol_default_pref.get(cd.get("language"), 99)
                    )
                    primary["default_code"] = True
                sol_block["code_details"] = kept

    final_json = [
        {
            "test_cases": parsed_test_cases,
            "total_score": total_score,
            "question_type": "CODING",
            "question_asked_by_companies_info": format_companies(
                parse_companies(sec("----------COMPANIES_START----------", "----------COMPANIES_END----------"))
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
                "default_tag_names": default_tag_names,
                "concept_tag_names": [],
                "concept_filter_tag_names": tags,
                "topic_tag_names": {
                    "beginner_tag_names": beginner_tags,
                    "intermediate_tag_names": intermediate_tags,
                    "advanced_tag_names": advanced_tags,
                },
                "metadata": metadata_string,
            },
            "coding_question_details": coding_question_details,
            "code_repository_details": None,
            "language_code_repository_details": language_code_repository_details,
            "solutions": solutions,
            "hints": practice_parse_hints(lua),
            "test_case_evaluation_metrics": test_case_evaluation_metrics,
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
        # node.h is a C++-only header. If C++ was deselected there is no CPP repo
        # to attach it to — skip injection rather than crashing (req 17).
        cpp_repo = next(
            (r for r in final_json[0]["language_code_repository_details"] if r["language"] == "CPP"),
            None,
        )
        if cpp_repo is None:
            print(
                "Warning: node-based question has NODE_H_CONTENT but C++ is not an "
                "enabled language; skipping node.h injection.",
                file=sys.stderr,
            )
        else:
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
    parser.add_argument(
        "--langs",
        default="python,cpp,java,nodejs",
        help="Comma-separated enabled languages: python,cpp,java,nodejs",
    )
    args = parser.parse_args()
    mode = args.mode
    enabled_langs = parse_enabled_langs(args.langs)

    problem_name = get_problem_name()
    question_type = get_question_type()
    node_based = is_node_based(question_type)

    print(f"Mode: {mode}")
    print(f"Problem Name: {problem_name}")
    print(f"Question Type: {question_type} (node-based: {node_based})")

    lua_path = locate_lua(mode, problem_name)
    print(f"Using LUA file: {lua_path}")
    print(f"Using testcases file: {TESTCASES_SOURCE}")

    with open(lua_path, "r", encoding="utf-8") as f:
        lua = f.read()
    container = load_source_testcases()
    difficulty = parse_difficulty(lua)
    print(f"Difficulty: {difficulty}")
    print(f"Test cases: {len(container['test_cases'])}")

    if mode == "exam":
        json_data = build_exam_json(lua, container, difficulty, enabled_langs)
        out = json.dumps(json_data, indent=4, ensure_ascii=False)
    else:
        json_data = build_practice_json(lua, container, difficulty, node_based, enabled_langs)
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
