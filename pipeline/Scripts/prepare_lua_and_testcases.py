import os
import json
import re

_BASE = os.environ.get("PIPELINE_BASE_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUTS_DIR = os.path.join(_BASE, "Outputs")
INPUTS_DIR = os.path.join(_BASE, "Inputs")
TEMPLATE_DIR = os.path.join(_BASE, "zReferenceFiles", "JSONPreparationFilesReference")

LANG_FOLDER_MAP = {
    "cpp": ("Cpp", "CPP"),
    "python": ("Python", "PYTHON"),
    "java": ("Java", "JAVA"),
    "nodejs": ("NodeJS", "NODE_JS"),
}

GENERATED_FULL_CODE_FILES = {
    "cpp": "CPP.cpp",
    "python": "PYTHON.py",
    "java": "JAVA.java",
    "nodejs": "NodeJS.js",
}

NON_FUNCTION_DEFAULT_CODES = {
    "CPP": '#include<bits/stdc++.h>\nusing namespace std;\n \nint main() {\n    // write your code here...\n    return 0;\n}',
    "PYTHON": "# write your code here...",
    "JAVA": 'class Main {\n    public static void main(String[] args) {\n        // write your code here...\n        System.out.println("");\n    }\n}',
    "NODE_JS": 'const fs = require(\'fs\');\n\nfunction main() {\n    // Write your code here...\n    console.log("Hello, World!");\n}\n\nmain();',
}


def parse_enabled_langs(cli_langs=None):
    raw = cli_langs or os.environ.get("PIPELINE_ENABLED_LANGS", "python,cpp,java,nodejs")
    langs = [l.strip().lower() for l in str(raw).split(",") if l.strip()]
    return langs or ["python", "cpp", "java", "nodejs"]


def is_non_function():
    qt = os.environ.get("PIPELINE_QUESTION_TYPE", "function").strip().lower()
    return qt in ("nonfunction", "non-function", "non_function")


def get_question_kind_from_md():
    problem_md_path = os.path.join(INPUTS_DIR, "problem.md")
    if not os.path.exists(problem_md_path):
        return "function"
    with open(problem_md_path, "r") as f:
        for line in f:
            if line.startswith("# Question Type:"):
                val = line.replace("# Question Type:", "").strip().lower()
                return "nonfunction" if "non" in val else "function"
    return "function"


def get_problem_name():
    # The owner-set title is FINAL (req 14): use it verbatim as short_text,
    # regardless of whether generated_titles.txt was written (e.g. Titles step
    # skipped, or Save not clicked). Without this the LUA short_text fell back to
    # the "Problem Name" default even when the owner title was set.
    owner = os.environ.get("PIPELINE_OWNER_TITLE", "").strip()
    if owner:
        problem_name = "".join(word.capitalize() for word in owner.split())
        return problem_name, owner

    titles_path = os.path.join(OUTPUTS_DIR, "generated_titles.txt")
    if not os.path.exists(titles_path):
        print(f"Warning: {titles_path} not found and PIPELINE_OWNER_TITLE unset.")
        return "ProblemName", "Problem Name"

    with open(titles_path, "r") as f:
        title_line = f.readline().strip()
        # Clean title_line e.g., "- Pair Sum Indices - 95%"
        if title_line.startswith("- "):
            title_line = title_line[2:]
        # Drop only a trailing "- 95%" annotation. Splitting on the first "-"
        # truncated hyphenated titles ("Two-Sum" -> "Two"). The same expression
        # is used in prepare_platform_json, editorial_manager and
        # execution_manager_v3 — all four must agree on the LUA short_text.
        title_line = re.sub(r"\s*-\s*\d+(?:\.\d+)?%\s*$", "", title_line).strip()

        problem_name = "".join(word.capitalize() for word in title_line.split())
        return problem_name, title_line

def get_question_type():
    problem_md_path = os.path.join(INPUTS_DIR, "problem.md")
    if not os.path.exists(problem_md_path):
        return "standard"
    with open(problem_md_path, "r") as f:
        for line in f:
            if line.startswith("# Type:"):
                return line.replace("# Type:", "").strip().lower().replace("_", " ")
    return "standard"


def read_file(filepath):
    if not os.path.exists(filepath):
        print(f"Warning: File {filepath} not found.")
        return ""
    with open(filepath, "r") as f:
        return f.read().strip()

def replace_tag_content(template, start_tag, end_tag, content):
    start_idx = template.find(start_tag)
    if start_idx == -1:
        return template
    end_idx = template.find(end_tag, start_idx)
    if end_idx == -1:
        return template
    
    return template[:start_idx + len(start_tag)] + "\n" + content + "\n" + template[end_idx:]

import argparse

def main():
    parser = argparse.ArgumentParser(description="Prepare LUA and Testcases for Coding Questions")
    parser.add_argument("--mode", choices=["practice", "exam"], default="practice", help="Type of question JSON to generate (default: practice)")
    parser.add_argument(
        "--langs",
        default="python,cpp,java,nodejs",
        help="Comma-separated enabled languages: python,cpp,java,nodejs",
    )
    args = parser.parse_args()

    mode = args.mode
    enabled_langs = parse_enabled_langs(args.langs)
    non_fn = is_non_function() or get_question_kind_from_md() == "nonfunction"
    problem_name, short_text = get_problem_name()
    question_type = get_question_type()
    print(f"Mode: {mode}")
    print(f"Problem Name: {problem_name}")
    print(f"Short Text: {short_text}")
    print(f"Question Type: {question_type}")
    print(f"Enabled languages: {enabled_langs}")
    print(f"Non-function: {non_fn}")

    if mode == "exam":
        if question_type in ["binary tree", "linked list"]:
            template_path = os.path.join(TEMPLATE_DIR, "NodeBasedExamLUATemplate.lua")
        else:
            template_path = os.path.join(TEMPLATE_DIR, "NonNodeBasedExamLUATemplate.lua")
    else:
        if question_type in ["binary tree", "linked list"]:
            template_path = os.path.join(TEMPLATE_DIR, "NodeBasedLUATemplate.lua")
        else:
            template_path = os.path.join(TEMPLATE_DIR, "NonNodeBasedLUATemplate.lua")

    template_content = read_file(template_path)
    if not template_content:
        print(f"Error: LUA Template is empty or missing at {template_path}")
        return

    # QUESTION_DESCRIPTION
    desc = read_file(os.path.join(OUTPUTS_DIR, "generated_description.md"))
    template_content = replace_tag_content(template_content, "----------QUESTION_DESCRIPTION_START----------", "----------QUESTION_DESCRIPTION_END----------", desc)

    # SHORT_TEXT
    template_content = replace_tag_content(template_content, "----------SHORT_TEXT_START----------", "----------SHORT_TEXT_END----------", short_text)

    # QUESTION_LEVEL — the owner-set difficulty is FINAL, so prefer it over the
    # auto-generated value even if this step runs without re-generating difficulty.
    owner_difficulty = os.environ.get("PIPELINE_OWNER_DIFFICULTY", "").strip().lower()
    if owner_difficulty in ("easy", "medium", "hard"):
        level = owner_difficulty.upper()
    else:
        level = read_file(os.path.join(OUTPUTS_DIR, "generated_difficulty.txt")).upper()
    template_content = replace_tag_content(template_content, "----------QUESTION_LEVEL_START----------", "----------QUESTION_LEVEL_END----------", level)

    if mode == "practice":
        # Topics
        topics_path = os.path.join(OUTPUTS_DIR, "generated_topics.json")
        if os.path.exists(topics_path):
            with open(topics_path, "r") as f:
                try:
                    topics_data = json.load(f)
                except json.JSONDecodeError:
                    topics_data = {}
            
            beg_topics = topics_data.get("beginner_topics", [])
            int_topics = topics_data.get("intermediate_topics", [])
            adv_topics = topics_data.get("advanced_topics", [])
            
            template_content = replace_tag_content(template_content, "----------BEGINNER_TOPICS_START----------", "----------BEGINNER_TOPICS_END----------", ", ".join(beg_topics))
            template_content = replace_tag_content(template_content, "----------INTERMEDIATE_TOPICS_START----------", "----------INTERMEDIATE_TOPICS_END----------", ", ".join(int_topics))
            template_content = replace_tag_content(template_content, "----------ADVANCED_TOPICS_START----------", "----------ADVANCED_TOPICS_END----------", ", ".join(adv_topics))

        # Companies (practice only — one company per line in Outputs/Companies)
        companies_path = os.path.join(OUTPUTS_DIR, "Companies")
        if os.path.exists(companies_path):
            companies_content = read_file(companies_path)
            if companies_content:
                template_content = replace_tag_content(
                    template_content,
                    "----------COMPANIES_START----------",
                    "----------COMPANIES_END----------",
                    companies_content,
                )

        # Enrichment (Real life examples, Hints, Follow up questions)
        enrichment_path = os.path.join(OUTPUTS_DIR, "enrichment.json")
        if os.path.exists(enrichment_path):
            with open(enrichment_path, "r") as f:
                try:
                    enrichment = json.load(f)
                except json.JSONDecodeError:
                    enrichment = {}
                
            real_life = enrichment.get("real_life_examples", "")
            template_content = replace_tag_content(template_content, "----------REAL_LIFE_EXAMPLES_START----------", "----------REAL_LIFE_EXAMPLES_END----------", real_life)
            
            hints = enrichment.get("hints", {})
            hints_content = []
            for i in range(1, len(hints) + 1):
                hint_key = f"hint_{i}"
                if hint_key in hints:
                    hints_content.append(f"----------HINTS_START_{i}----------\n{hints[hint_key]}\n----------HINTS_END_{i}----------")
            
            hints_block = "\n\n".join(hints_content)
            template_content = replace_tag_content(template_content, "----------HINTS_START----------", "----------HINTS_END----------", hints_block)

            follow_ups = enrichment.get("followup_questions", [])
            follow_ups_content = []
            for i, fu in enumerate(follow_ups, 1):
                question = fu.get("question", "")
                answer = fu.get("answer", "")
                
                inner_payload = f"----------QUESTION_START----------\n{question}\n----------QUESTION_END----------\n\n----------ANSWER_START----------\n{answer}\n----------ANSWER_END----------"
                follow_ups_content.append(f"----------FOLLOW_UP_QUESTION_START_{i}----------\n{inner_payload}\n----------FOLLOW_UP_QUESTION_END_{i}----------")
                
            follow_ups_block = "\n\n".join(follow_ups_content)
            template_content = replace_tag_content(template_content, "----------FOLLOW_UP_QUESTIONS_START----------", "----------FOLLOW_UP_QUESTIONS_END----------", follow_ups_block)

        # Default tags from env (owner override) or leave template tags empty
        default_tags = os.environ.get("PIPELINE_DEFAULT_TAGS", "").strip()
        if default_tags:
            tag_lines = ", ".join(line.strip() for line in default_tags.split("\n") if line.strip())
            template_content = replace_tag_content(
                template_content,
                "----------DEFAULT_TAGS_START----------",
                "----------DEFAULT_TAGS_END----------",
                tag_lines,
            )

    # CodeContentFiles — filtered by enabled languages
    ext_map = {"Cpp": "cpp", "Python": "py", "Java": "java", "NodeJS": "js"}
    generated_full_code_dir = os.path.join(OUTPUTS_DIR, "generatedFullCode")

    for lang_id in enabled_langs:
        mapping = LANG_FOLDER_MAP.get(lang_id)
        if not mapping:
            continue
        d, tag = mapping
        base_dir = os.path.join(OUTPUTS_DIR, "CodeContentFiles", d)
        ext = ext_map[d]

        default_path = os.path.join(base_dir, f"default.{ext}")
        driver_path = os.path.join(base_dir, f"driver.{ext}")
        debugger_path = os.path.join(base_dir, f"debugger.{ext}")
        solution_path = os.path.join(base_dir, f"solution.{ext}")

        gen_file = GENERATED_FULL_CODE_FILES.get(lang_id)
        gen_path = os.path.join(generated_full_code_dir, gen_file) if gen_file else None

        # CODE_CONTENT — default template or non-fn fallback
        code_content = ""
        if os.path.exists(default_path):
            code_content = read_file(default_path)
        elif non_fn:
            code_content = NON_FUNCTION_DEFAULT_CODES.get(tag, "")
        elif gen_path and os.path.exists(gen_path):
            code_content = read_file(gen_path)
        if code_content:
            template_content = replace_tag_content(
                template_content,
                f"----------CODE_CONTENT_{tag}_START----------",
                f"----------CODE_CONTENT_{tag}_END----------",
                code_content,
            )

        if mode == "practice" and os.path.exists(debugger_path):
            debugger_content = read_file(debugger_path)
            template_content = replace_tag_content(
                template_content,
                f"----------DEBUG_HELPER_CODE_{tag}_START----------",
                f"----------DEBUG_HELPER_CODE_{tag}_END----------",
                debugger_content,
            )

        # Driver / base64 — skip for non-fn exam (empty repos in JSON)
        driver_content = ""
        if os.path.exists(driver_path):
            driver_content = read_file(driver_path)
        elif gen_path and os.path.exists(gen_path) and not (non_fn and mode == "exam"):
            driver_content = read_file(gen_path)
        if driver_content:
            template_content = replace_tag_content(
                template_content,
                f"----------CODE_BASE64_{tag}_START----------",
                f"----------CODE_BASE64_{tag}_END----------",
                driver_content,
            )

        if mode == "practice" and os.path.exists(solution_path):
            solution_content = read_file(solution_path)
            template_content = replace_tag_content(
                template_content,
                f"----------SOLUTIONS_{tag}_START----------",
                f"----------SOLUTIONS_{tag}_END----------",
                solution_content,
            )
        elif mode == "practice" and non_fn and gen_path and os.path.exists(gen_path):
            solution_content = read_file(gen_path)
            template_content = replace_tag_content(
                template_content,
                f"----------SOLUTIONS_{tag}_START----------",
                f"----------SOLUTIONS_{tag}_END----------",
                solution_content,
            )
            
    # Inject node.h if applicable
    if question_type in ["binary tree", "linked list"]:
        node_h_path = os.path.join(OUTPUTS_DIR, "CodeContentFiles", "Cpp", "node.h")
        if os.path.exists(node_h_path):
            node_h_content = read_file(node_h_path)
            template_content = replace_tag_content(template_content, "----------NODE_H_CONTENT_START----------", "----------NODE_H_CONTENT_END----------", node_h_content)
        else:
            print(f"Warning: question_type is {question_type} but node.h was not found.")

    # Ensure output dir
    output_target_dir = os.path.join(OUTPUTS_DIR, "forJSONPreparation")
    os.makedirs(output_target_dir, exist_ok=True)
    
    # Save LUA
    suffix = f"_{mode}" if mode == "exam" else ""
    lua_out_path = os.path.join(output_target_dir, f"{problem_name}{suffix}.lua")
    with open(lua_out_path, "w") as f:
        f.write(template_content)
    print(f"Written LUA file to {lua_out_path}")

    # Test cases are NOT copied here. The final JSON prep step
    # (prepare_platform_json.py) reads the canonical Outputs/testcases.json
    # directly and applies validation/corrections in-memory, so there is no
    # longer a per-mode testcases_*.json copy under forJSONPreparation/.

if __name__ == "__main__":
    main()
