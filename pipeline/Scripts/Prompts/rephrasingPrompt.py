import json

def get_rephrasing_prompt(original_description, original_code, scenario_level="moderate"):
    """
    Constructs the system prompt for rephrasing coding question descriptions
    and renaming functions/variables.

    Args:
        original_description: The original problem description
        original_code: The reference code
        scenario_level: Level of scenario wrapping - "none", "light", "moderate", or "heavy"
    """

    scenario_instruction = ""
    if scenario_level == "none":
        scenario_instruction = """
**Direct Question Guidelines**:
    - Keep the problem statement straightforward and technical.
    - Focus on the algorithmic challenge without wrapping it in a story.
    - Use clear, precise language to describe the problem.
    - Example: Instead of "spaceship navigation", say "find optimal path in weighted graph"."""
    elif scenario_level == "light":
        scenario_instruction = """
**Light Scenario Guidelines**:
    - Add a thin real-world context (1-2 sentences) to introduce the problem naturally.
    - After the brief context, keep the rest of the description technical and direct.
    - The scenario is just a framing device — don't build a full story.
    - **Vary contexts**: sensors, logs, inventories, schedules, measurements, records.
    - Example: "A warehouse tracks daily shipment weights." then proceed with the algorithmic problem directly."""
    elif scenario_level == "moderate":
        scenario_instruction = """
**Moderate Scenario Guidelines**:
    - Create a NEW scenario/story that is completely different from the original.
    - **Vary the themes**: Don't always use space/sci-fi themes. Use diverse contexts:
      * Real-world systems: Banking, E-commerce, Traffic Management, Supply Chain
      * Nature/Science: DNA sequences, Weather patterns, Ecosystems, Chemical reactions
      * Games/Entertainment: Tournament brackets, Game levels, Puzzle solving
      * Technology: Network routing, File systems, Database optimization
      * Social: Social networks, Team formations, Event scheduling
    - The scenario should naturally lead to the same algorithmic problem.
    - Keep it concise - don't over-elaborate the story."""
    elif scenario_level == "heavy":
        scenario_instruction = """
**Heavy/Immersive Scenario Guidelines**:
    - Create a rich, deeply immersive narrative that fully disguises the algorithm.
    - Build a vivid story world with specific characters, settings, and situations.
    - The reader should be drawn into the scenario before recognizing it as an algorithmic challenge.
    - **Use creative themes**: fantasy quests, detective mysteries, cooking competitions, archaeological digs, space exploration, wildlife research, city planning, historical events.
    - Map every technical element into story terms naturally:
      * Arrays → collections of artifacts, lists of clues, sequences of ingredients
      * Finding/searching → investigating, exploring, deciphering
      * Returning results → reporting findings, presenting conclusions
    - Include 3-5 sentences of narrative context before the actual task.
    - Make it feel like a puzzle within a story, not a math problem with decoration.
    - The scenario MUST be completely different from the original — different theme, different characters, different setting."""
    
    prompt = f"""You are an expert technical content writer for a coding interview platform.
Your goal is to **REPHRASE** an existing coding question description and **RENAME** functions and variables to create a fresh version while preserving the **EXACT** underlying logic and algorithmic requirements.

**INPUTS:**
1. **Original Description:**
{original_description}

2. **Original Code (Reference for Logic):**
```
{original_code}
```

**CRITICAL RULES:**

1.  **Rephrasing Approach**:
{scenario_instruction}

2.  **Naming Changes**:
    - **Function Name**: Generate a NEW, descriptive function name in camelCase.
    - **Variable Names**: Rename variables to fit the new context.
    - **Single-Letter Rule**: For simple integer variables (counts, indices, limits), prefer single letters (`n`, `m`, `k`, `x`, `y`).
    - **Consistency**: Use new names consistently throughout description and code.

3.  **Preserve Logic**:
    - Do NOT change input/output formats.
    - Do NOT change constraints (e.g., 1 <= n <= 10^5).
    - Do NOT change the algorithmic approach.

4.  **Description Structure**:
    - Maintain structure: Introduction, Examples, Input/Output Format, Constraints.
    - Examples must have same logic but use different values and match the new context.

**OUTPUT FORMAT:**
Return ONLY a JSON object with this structure:
{{
    "new_title": "New Title Here",
    "new_function_name": "newFunctionName",
    "variable_mapping": {{
        "old_var1": "new_var1",
        "old_var2": "new_var2"
    }},
    "rephrased_description": "The complete markdown of the new description..."
}}

**Rules for `new_title`:**
- Must be meaningful and concise (5-6 words maximum, <50 characters).
- Should reflect the new context/problem focus.

**Rules for `rephrased_description` Markdown:**
- Use `**` for section titles.
- Sections: **Your Task**, **Constraints**, **Input Format**, **Output Format**.
- Do NOT use `###` or `---`.
- Do NOT include explicit "Examples" section title - list examples directly after intro.
- Start directly with the problem description (no "Problem Statement" header).
- Leave one blank line after section titles.
- In **Your Task**, mention the NEW function name explicitly.

**Rules for `variable_mapping`:**
- Include main function arguments.
- Include key variables mentioned in description.
- Do NOT rename `self` in Python.
- Prefer single letters for simple integer variables.

RETURN ONLY THE JSON. NO OTHER TEXT.
"""
    return prompt
