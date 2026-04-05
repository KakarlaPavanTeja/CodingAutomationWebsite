"""
Load EXEC_V2_* / AWS_* from project-root env files.

Load order (later files override earlier file values):
  1. .env.execution_manager_v2.example
  2. .env.execution_manager_v2
  3. .env

Shell environment variables remain highest precedence.
"""

from __future__ import annotations

import os


def _project_root() -> str:
    return os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_env_file(path: str, protected_keys: set[str]) -> None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if "=" not in line:
                    continue
                key, _, rest = line.partition("=")
                key = key.strip()
                val = rest.strip().strip("'").strip('"')
                if key and key not in protected_keys:
                    os.environ[key] = val
    except OSError:
        pass


def load_execution_manager_env() -> None:
    protected_keys = set(os.environ.keys())
    root = _project_root()
    for name in (
        ".env.execution_manager_v2.example",
        ".env.execution_manager_v2",
        ".env",
    ):
        _load_env_file(os.path.join(root, name), protected_keys)

