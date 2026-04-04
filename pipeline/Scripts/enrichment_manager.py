import os
import json
import re
from llm_client import call_llm
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
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

    # Usage stats container
    total_usage = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "cost": 0.0
    }

    def update_usage(usage_data):
        p_tokens = usage_data.get("prompt_tokens", 0)
        c_tokens = usage_data.get("completion_tokens", 0)
        t_tokens = usage_data.get("total_tokens", 0)
        
        # Prices: $1.25 / 1M prompt, $10.00 / 1M completion (GPT-5 pricing)
        cost = (p_tokens * 1.25 / 1_000_000) + (c_tokens * 10.00 / 1_000_000)
        
        total_usage["prompt_tokens"] += p_tokens
        total_usage["completion_tokens"] += c_tokens
        total_usage["total_tokens"] += t_tokens
        total_usage["cost"] += cost

    # 2. Generate Real-Life Examples
    if "reallife" in selected_steps:
        print("\ngenerating real-life examples...")
        rl_user_prompt = f"Problem Description:\n{problem_desc}\n\nSolution Code:\n{solution_code}"
        rl_output, rl_usage = call_llm(REAL_LIFE_PROMPT, rl_user_prompt, purpose="enrichment")
        update_usage(rl_usage)
        enrichment_data["real_life_examples"] = extract_real_life_insights(rl_output)
        print("✓ Real-life examples generated")
    else:
        print("\n⏭ Skipping real-life examples")

    # 3. Generate Hints
    if "hints" in selected_steps:
        print("\ngenerating hints...")
        hints_user_prompt = f"Problem Description:\n{problem_desc}\n\nSolution Approach:\n{solution_code}"
        hints_output, hints_usage = call_llm(HINTS_PROMPT, hints_user_prompt, purpose="enrichment")
        update_usage(hints_usage)
        enrichment_data["hints"] = parse_json_from_llm(hints_output)
        print("✓ Hints generated")
    else:
        print("\n⏭ Skipping hints")

    # 4. Generate Follow-up Questions
    if "followups" in selected_steps:
        print("\ngenerating follow-up questions...")
        followup_user_prompt = f"Problem Description:\n{problem_desc}\n\nProblem Code:\n{solution_code}"
        followup_output, followup_usage = call_llm(FOLLOWUP_PROMPT_NEW, followup_user_prompt, purpose="enrichment")
        update_usage(followup_usage)
        enrichment_data["followup_questions"] = parse_json_from_llm(followup_output)
        print("✓ Follow-up questions generated")
    else:
        print("\n⏭ Skipping follow-up questions")

    # 5. Save Output
    output_path = os.path.join(base_dir, "Outputs", "enrichment.json")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(enrichment_data, f, indent=4)
    
    print(f"\n✅ SUCCESS! Enrichment data saved to {output_path}")

    # 6. Track Usage
    tracker_path = os.path.join(base_dir, "Outputs", "usage_tracker.json")
    try:
        if os.path.exists(tracker_path):
            with open(tracker_path, "r") as f:
                tracker = json.load(f)
        else:
            tracker = {}

        tracker["total_requests"] = tracker.get("total_requests", 0) + 3
        tracker["total_tokens"] = tracker.get("total_tokens", 0) + total_usage["total_tokens"]
        tracker["total_cost_usd"] = tracker.get("total_cost_usd", 0.0) + total_usage["cost"]
        tracker["prompt_tokens"] = tracker.get("prompt_tokens", 0) + total_usage["prompt_tokens"]
        tracker["completion_tokens"] = tracker.get("completion_tokens", 0) + total_usage["completion_tokens"]
        
        from datetime import datetime
        tracker["last_updated"] = datetime.now().isoformat()
        
        history_entry = {
            "timestamp": datetime.now().isoformat(),
            "problem_name": "enrichment_generation",
            "prompt_tokens": total_usage["prompt_tokens"],
            "completion_tokens": total_usage["completion_tokens"],
            "total_tokens": total_usage["total_tokens"],
            "cost_usd": total_usage["cost"]
        }
        tracker.setdefault("history", []).append(history_entry)
        
        with open(tracker_path, "w") as f:
            json.dump(tracker, f, indent=2)
        print(f"Usage tracked. Batch Cost: ${total_usage['cost']:.6f}")

    except Exception as e:
        print(f"Error updating usage tracker: {e}")

if __name__ == "__main__":
    generate_enrichment()
