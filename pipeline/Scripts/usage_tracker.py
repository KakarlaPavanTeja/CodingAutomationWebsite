import json
import os
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), 'Outputs')
USAGE_TRACKER_FILE = os.path.join(OUTPUT_DIR, 'usage_tracker.json')

# GPT-5 pricing
COST_PER_1K_PROMPT_TOKENS = 0.00125  
COST_PER_1K_COMPLETION_TOKENS = 0.01

def load_usage_tracker():
    """Load usage tracker from JSON file"""
    if os.path.exists(USAGE_TRACKER_FILE):
        with open(USAGE_TRACKER_FILE, 'r') as f:
            return json.load(f)
    return {
        "total_requests": 0,
        "total_tokens": 0,
        "total_cost_usd": 0.0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "last_updated": None,
        "history": []
    }

def save_usage_tracker(tracker):
    """Save usage tracker to JSON file"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(USAGE_TRACKER_FILE, 'w') as f:
        json.dump(tracker, f, indent=2)

def update_usage(prompt_tokens, completion_tokens, problem_name):
    """Update usage tracker with new API call"""
    tracker = load_usage_tracker()
    
    total_tokens = prompt_tokens + completion_tokens
    cost = (prompt_tokens / 1000 * COST_PER_1K_PROMPT_TOKENS) + \
           (completion_tokens / 1000 * COST_PER_1K_COMPLETION_TOKENS)
    
    tracker['total_requests'] += 1
    tracker['total_tokens'] += total_tokens
    tracker['total_cost_usd'] += cost
    tracker['prompt_tokens'] += prompt_tokens
    tracker['completion_tokens'] += completion_tokens
    tracker['last_updated'] = datetime.now().isoformat()
    
    # Add to history
    tracker['history'].append({
        'timestamp': datetime.now().isoformat(),
        'problem_name': problem_name,
        'prompt_tokens': prompt_tokens,
        'completion_tokens': completion_tokens,
        'total_tokens': total_tokens,
        'cost_usd': round(cost, 6)
    })
    
    # Keep only last 100 entries in history
    if len(tracker['history']) > 100:
        tracker['history'] = tracker['history'][-100:]
    
    save_usage_tracker(tracker)
    return tracker
