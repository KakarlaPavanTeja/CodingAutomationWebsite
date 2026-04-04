def get_title_prompt(description):
    """
    Constructs the system prompt for generating 5-10 meaningful problem titles
    based on the provided description.
    """
    prompt = f"""You are an expert technical editor. Based on the coding problem description provided below, generate **5 to 10 unique, professional, and concise titles**.

**RULES:**
1. **Short & Meaningful**: Titles should be 2-5 words long. Avoid filler words.
2. **Contextual**: Use keywords from the description but avoid being too literal (e.g., instead of "Sum of Nodes in Tree", use "Binary Path Sum").
3. **Variety**: Provide different angles (e.g., algorithmic focus, data structure focus).
4. **Ranking**: For each title, provide a **"Goodness Percentage"** representing how well it captures the essence of the problem and its professional quality.

**FORMAT:**
- Title Name - Goodness %
- [Example]: Binary Tree Symmetry - 98%

**PROBLEM DESCRIPTION:**
{description}

---
Generate the titles now:
"""
    return prompt
