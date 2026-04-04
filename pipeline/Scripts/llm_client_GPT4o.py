import requests
import os

API_URL = "http://43.204.71.128:4000/chat/completions"
API_KEY = "sk-G-HxdSbYuEiesRDNPCHPQA"

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# DEFAULT METADATA REQUIRED BY GATEWAY
DEFAULT_METADATA = {
    "project_name": "CCBP_FRONTEND_INTERVIEW_KIT",
    "feature": "DSA_CONTENT_GENERATION",
    "step": "CSV_ENRICHMENT",
    "team": "DSA_CONTENT",
    "meta": {}
}


def call_llm(system_prompt: str, user_prompt: str, temperature: float = 0.3):
    payload = {
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": temperature,
        "metadata": DEFAULT_METADATA
    }

    response = requests.post(
        API_URL,
        headers=HEADERS,
        json=payload,
        timeout=300
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"LLM call failed: {response.status_code} - {response.text}"
        )

    data = response.json()
    
    # Return both content AND usage data for tracking
    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    return content, usage
