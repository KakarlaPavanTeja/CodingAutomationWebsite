"""
Load AWS_* / S3_* from project-root env files.

Load order (later files override earlier file values):
  1. pipeline/.env.execution_manager_v2
  2. pipeline/.env
  3. repo-root/.env.execution_manager_v2
  4. repo-root/.env
  5. pipeline/.env.new_compiler.local (NEW_COMPILER_URL, etc.)

Shell environment variables remain highest precedence.
PIPELINE_BASE_DIR is intentionally NOT used here — it points at a per-problem
workspace and does not contain AWS credentials.
"""

from __future__ import annotations

import os


def _env_search_roots() -> list[str]:
    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    pipeline_root = os.path.dirname(scripts_dir)
    repo_root = os.path.dirname(pipeline_root)
    roots = [pipeline_root]
    if repo_root and repo_root != pipeline_root:
        roots.append(repo_root)
    return roots


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
    for root in _env_search_roots():
        for name in (
            ".env.execution_manager_v2",
            ".env",
            ".env.new_compiler.local",
        ):
            _load_env_file(os.path.join(root, name), protected_keys)
