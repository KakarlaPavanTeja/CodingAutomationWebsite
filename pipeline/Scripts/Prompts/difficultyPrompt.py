def get_difficulty_prompt(description):
    """
    Constructs the system prompt for determining the difficulty of a coding problem.
    """
    prompt = f"""You are an expert Coding Interview Architect.
Your task is to analyze the following "Problem Description" and assign a Difficulty Level.

**PROBLEM DESCRIPTION:**
{description}

**DIFFICULTY LEVELS:**
- **Easy**: Basic array/string manipulation, simple loops, no complex data structures.
- **Medium**: standard algorithms (DFS, BFS, Sort, Two Pointers), standard data structures (Map, Set, Stack, Queue).
- **Hard**: Complex DP, Graph theory, subtle edge cases, advanced data structures (Trie, Segment Tree), or combined algorithms.

**OUTPUT FORMAT:**
Return ONLY the difficulty level. No explanation.
Options: [Easy, Medium, Hard]
"""
    return prompt
