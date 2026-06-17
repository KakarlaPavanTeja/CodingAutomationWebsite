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
from Prompts.editorialPrompt import (
    EDITORIAL_PROMPT,
    EDITORIAL_ROUTER_PROMPT,
    build_user_message,
    build_router_user_message,
)


# Router letter -> reasoning effort passed to the editorial model.
#   A = plain model (no thinking), B = thinking medium, C = thinking high.
_EFFORT_BY_LETTER = {"A": None, "B": "medium", "C": "high"}


def decide_reasoning_effort(statement, solutions):
    """
    Ask the model whether this problem needs extended reasoning, and how much.

    Precedence:
      1. OPENAI_REASONING_EFFORT_EDITORIAL env set  -> use it (manual override),
         skip routing entirely. Sentinel "ENV" tells the caller not to override.
      2. EDITORIAL_REASONING_MODE in {a,b,c}        -> force that level.
      3. otherwise                                  -> auto-route via the model.

    Returns either the sentinel string "ENV" (let call_llm read the env var) or a
    reasoning-effort value: None (off) / "medium" / "high".
    """
    env_override = os.environ.get("OPENAI_REASONING_EFFORT_EDITORIAL")
    if env_override is not None and env_override.strip():
        print("Reasoning effort: using OPENAI_REASONING_EFFORT_EDITORIAL override.")
        return "ENV"

    forced = (os.environ.get("EDITORIAL_REASONING_MODE") or "").strip().upper()
    if forced in _EFFORT_BY_LETTER:
        effort = _EFFORT_BY_LETTER[forced]
        print(f"Reasoning effort: forced via EDITORIAL_REASONING_MODE={forced} "
              f"-> {effort or 'off'}.")
        return effort

    print("Routing: asking the model how much thinking this problem needs...")
    try:
        reply, usage = call_llm(
            EDITORIAL_ROUTER_PROMPT,
            build_router_user_message(statement, solutions),
            purpose="chat",
            reasoning_effort=None,  # the router itself never needs to think
            max_tokens=16,
        )
        track_usage(
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            "editorial_router",
            model=usage.get("model", "unknown"),
            purpose="editorial_router",
            step_id="generate_editorial",
            cost=usage.get("cost", 0.0),
        )
    except Exception as exc:  # never let routing block editorial generation
        print(f"Routing failed ({exc}); defaulting to no extended thinking.")
        return None

    letter = next((c for c in (reply or "").upper() if c in _EFFORT_BY_LETTER), "A")
    effort = _EFFORT_BY_LETTER[letter]
    print(f"Routing decision: {letter} -> reasoning effort "
          f"{effort or 'off (plain model)'}.")
    return effort


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

    # Let the model decide how much "thinking" this problem needs (A/B/C ->
    # off/medium/high), unless an env override forces a fixed level.
    effort = decide_reasoning_effort(statement, solutions)

    editorial_kwargs = {"purpose": "editorial"}
    if effort != "ENV":  # "ENV" => let call_llm read OPENAI_REASONING_EFFORT_EDITORIAL
        editorial_kwargs["reasoning_effort"] = effort

    print("\nGenerating editorial (this can take several minutes)...")
    content, usage = call_llm(EDITORIAL_PROMPT, user_message, **editorial_kwargs)

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
