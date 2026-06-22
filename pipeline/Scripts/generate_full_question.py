import os
import sys
import json
import glob
import re

# Prompts
from Prompts.descriptionPrompt import get_description_prompt
from Prompts.titlePrompt import get_title_prompt
from Prompts.difficultyPrompt import get_difficulty_prompt
from Prompts.conversionPrompt import get_conversion_prompt
from Prompts.normalizationPrompt import get_normalization_prompt
from Prompts.topicsPrompt import get_topics_prompt

from llm_client import call_llm
from usage_tracker import update_usage
from code_cleaner import clean_generated_code

# Directory constants
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(SCRIPT_DIR)
INPUT_DIR = os.path.join(BASE_DIR, 'Inputs')
OUTPUT_DIR = os.path.join(BASE_DIR, 'Outputs')

def _is_table_row(line):
    s = line.strip()
    return s.startswith('|') and s.count('|') >= 2


def _is_table_separator(line):
    s = line.strip()
    if not s.startswith('|'):
        return False
    cells = [c.strip() for c in s.strip('|').split('|')]
    cells = [c for c in cells if c != '']
    if not cells:
        return False
    return all(re.match(r'^:?-{1,}:?$', c) for c in cells)


def _table_to_bullets(table_lines):
    """Convert a markdown pipe-table block into a renderer-safe bullet/sub-bullet
    list, preserving every value exactly. Row 0 is the header, row 1 the separator,
    rows 2+ the data."""
    rows = []
    for ln in table_lines:
        s = ln.strip().strip('|')
        rows.append([c.strip() for c in s.split('|')])
    if len(rows) < 2:
        return table_lines

    header = rows[0]
    data_rows = rows[2:]
    out = []
    for r in data_rows:
        if all(c == '' for c in r):
            continue
        first_label = header[0] if header and header[0] else ''
        out.append(f"- {first_label}: {r[0]}" if first_label else f"- {r[0]}")
        for ci in range(1, len(r)):
            label = header[ci] if ci < len(header) and header[ci] else ''
            out.append(f"    - {label}: {r[ci]}" if label else f"    - {r[ci]}")
        out.append("")
    return out


def normalize_renderer_safe(text):
    """Deterministic renderer-safe normalization for the 'none' scenario description.

    The platform's custom markdown renderer cannot display ATX headings, horizontal
    rules, language-tagged code fences, or markdown tables. This pass guarantees
    renderer-safe output regardless of model drift, WITHOUT altering any values:
    - ATX headings (`#`..`######`) -> bold `**Title**` (skipped inside code fences)
    - horizontal rules (`---`, `***`, `___`) -> removed
    - code-fence openers -> bare ``` (language identifier stripped)
    - markdown pipe-tables -> bullet/sub-bullet lists preserving every value
    """
    lines = text.replace('\r\n', '\n').split('\n')
    out = []
    in_fence = False
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]

        fence_match = re.match(r'^(\s*)(`{3,}|~{3,})(.*)$', line)
        if fence_match:
            indent, ticks, _rest = fence_match.groups()
            out.append(f"{indent}{ticks}")
            in_fence = not in_fence
            i += 1
            continue

        if in_fence:
            out.append(line)
            i += 1
            continue

        # Horizontal rule -> drop
        if re.match(r'^\s*([-*_])(\s*\1){2,}\s*$', line):
            i += 1
            continue

        # ATX heading -> bold title
        h = re.match(r'^\s*#{1,6}\s+(.*?)\s*#*\s*$', line)
        if h:
            title = h.group(1).strip()
            if title.startswith('**') and title.endswith('**'):
                out.append(title)
            else:
                out.append(f"**{title}**")
            i += 1
            continue

        # Markdown table -> bullet list
        if _is_table_row(line) and i + 1 < n and _is_table_separator(lines[i + 1]):
            table_lines = []
            while i < n and _is_table_row(lines[i]):
                table_lines.append(lines[i])
                i += 1
            out.extend(_table_to_bullets(table_lines))
            continue

        out.append(line)
        i += 1

    return '\n'.join(out)


def parse_problem_md(file_path):
    """Parse problem.md to extract metadata"""
    if not os.path.exists(file_path):
        print(f"Error: {file_path} not found.")
        sys.exit(1)
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    lines = content.split('\n')
    problem_name = "Unknown Problem"
    # `# Type:` carries the data-structure shape (standard / linked list /
    # binary tree). Normalize underscores -> spaces and lowercase so both the
    # canonical header form and any historical underscore form match the
    # downstream comparisons.
    structure_type = "standard"
    # `# Question Type:` carries function vs nonfunction. Default to function.
    question_kind = "function"
    scenario_level = "moderate"  # default for backward compatibility

    for line in lines:
        if line.startswith('# Problem:'):
            problem_name = line.replace('# Problem:', '').strip()
        elif line.startswith('# Question Type:'):
            value = line.replace('# Question Type:', '').strip().lower()
            question_kind = "nonfunction" if "non" in value else "function"
        elif line.startswith('# Type:'):
            structure_type = line.replace('# Type:', '').strip().lower().replace('_', ' ')
        elif line.startswith('# Scenario Level:'):
            value = line.replace('# Scenario Level:', '').strip().lower()
            if value in ['none', 'light', 'moderate', 'heavy']:
                scenario_level = value
        elif line.startswith('# Use Scenario:'):
            # Backward compatibility: map old yes/no to levels
            value = line.replace('# Use Scenario:', '').strip().lower()
            if value not in ['yes', 'true']:
                scenario_level = "none"

    return problem_name, structure_type, question_kind, scenario_level, content

def _parse_signature(raw):
    """Robustly parse the function-signature JSON the extractor returns.

    The model may wrap the JSON in a code fence or add stray prose, so we strip
    fences and grab the first {...} block before parsing. Returns a normalized
    dict (with a non-empty function_name and a clean parameter list) or None.
    """
    if not raw:
        return None
    text = raw.strip()
    if text.startswith("```"):
        # Drop the opening fence line and any trailing fence.
        text = text.split('\n', 1)[-1].rsplit('```', 1)[0]
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        data = json.loads(text)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    name = str(data.get("function_name") or "").strip()
    if not name:
        return None
    params = data.get("parameters") or []
    if not isinstance(params, list):
        params = []
    data["function_name"] = name
    data["parameters"] = [str(p).strip() for p in params if str(p).strip()]
    return data


LANG_MAP = {
    'python': 'python_code',
    'c++': 'cpp_code',
    'java': 'java_code',
    'node.js': 'nodejs_code',
}

LANG_ID_TO_KEY = {
    'python': 'python_code',
    'cpp': 'cpp_code',
    'java': 'java_code',
    'nodejs': 'nodejs_code',
}

TARGET_LANGS = {
    "cpp_code": "C++",
    "java_code": "Java",
    "nodejs_code": "Node.js",
    "python_code": "Python",
}

FILE_MAPPINGS = {
    'python_code': 'PYTHON.py',
    'cpp_code': 'CPP.cpp',
    'java_code': 'JAVA.java',
    'nodejs_code': 'NodeJS.js',
}

NORMALIZED_EXT = {
    'python': '.py',
    'c++': '.cpp',
    'java': '.java',
    'node.js': '.js',
}


def _current_step_id():
    return os.environ.get("PIPELINE_STEP_ID") or "generate_question"


def _track_llm_usage(usage, label, purpose="chat"):
    update_usage(
        usage.get('prompt_tokens', 0),
        usage.get('completion_tokens', 0),
        label,
        model=usage.get('model', 'unknown'),
        purpose=purpose,
        step_id=_current_step_id(),
        cost=usage.get('cost', 0.0),
    )


def _strip_scratchpad(text):
    return re.sub(r'<scratchpad>.*?</scratchpad>', '', text, flags=re.DOTALL).strip()


def _generated_full_code_dir():
    path = os.path.join(OUTPUT_DIR, 'generatedFullCode')
    os.makedirs(path, exist_ok=True)
    return path


def _signature_path():
    return os.path.join(OUTPUT_DIR, 'description_signature.json')


def _normalized_source_path(detected_lang):
    ext = NORMALIZED_EXT.get(detected_lang.lower(), '.txt')
    return os.path.join(OUTPUT_DIR, f'normalized_source{ext}')


def _description_path():
    return os.path.join(OUTPUT_DIR, 'generated_description.md')


def _load_description():
    path = _description_path()
    if not os.path.exists(path):
        return ""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def _save_description(text):
    with open(_description_path(), 'w', encoding='utf-8') as f:
        f.write(text)


def _save_signature(signature):
    if signature:
        with open(_signature_path(), 'w', encoding='utf-8') as f:
            json.dump(signature, f, indent=2)


def _load_signature():
    path = _signature_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _save_normalized_source(code, detected_lang):
    path = _normalized_source_path(detected_lang)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(code)


def _load_normalized_source(detected_lang, fallback):
    path = _normalized_source_path(detected_lang)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    return fallback


def _save_solution_file(lang_key, code):
    filename = FILE_MAPPINGS.get(lang_key)
    if not filename:
        return
    out_path = os.path.join(_generated_full_code_dir(), filename)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(code)


def detect_user_solution():
    """Find user's solution file in Inputs/ directory"""
    extensions = {
        '*.py': 'python',
        '*.cpp': 'c++',
        '*.java': 'java',
        '*.js': 'node.js'
    }
    
    for pattern, lang in extensions.items():
        matches = glob.glob(os.path.join(INPUT_DIR, pattern))
        if matches:
            return matches[0], lang
    
    print("Error: No solution file found in Inputs/")
    print("Please provide one of: solution.py, solution.cpp, Solution.java, solution.js")
    sys.exit(1)

def run_description_step(problem_name, structure_type, scenario_level, problem_content, user_code, detected_lang):
    print("\n" + "=" * 60)
    print("STEP: Description Creation")
    print("=" * 60)

    desc_prompt = get_description_prompt(problem_name, structure_type, user_code, scenario_level)
    desc_response, desc_usage = call_llm(desc_prompt, problem_content, purpose="chat")
    desc_response = _strip_scratchpad(desc_response)
    if scenario_level == "none":
        desc_response = normalize_renderer_safe(desc_response)

    _track_llm_usage(desc_usage, f"{problem_name}_description")
    _save_description(desc_response)
    _save_solution_file('python_code', user_code)
    print(f"✓ Description created and saved to {_description_path()}")
    print(f"✓ Baseline solution saved to generatedFullCode/PYTHON.py")


def run_naming_step(problem_name, structure_type, question_kind, user_code, detected_lang):
    print("\n" + "=" * 60)
    print("STEP: Naming Enforcement")
    print("=" * 60)

    if question_kind == "nonfunction":
        print("ℹ Non-function problem — skipping function-signature naming enforcement.")
        return

    from Prompts.signatureExtractionPrompt import get_signature_extraction_prompt

    desc_response = _load_description()
    if not desc_response.strip():
        print("⚠ No description available — cannot extract a canonical signature.")
        return

    sig_prompt = get_signature_extraction_prompt(desc_response)
    sig_response, sig_usage = call_llm(sig_prompt, "", purpose="chat")
    _track_llm_usage(sig_usage, f"{problem_name}_signature")
    description_signature = _parse_signature(sig_response)

    if not description_signature:
        print("⚠ Could not extract a function signature from the description; skipping rename.")
        return

    print(f"Enforcing function name: {description_signature.get('function_name')}")
    refactor_prompt = get_normalization_prompt(
        user_code, detected_lang, description_signature, desc_response, structure_type
    )
    renamed_code, refactor_usage = call_llm(refactor_prompt, "", purpose="chat")
    _track_llm_usage(refactor_usage, f"{problem_name}_refactor")

    if renamed_code.strip().startswith("```"):
        renamed_code = renamed_code.strip().split('\n', 1)[1].rsplit('\n', 1)[0].strip()
    renamed_code = clean_generated_code(renamed_code, detected_lang)

    _save_signature(description_signature)
    _save_normalized_source(renamed_code, detected_lang)
    _save_solution_file('python_code', renamed_code)
    print("✓ Given code updated with description naming and normalization")


def run_titles_step(problem_name):
    print("\n" + "=" * 60)
    print("STEP: Generating Titles")
    print("=" * 60)

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_description first.")
        sys.exit(1)

    title_prompt = get_title_prompt(desc_response)
    title_response, title_usage = call_llm(title_prompt, "", purpose="chat")
    _track_llm_usage(title_usage, f"{problem_name}_titles")

    titles_path = os.path.join(OUTPUT_DIR, 'generated_titles.txt')
    with open(titles_path, 'w', encoding='utf-8') as f:
        f.write(title_response)
    print("✓ Titles generated")


def run_difficulty_step(problem_name):
    print("\n" + "=" * 60)
    print("STEP: Generating Difficulty")
    print("=" * 60)

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_description first.")
        sys.exit(1)

    diff_path = os.path.join(OUTPUT_DIR, 'generated_difficulty.txt')
    owner_difficulty = os.environ.get("PIPELINE_OWNER_DIFFICULTY", "").strip().lower()
    if owner_difficulty in ("easy", "medium", "hard"):
        with open(diff_path, 'w', encoding='utf-8') as f:
            f.write(owner_difficulty)
        print(f"✓ Using owner-set difficulty (final): {owner_difficulty}")
        return

    diff_prompt = get_difficulty_prompt(desc_response)
    diff_response, diff_usage = call_llm(diff_prompt, "", purpose="chat")
    _track_llm_usage(diff_usage, f"{problem_name}_difficulty")
    with open(diff_path, 'w', encoding='utf-8') as f:
        f.write(diff_response.strip())
    print("✓ Difficulty generated")


def run_topics_step(problem_name, user_code, detected_lang):
    print("\n" + "=" * 60)
    print("STEP: Generating Topics")
    print("=" * 60)

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_description first.")
        sys.exit(1)

    topics_list_path = os.path.join(INPUT_DIR, 'topics_list.txt')
    if not os.path.exists(topics_list_path):
        print(f"Warning: {topics_list_path} not found. Skipping topic generation.")
        return

    with open(topics_list_path, 'r', encoding='utf-8') as f:
        topics_list_content = f.read()

    working_code = _load_normalized_source(detected_lang, user_code)
    topics_prompt = get_topics_prompt(desc_response, working_code, topics_list_content)
    topics_response, topics_usage = call_llm(topics_prompt, "", purpose="chat")
    _track_llm_usage(topics_usage, f"{problem_name}_topics")

    topics_out_path = os.path.join(OUTPUT_DIR, 'generated_topics.json')
    try:
        clean_topics = topics_response.strip()
        if clean_topics.startswith("```"):
            clean_topics = clean_topics.split('\n', 1)[1].rsplit('\n', 1)[0].strip()
        topic_data = json.loads(clean_topics)
        with open(topics_out_path, 'w', encoding='utf-8') as f:
            json.dump(topic_data, f, indent=4)
        print(f"✓ Topics generated and saved to {topics_out_path}")
    except Exception as e:
        print(f"Warning: Failed to parse generated topics JSON. {e}")


def run_translate_step(problem_name, structure_type, user_code, detected_lang, selected_langs):
    print("\n" + "=" * 60)
    print("STEP: Converting to Other Languages")
    print("=" * 60)

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_description first.")
        sys.exit(1)

    working_code = _load_normalized_source(detected_lang, user_code)
    description_signature = _load_signature()
    user_lang_key = LANG_MAP.get(detected_lang.lower(), 'python_code')
    selected_keys = {LANG_ID_TO_KEY.get(l, '') for l in selected_langs}

    _save_solution_file(user_lang_key, working_code)

    for key, lang in TARGET_LANGS.items():
        if key == user_lang_key:
            continue
        if key not in selected_keys:
            print(f"  ⏭ Skipping {lang} (not selected)")
            continue
        print(f"  - Converting to {lang}...")
        conv_prompt = get_conversion_prompt(
            lang, working_code, structure_type, description_signature, desc_response
        )
        conv_response, conv_usage = call_llm(conv_prompt, "", purpose="code")
        _track_llm_usage(conv_usage, f"{problem_name}_convert_{lang}", purpose="code")

        clean_code = conv_response.strip()
        if clean_code.startswith("```"):
            clean_code = clean_code.split('\n', 1)[1].rsplit('\n', 1)[0].strip()
        clean_code = clean_generated_code(clean_code, lang)
        _save_solution_file(key, clean_code)

    print(f"✓ Solutions saved to {_generated_full_code_dir()}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate question content (one operation per invocation)")
    parser.add_argument(
        "--steps",
        required=True,
        help="Operation to run: description, naming, titles, difficulty, topics, codes",
    )
    parser.add_argument(
        "--langs",
        default="python,cpp,java,nodejs",
        help="Comma-separated languages for code translation: python,cpp,java,nodejs",
    )
    args = parser.parse_args()
    selected_steps = {s.strip() for s in args.steps.split(",") if s.strip()}
    selected_langs = [l.strip().lower() for l in args.langs.split(",")]

    print("=" * 60)
    print("CODE-CENTRIC QUESTION GENERATOR")
    print("=" * 60)
    print(f"Selected steps: {sorted(selected_steps)}")
    if "codes" in selected_steps:
        print(f"Selected languages: {selected_langs}")

    problem_path = os.path.join(INPUT_DIR, 'problem.md')
    problem_name, structure_type, question_kind, scenario_level, problem_content = parse_problem_md(problem_path)

    solution_path, detected_lang = detect_user_solution()
    print(f"\n📋 Problem: {problem_name} ({structure_type}, {question_kind})")
    print(f"🎭 Scenario Level: {scenario_level}")
    print(f"💻 User Code: {os.path.basename(solution_path)} ({detected_lang})")

    with open(solution_path, 'r', encoding='utf-8') as f:
        user_code = f.read()

    if "description" in selected_steps:
        run_description_step(
            problem_name, structure_type, scenario_level, problem_content, user_code, detected_lang
        )

    if "naming" in selected_steps:
        run_naming_step(problem_name, structure_type, question_kind, user_code, detected_lang)

    if "titles" in selected_steps:
        run_titles_step(problem_name)

    if "difficulty" in selected_steps:
        run_difficulty_step(problem_name)

    if "topics" in selected_steps:
        run_topics_step(problem_name, user_code, detected_lang)

    if "codes" in selected_steps:
        run_translate_step(problem_name, structure_type, user_code, detected_lang, selected_langs)

    print("\n" + "=" * 60)
    print("✅ SUCCESS! Step completed.")
    print("=" * 60)


if __name__ == "__main__":
    main()
