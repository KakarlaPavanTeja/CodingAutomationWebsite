"""Backward-compatible alias for sandbox scripts — use execution_manager_v3.py in production."""
from execution_manager_v3 import *  # noqa: F401,F403
from execution_manager_v3 import main

if __name__ == "__main__":
    main()
