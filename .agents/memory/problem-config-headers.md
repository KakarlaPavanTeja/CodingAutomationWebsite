---
name: problem.md config header contract
description: How structure type and function/nonfunction flow from upload → problem.md → Python pipeline, and the canonical forms each layer expects.
---

# problem.md config-header contract

Two distinct concepts must NOT be conflated:
- **Structure type** = data-structure shape: `standard` / `linked list` / `binary tree`.
- **Question type / kind** = `function` / `nonfunction` (drives which workflow steps run).

## Canonical forms per layer
- **DB `problems` table**: `structure_type` stored as underscore-form (`standard`/`linked_list`/`binary_tree`, matches the UI select ids); `question_type` = `function`/`nonfunction`. Both have CHECK constraints.
- **problem.md header**: `# Type:` = structure type in **lowercase-with-spaces** (`standard`/`linked list`/`binary tree`); `# Question Type:` = `function`/`nonfunction`. The upload route maps the underscore UI id → space form when writing `# Type:`.
- **Python pipeline** (`generate_full_question.py`, `code_splitter.py`, `prepare_lua_and_testcases.py`, `prepare_platform_json.py`): every `# Type:` parser compares against the **space form** and now also normalizes defensively with `.lower().replace('_',' ')` so historical underscore data still matches.

**Why:** the original bug — UI sent `linked_list`/`binary_tree` (underscores), written verbatim into `# Type:`, but every Python comparison used `"linked list"`/`"binary tree"` (spaces) → node-based problems were silently treated as `standard` (no Node class injected, wrong LUA/platform JSON). Function vs nonfunction was only ever in the DB, never reached the question generator.

## How to apply
- Adding/renaming a structure type: update the UI ids, the upload route's `STRUCTURE_TYPES` set + `STRUCTURE_HEADER_FORM` map, the DB CHECK, and the space-form strings the Python parsers compare against — all in lockstep.
- Non-function problems must skip function-signature naming enforcement in `generate_full_question.py` (`run_naming` gated on `question_kind == "function"`); otherwise a bogus signature gets forced onto a whole-program stdin/stdout solution.
- The pipeline run route validates `stepId ∈ getWorkflowSteps(storedQuestionType, storedMode)` and derives mode from the stored record — never trust the client's stepId/mode for a problem it doesn't fit.
