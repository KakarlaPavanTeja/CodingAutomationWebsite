def get_topics_prompt(problem_desc, user_code, topics_list_content):
    prompt = f"""You are an expert Data Structures and Algorithms instructor.

Your task is to analyze the provided Problem Description and Solution Code to determine the most relevant algorithmic topics required to solve this specific problem.

You are provided with a strictly defined list of topics categorized by difficulty. You MUST ONLY select topics that exist exactly as written in this list. Do NOT invent new topics.

**ALLOWED TOPICS LIST:**
{topics_list_content}

**INSTRUCTIONS:**
1. Thoroughly analyze the core concepts, data structures, and algorithms used in the Solution Code and required by the Problem Description.
2. Select all applicable topics from the "ALLOWED TOPICS LIST". 
3. You must maintain the exact spelling, casing, and difficulty level as defined in the list.
4. It is perfectly fine if a problem only has topics from one category (e.g. only Beginner topics), but try to be comprehensive. 

**OUTPUT FORMAT:**
Return a strictly valid JSON object with the following keys, mapped to lists of strings representing the topics you selected:
- "beginner_topics"
- "intermediate_topics"
- "advanced_topics"

Do NOT output any markdown blocks (like ```json). Return ONLY the raw JSON string.

**PROBLEM DESCRIPTION:**
{problem_desc}

**SOLUTION CODE:**
{user_code}
"""
    return prompt
