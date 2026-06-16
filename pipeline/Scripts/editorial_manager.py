"""
Editorial generator — the LAST pipeline step (both function and non-function
problems).

Loads the problem statement, the per-language full solution code, and (when
present) the per-language driver code, builds the per-problem user message, calls
the editorial LLM (purpose="editorial", default openai/gpt-5.5, 100K output cap),
and writes the result to Outputs/editorial.md. Token usage + real USD cost are
recorded like every other step. Follows the enrichment_manager.py pattern.
"""

import os

from llm_client import call_llm
from usage_tracker import update_usage as track_usage
from Prompts.editorialPrompt import EDITORIAL_PROMPT, build_user_message


def load_file(filepath):
    """Loads content from a file, returning '' when missing."""
    if not os.path.exists(filepath):
        return ""
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()


# lang_key -> (generatedFullCode filename, CodeContentFiles folder, extension)
_LANG_FILES = {
    "cpp": ("CPP.cpp", "Cpp", ".cpp"),
    "python": ("PYTHON.py", "Python", ".py"),
    "java": ("JAVA.java", "Java", ".java"),
    "nodejs": ("NodeJS.js", "NodeJS", ".js"),
}


def generate_editorial():
    print("============================================================")
    print("EDITORIAL GENERATOR (multi-solution DSA editorial)")
    print("============================================================")

    base_dir = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    outputs_dir = os.path.join(base_dir, "Outputs")

    # 1. Problem statement: prefer generated description, fall back to raw input.
    statement = load_file(os.path.join(outputs_dir, "generated_description.md"))
    if not statement:
        statement = load_file(os.path.join(base_dir, "Inputs", "problem.md"))
    if not statement:
        print("Error: Missing problem statement "
              "('Outputs/generated_description.md' or 'Inputs/problem.md').")
        return 1

    # 2. Per-language full solution code.
    full_code_dir = os.path.join(outputs_dir, "generatedFullCode")
    content_files_dir = os.path.join(outputs_dir, "CodeContentFiles")

    solutions: dict[str, str] = {}
    drivers: dict[str, str] = {}

    for lang_key, (full_name, folder, ext) in _LANG_FILES.items():
        code = load_file(os.path.join(full_code_dir, full_name))
        if code.strip():
            solutions[lang_key] = code

        # Driver code (function-based problems only). Used to confirm the
        # function name / signature / types — never reproduced verbatim.
        driver = load_file(os.path.join(content_files_dir, folder, f"driver{ext}"))
        if driver.strip():
            drivers[lang_key] = driver

    if not solutions:
        print("Error: Could not find any solution code in "
              "'Outputs/generatedFullCode/'. Run 'generate_full_question.py' first.")
        return 1

    print(f"Loaded solution code for: {', '.join(sorted(solutions))}")
    if drivers:
        print(f"Loaded driver code for: {', '.join(sorted(drivers))}")
    else:
        print("No driver code found (non-function problem or split not run).")

    # 3. Build the per-problem user message and call the editorial model.
    #    EDITORIAL_PROMPT is the constant cached system prefix; all variable
    #    content goes in the user message.
    user_message = build_user_message(statement, solutions, drivers)

    print("\nGenerating editorial (this can take several minutes)...")
    content, usage = call_llm(EDITORIAL_PROMPT, user_message, purpose="editorial")

    track_usage(
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        "editorial",
        model=usage.get("model", "unknown"),
        purpose="editorial",
        step_id="generate_editorial",
        cost=usage.get("cost", 0.0),
    )

    # 4. Verify non-empty before declaring success (call_llm already raises on
    #    fully-empty content; this guards against whitespace-only output).
    if not content or not content.strip():
        print("Error: editorial generation returned empty content.")
        return 1

    output_path = os.path.join(outputs_dir, "editorial.md")
    os.makedirs(outputs_dir, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content.strip() + "\n")

    print(f"\n✅ SUCCESS! Editorial saved to {output_path} "
          f"({len(content)} chars, cost=${usage.get('cost', 0.0):.6f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(generate_editorial())
