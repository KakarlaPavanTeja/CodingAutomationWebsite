import os
import json
import re
from llm_client import call_llm
from usage_tracker import update_usage as track_usage
from Prompts.enrichment_prompts import HINTS_PROMPT, REAL_LIFE_PROMPT, FOLLOWUP_PROMPT_NEW

def load_file(filepath):
    """Loads content from a file."""
    if not os.path.exists(filepath):
        print(f"Warning: File not found: {filepath}")
        return ""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()

def parse_json_from_llm(llm_output):
    """Cleanly extracts JSON from LLM output."""
    try:
        # Try finding JSON block
        json_match = re.search(r'\{.*\}|\[.*\]', llm_output, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(0))
        return json.loads(llm_output)
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        return {}

def extract_real_life_insights(llm_output):
    """Cleaning function for real-life examples text output."""
    lines = llm_output.strip().split('\n')
    insights = [line.strip() for line in lines if line.strip() and (line[0].isdigit() or line.startswith('-'))]
    return "\n\n".join(insights[:2])

def generate_enrichment():
    import argparse
    parser = argparse.ArgumentParser(description="Generate enrichment content")
    parser.add_argument("--steps", default="reallife,hints,followups",
                        help="Comma-separated enrichment types: reallife,hints,followups")
    args = parser.parse_args()
    selected_steps = [s.strip() for s in args.steps.split(",")]

    print("============================================================")
    print("ENRICHMENT GENERATOR (Hints, Real-life, Follow-ups)")
    print("============================================================")
    print(f"Selected enrichment types: {selected_steps}")

    # 1. Load Inputs
    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    problem_desc_path = os.path.join(base_dir, "Outputs", "generated_description.md")
    problem_desc = load_file(problem_desc_path)
    
    # Load Solution from generatedFullCode
    generated_full_code_dir = os.path.join(base_dir, "Outputs", "generatedFullCode")
    solution_code = ""
    
    if os.path.exists(generated_full_code_dir):
        # Prioritize C++, then Python, then Java, then Node.js
        priority_files = ["CPP.cpp", "PYTHON.py", "JAVA.java", "NodeJS.js"]
        for filename in priority_files:
            file_path = os.path.join(generated_full_code_dir, filename)
            if os.path.exists(file_path):
                solution_code = load_file(file_path)
                if solution_code:
                    break
    
    # Validation
    if not problem_desc:
        print("Error: Missing 'Outputs/generated_description.md'.")
        return
        
    if not solution_code:
        print("Error: Could not find any solution code in 'Outputs/generated_solutions.json'.")
        print("Please run 'generate_full_question.py' first.")
        return

    enrichment_data = {}

    # 2. Generate Real-Life Examples
    if "reallife" in selected_steps:
        print("\ngenerating real-life examples...")
        rl_user_prompt = f"Problem Description:\n{problem_desc}\n\nSolution Code:\n{solution_code}"
        rl_output, rl_usage = call_llm(REAL_LIFE_PROMPT, rl_user_prompt, purpose="enrichment")
        track_usage(rl_usage.get('prompt_tokens', 0), rl_usage.get('completion_tokens', 0), "enrichment_reallife", model=rl_usage.get('model', 'unknown'), purpose="enrichment", step_id="generate_enrichment", cost=rl_usage.get('cost', 0.0))
        enrichment_data["real_life_examples"] = extract_real_life_insights(rl_output)
        print("✓ Real-life examples generated")
    else:
        print("\n⏭ Skipping real-life examples")

    # 3. Generate Hints
    if "hints" in selected_steps:
        print("\ngenerating hints...")
        hints_user_prompt = f"Problem Description:\n{problem_desc}\n\nSolution Approach:\n{solution_code}"
        hints_output, hints_usage = call_llm(HINTS_PROMPT, hints_user_prompt, purpose="enrichment")
        track_usage(hints_usage.get('prompt_tokens', 0), hints_usage.get('completion_tokens', 0), "enrichment_hints", model=hints_usage.get('model', 'unknown'), purpose="enrichment", step_id="generate_enrichment", cost=hints_usage.get('cost', 0.0))
        enrichment_data["hints"] = parse_json_from_llm(hints_output)
        print("✓ Hints generated")
    else:
        print("\n⏭ Skipping hints")

    # 4. Generate Follow-up Questions
    if "followups" in selected_steps:
        print("\ngenerating follow-up questions...")
        followup_user_prompt = f"Problem Description:\n{problem_desc}\n\nProblem Code:\n{solution_code}"
        followup_output, followup_usage = call_llm(FOLLOWUP_PROMPT_NEW, followup_user_prompt, purpose="enrichment")
        track_usage(followup_usage.get('prompt_tokens', 0), followup_usage.get('completion_tokens', 0), "enrichment_followups", model=followup_usage.get('model', 'unknown'), purpose="enrichment", step_id="generate_enrichment", cost=followup_usage.get('cost', 0.0))
        enrichment_data["followup_questions"] = parse_json_from_llm(followup_output)
        print("✓ Follow-up questions generated")
    else:
        print("\n⏭ Skipping follow-up questions")

    # 5. Save Output
    output_path = os.path.join(base_dir, "Outputs", "enrichment.json")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(enrichment_data, f, indent=4)
    
    print(f"\n✅ SUCCESS! Enrichment data saved to {output_path}")

    print("✓ Enrichment usage tracked per-call to Supabase")

if __name__ == "__main__":
    generate_enrichment()
