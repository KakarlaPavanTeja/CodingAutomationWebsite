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
    question_type = "standard"
    scenario_level = "moderate"  # default for backward compatibility

    for line in lines:
        if line.startswith('# Problem:'):
            problem_name = line.replace('# Problem:', '').strip()
        elif line.startswith('# Type:'):
            question_type = line.replace('# Type:', '').strip()
        elif line.startswith('# Scenario Level:'):
            value = line.replace('# Scenario Level:', '').strip().lower()
            if value in ['none', 'light', 'moderate', 'heavy']:
                scenario_level = value
        elif line.startswith('# Use Scenario:'):
            # Backward compatibility: map old yes/no to levels
            value = line.replace('# Use Scenario:', '').strip().lower()
            if value not in ['yes', 'true']:
                scenario_level = "none"

    return problem_name, question_type, scenario_level, content

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

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate full question with selective steps")
    parser.add_argument("--steps", default="description,naming,codes,titles,difficulty,topics",
                        help="Comma-separated steps to run: description,naming,codes,titles,difficulty,topics")
    parser.add_argument("--langs", default="python,cpp,java,nodejs",
                        help="Comma-separated languages for code translation: python,cpp,java,nodejs")
    args = parser.parse_args()
    selected_steps = [s.strip() for s in args.steps.split(",")]
    selected_langs = [l.strip().lower() for l in args.langs.split(",")]

    print("=" * 60)
    print("CODE-CENTRIC QUESTION GENERATOR (LEAN WORKFLOW)")
    print("=" * 60)
    print(f"Selected steps: {selected_steps}")
    print(f"Selected languages: {selected_langs}")

    # Step 0: Load inputs
    problem_path = os.path.join(INPUT_DIR, 'problem.md')
    problem_name, question_type, scenario_level, problem_content = parse_problem_md(problem_path)
    
    solution_path, detected_lang = detect_user_solution()
    print(f"\n📋 Problem: {problem_name} ({question_type})")
    print(f"🎭 Scenario Level: {scenario_level}")
    print(f"💻 User Code: {os.path.basename(solution_path)} ({detected_lang})")
    
    with open(solution_path, 'r') as f:
        user_code = f.read()

    # Step 1: Description Creation
    desc_path = os.path.join(OUTPUT_DIR, 'generated_description.md')
    if "description" in selected_steps:
        print("\n" + "=" * 60)
        print("STEP 1: Description Creation")
        print("=" * 60)

        desc_prompt = get_description_prompt(problem_name, question_type, user_code, scenario_level)
        desc_response, desc_usage = call_llm(desc_prompt, problem_content, purpose="chat")

        desc_response = re.sub(r'<scratchpad>.*?</scratchpad>', '', desc_response, flags=re.DOTALL).strip()

        # For the "none" scenario, the platform's custom renderer cannot display
        # ATX headings, horizontal rules, language-tagged code fences, or tables.
        # Guarantee renderer-safe output deterministically regardless of model drift.
        if scenario_level == "none":
            desc_response = normalize_renderer_safe(desc_response)

        update_usage(
            desc_usage.get('prompt_tokens', 0),
            desc_usage.get('completion_tokens', 0),
            f"{problem_name}_description",
            model=desc_usage.get('model', 'unknown'),
            purpose="chat",
            step_id="generate_question",
            cost=desc_usage.get('cost', 0.0),
        )

        with open(desc_path, 'w') as f:
            f.write(desc_response)
        print(f"✓ Description created and saved to {desc_path}")
    else:
        print("\n⏭ Skipping Step 1: Description Creation")
        if os.path.exists(desc_path):
            with open(desc_path, 'r') as f:
                desc_response = f.read()
        else:
            desc_response = ""

    # Step 2: Naming Enforcement (Renaming)
    #
    # This step extracts ONE canonical function signature from the description and
    # normalizes the source code to it. That signature is then handed to every
    # language conversion in Step 3, which is the ONLY thing that keeps function
    # and parameter names identical across C++/Python/Java/Node.js. It therefore
    # MUST run whenever code translation runs — otherwise each language is named
    # independently by its own LLM call (and drifts, e.g. Python snake_case).
    description_signature = None
    run_naming = "naming" in selected_steps or "codes" in selected_steps
    if run_naming:
        print("\n" + "=" * 60)
        print("STEP 2: Naming Enforcement")
        print("=" * 60)

        from Prompts.signatureExtractionPrompt import get_signature_extraction_prompt

        if not desc_response.strip():
            print("⚠ No description available — cannot extract a canonical signature. "
                  "Function names may differ across languages.")
        else:
            sig_prompt = get_signature_extraction_prompt(desc_response)
            sig_response, sig_usage = call_llm(sig_prompt, "", purpose="chat")
            update_usage(sig_usage.get('prompt_tokens', 0), sig_usage.get('completion_tokens', 0), f"{problem_name}_signature", model=sig_usage.get('model', 'unknown'), purpose="chat", step_id="generate_question", cost=sig_usage.get('cost', 0.0))

            description_signature = _parse_signature(sig_response)

        if description_signature:
            print(f"Enforcing function name: {description_signature.get('function_name')}")
            refactor_prompt = get_normalization_prompt(user_code, detected_lang, description_signature, desc_response, question_type)
            renamed_code, refactor_usage = call_llm(refactor_prompt, "", purpose="chat")
            update_usage(refactor_usage.get('prompt_tokens', 0), refactor_usage.get('completion_tokens', 0), f"{problem_name}_refactor", model=refactor_usage.get('model', 'unknown'), purpose="chat", step_id="generate_question", cost=refactor_usage.get('cost', 0.0))

            if renamed_code.strip().startswith("```"):
                renamed_code = renamed_code.strip().split('\n', 1)[1].rsplit('\n', 1)[0].strip()
            user_code = clean_generated_code(renamed_code, detected_lang)
            print("✓ Given code updated with description naming and normalization")
        else:
            print("⚠ Could not extract a function signature from the description; "
                  "skipping rename. Translated languages may use inconsistent names.")
    else:
        print("\n⏭ Skipping Step 2: Naming Enforcement")

    # Step 3: Convert to Other Languages
    lang_map = {
        'python': 'python_code',
        'c++': 'cpp_code',
        'java': 'java_code',
        'node.js': 'nodejs_code'
    }

    # Map selected_langs IDs to internal keys
    lang_id_to_key = {
        'python': 'python_code',
        'cpp': 'cpp_code',
        'java': 'java_code',
        'nodejs': 'nodejs_code'
    }

    solutions = {}
    user_lang_key = lang_map.get(detected_lang.lower(), 'python_code')
    solutions[user_lang_key] = user_code

    if "codes" in selected_steps:
        print("\n" + "=" * 60)
        print("STEP 3: Converting to Other Languages")
        print("=" * 60)

        target_langs = {
            "cpp_code": "C++",
            "java_code": "Java",
            "nodejs_code": "Node.js",
            "python_code": "Python"
        }

        # Filter to only selected languages
        selected_keys = set(lang_id_to_key.get(l, '') for l in selected_langs)

        for key, lang in target_langs.items():
            if key == user_lang_key: continue
            if key not in selected_keys:
                print(f"  ⏭ Skipping {lang} (not selected)")
                continue
            print(f"  - Converting to {lang}...")
            conv_prompt = get_conversion_prompt(lang, user_code, question_type, description_signature, desc_response)
            conv_response, conv_usage = call_llm(conv_prompt, "", purpose="code")
            update_usage(conv_usage.get('prompt_tokens', 0), conv_usage.get('completion_tokens', 0), f"{problem_name}_convert_{lang}", model=conv_usage.get('model', 'unknown'), purpose="code", step_id="generate_question", cost=conv_usage.get('cost', 0.0))

            clean_code = conv_response.strip()
            if clean_code.startswith("```"):
                clean_code = clean_code.split('\n', 1)[1].rsplit('\n', 1)[0].strip()

            clean_code = clean_generated_code(clean_code, lang)
            solutions[key] = clean_code
    else:
        print("\n⏭ Skipping Step 3: Code Translation")

    # Step 4: Finalizing Solutions
    print("\n" + "=" * 60)
    print("STEP 4: Finalizing Solutions")
    print("=" * 60)
    
    generated_full_code_dir = os.path.join(OUTPUT_DIR, 'generatedFullCode')
    os.makedirs(generated_full_code_dir, exist_ok=True)
    
    file_mappings = {
        'python_code': 'PYTHON.py',
        'cpp_code': 'CPP.cpp',
        'java_code': 'JAVA.java',
        'nodejs_code': 'NodeJS.js'
    }
    
    for key, filename in file_mappings.items():
        if key in solutions:
            file_path = os.path.join(generated_full_code_dir, filename)
            with open(file_path, 'w') as f:
                f.write(solutions[key])
                
    print(f"✓ Solutions saved to {generated_full_code_dir}")

    # Step 5: Generate Title & Difficulty
    if "titles" in selected_steps:
        print("\n" + "=" * 60)
        print("STEP 5a: Generating Titles")
        print("=" * 60)

        title_prompt = get_title_prompt(desc_response)
        title_response, title_usage = call_llm(title_prompt, "", purpose="chat")
        update_usage(title_usage.get('prompt_tokens', 0), title_usage.get('completion_tokens', 0), f"{problem_name}_titles", model=title_usage.get('model', 'unknown'), purpose="chat", step_id="generate_question", cost=title_usage.get('cost', 0.0))
        titles_path = os.path.join(OUTPUT_DIR, 'generated_titles.txt')
        with open(titles_path, 'w') as f:
            f.write(title_response)
        print(f"✓ Titles generated")
    else:
        print("\n⏭ Skipping Step 5a: Title Generation")

    if "difficulty" in selected_steps:
        print("\n" + "=" * 60)
        print("STEP 5b: Generating Difficulty")
        print("=" * 60)

        diff_prompt = get_difficulty_prompt(desc_response)
        diff_response, diff_usage = call_llm(diff_prompt, "", purpose="chat")
        update_usage(diff_usage.get('prompt_tokens', 0), diff_usage.get('completion_tokens', 0), f"{problem_name}_difficulty", model=diff_usage.get('model', 'unknown'), purpose="chat", step_id="generate_question", cost=diff_usage.get('cost', 0.0))
        diff_path = os.path.join(OUTPUT_DIR, 'generated_difficulty.txt')
        with open(diff_path, 'w') as f:
            f.write(diff_response.strip())
        print(f"✓ Difficulty generated")
    else:
        print("\n⏭ Skipping Step 5b: Difficulty Estimation")

    # Step 6: Generate Topics
    if "topics" in selected_steps:
        print("\n" + "=" * 60)
        print("STEP 6: Generating Topics")
        print("=" * 60)

        topics_list_path = os.path.join(INPUT_DIR, 'topics_list.txt')
        if os.path.exists(topics_list_path):
            with open(topics_list_path, 'r') as f:
                topics_list_content = f.read()

            topics_prompt = get_topics_prompt(desc_response, user_code, topics_list_content)
            topics_response, topics_usage = call_llm(topics_prompt, "", purpose="chat")
            update_usage(topics_usage.get('prompt_tokens', 0), topics_usage.get('completion_tokens', 0), f"{problem_name}_topics", model=topics_usage.get('model', 'unknown'), purpose="chat", step_id="generate_question", cost=topics_usage.get('cost', 0.0))

            topics_out_path = os.path.join(OUTPUT_DIR, 'generated_topics.json')
            try:
                clean_topics = topics_response.strip()
                if clean_topics.startswith("```"):
                    clean_topics = clean_topics.split('\n', 1)[1].rsplit('\n', 1)[0].strip()
                topic_data = json.loads(clean_topics)
                with open(topics_out_path, 'w') as f:
                    json.dump(topic_data, f, indent=4)
                print(f"✓ Topics generated and saved to {topics_out_path}")
            except Exception as e:
                print(f"Warning: Failed to parse generated topics JSON. {e}")
        else:
            print(f"Warning: {topics_list_path} not found. Skipping topic generation.")
    else:
        print("\n⏭ Skipping Step 6: Topics Classification")
        
    print("\n" + "=" * 60)
    print("✅ SUCCESS! Generation completed.")
    print("=" * 60)

if __name__ == "__main__":
    main()
