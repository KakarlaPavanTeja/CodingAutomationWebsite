import os
import sys
import json
import time

# Ensure Scripts directory is in path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from llm_client import call_llm
from Prompts.splittingPrompt import get_splitting_prompt
from usage_tracker import update_usage

def clean_json_string(s):
    """Attempt to clean markdown code blocks from string."""
    s = s.strip()
    if s.startswith("```json"):
        s = s[7:]
    elif s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[:-3]
    return s.strip()

def save_split_code(language_name, split_data, question_type="standard"):
    """
    Saves the split code components to ContentFiles/<language>/
    """
    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    content_files_dir = os.path.join(base_dir, "Outputs", "CodeContentFiles")
    
    # Map friendly names to folder names
    folder_map = {
        "Python": "Python",
        "C++": "Cpp", 
        "Java": "Java", 
        "Node.js": "NodeJS"
    }
    
    folder_name = folder_map.get(language_name, language_name)
    target_dir = os.path.join(content_files_dir, folder_name)
    os.makedirs(target_dir, exist_ok=True)
    
    # Extension map
    ext_map = {
        "Python": ".py",
        "C++": ".cpp",
        "Java": ".java",
        "Node.js": ".js"
    }
    ext = ext_map.get(language_name, ".txt")
    
    # Write files
    files = {
        "default": split_data.get("default_code", ""),
        "solution": split_data.get("solution_code", ""),
        "driver": split_data.get("driver_code", ""),
        "debugger": split_data.get("debugger_code", "")
    }
    
    for key, content in files.items():
        filename = f"{key}{ext}"
        filepath = os.path.join(target_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  -> Saved {filename}")

    # Generate node.h for C++
    if language_name == "C++" and question_type in ["binary tree", "linked list"]:
        if question_type == "binary tree":
            node_h_content = """#ifndef NODE_CPP
#define NODE_CPP

class Node {
public:
    int val;
    Node* left;
    Node* right;
    Node(int val) : val(val), left(nullptr), right(nullptr) {}
};

#endif
"""
        elif question_type == "linked list":
            node_h_content = """#ifndef NODE_CPP
#define NODE_CPP

class Node {
public:
    int val;
    Node* next;
    Node(int val, Node* next) : val(val), next(next) {}
    Node(int val) : val(val), next(nullptr) {}
};

#endif
"""
        
        node_h_path = os.path.join(target_dir, "node.h")
        with open(node_h_path, "w", encoding="utf-8") as f:
            f.write(node_h_content)
        print("  -> Saved node.h")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Split code into components")
    parser.add_argument("--langs", default="python,cpp,java,nodejs",
                        help="Comma-separated languages to process: python,cpp,java,nodejs")
    args = parser.parse_args()
    selected_langs = [l.strip().lower() for l in args.langs.split(",")]

    print("============================================================")
    print("CODE SPLITTER & WRAPPER GENERATOR")
    print("============================================================")
    print(f"Selected languages: {selected_langs}")

    # 1. Load generated code from generatedFullCode folder
    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    generated_full_code_dir = os.path.join(base_dir, "Outputs", "generatedFullCode")
    
    if not os.path.exists(generated_full_code_dir):
        print(f"Error: {generated_full_code_dir} not found. Run generation first.")
        return

    # Map file names back to the internal keys expected by the splitting logic
    file_mappings = {
        'PYTHON.py': 'python_code',
        'CPP.cpp': 'cpp_code',
        'JAVA.java': 'java_code',
        'NodeJS.js': 'nodejs_code'
    }
    
    solutions = {}
    for filename, key in file_mappings.items():
        file_path = os.path.join(generated_full_code_dir, filename)
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                solutions[key] = f.read()

    # 1.1 Load generated_description.md
    desc_path = os.path.join(base_dir, "Outputs", "generated_description.md")
    desc_content = ""
    if os.path.exists(desc_path):
        with open(desc_path, "r") as f:
            desc_content = f.read()

    # 1.2 Load problem.md to get question type
    problem_path = os.path.join(base_dir, "Inputs", "problem.md")
    question_type = "standard"
    if os.path.exists(problem_path):
        with open(problem_path, "r") as f:
            lines = f.read().split('\n')
            for line in lines:
                if line.startswith('# Type:'):
                    question_type = line.replace('# Type:', '').strip().lower()

    # Map likely keys from generated code to readable names
    lang_keys = {
        "python_code": "Python",
        "cpp_code": "C++",
        "java_code": "Java",
        "nodejs_code": "Node.js"
    }

    # Map selected lang IDs to internal keys
    lang_id_to_key = {
        'python': 'python_code',
        'cpp': 'cpp_code',
        'java': 'java_code',
        'nodejs': 'nodejs_code'
    }
    selected_keys = set(lang_id_to_key.get(l, '') for l in selected_langs)

    for key, lang_name in lang_keys.items():
        if key not in selected_keys:
            print(f"⏭ Skipping {lang_name} (not selected)")
            continue
        code = solutions.get(key)
        if not code:
            print(f"Skipping {lang_name} (No code found).")
            continue
            
        print(f"\nProcessing {lang_name}...")
        
        # 2. Call LLM to split code
        system_prompt, user_prompt = get_splitting_prompt(lang_name, code, desc_response=desc_content, question_type=question_type)
        response, usage = call_llm(system_prompt, user_prompt, purpose="code")
        
        # Track usage
        update_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            f"code_splitting_{lang_name}",
            model=usage.get("model", "unknown"),
            purpose="code",
            step_id="split_code",
            cost=usage.get("cost", 0.0),
        )
        
        # 3. Parse and Save
        try:
            cleaned_response = clean_json_string(response)
            split_data = json.loads(cleaned_response)
            save_split_code(lang_name, split_data, question_type)
        except json.JSONDecodeError as e:
            print(f"  Error parsing JSON for {lang_name}: {e}")
            print("  Raw response snippet:", response[:100])
        except Exception as e:
            print(f"  Error saving files for {lang_name}: {e}")

    print("\n✅ Code splitting completed.")

if __name__ == "__main__":
    main()
