import os
import sys
import json
import glob
import re

# Prompts
from Prompts.descriptionPrompt import get_description_prompt, get_nonfunction_description_prompt
from Prompts.titlePrompt import get_title_prompt
from Prompts.difficultyPrompt import get_difficulty_prompt
from Prompts.conversionPrompt import get_conversion_prompt
from Prompts.normalizationPrompt import get_normalization_prompt
from Prompts.topicsPrompt import get_topics_prompt

from llm_client import call_llm
from usage_tracker import update_usage
from problem_flags import (OPEN_ENDED_MARKER_RE, checker_defects, load_open_ended,
                           stdin_parsing_defects,
                           save_problem_flags, split_open_ended_marker)
from code_cleaner import clean_generated_code, strip_code_fence

# Directory constants
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.environ.get("PIPELINE_BASE_DIR") or os.path.dirname(SCRIPT_DIR)
INPUT_DIR = os.path.join(BASE_DIR, 'Inputs')
OUTPUT_DIR = os.path.join(BASE_DIR, 'Outputs')

def _is_table_row(line):
    s = line.strip()
    return s.startswith('|') and s.count('|') >= 2


def _is_table_separator(line):
    s = line.strip()
    if not s.startswith('|'):
        return False
    cells = [c.strip() for c in s.strip('|').split('|')]
    cells = [c for c in cells if c != '']
    if not cells:
        return False
    return all(re.match(r'^:?-{1,}:?$', c) for c in cells)


def _table_to_bullets(table_lines):
    """Convert a markdown pipe-table block into a renderer-safe bullet/sub-bullet
    list, preserving every value exactly. Row 0 is the header, row 1 the separator,
    rows 2+ the data."""
    rows = []
    for ln in table_lines:
        s = ln.strip().strip('|')
        rows.append([c.strip() for c in s.split('|')])
    if len(rows) < 2:
        return table_lines

    header = rows[0]
    data_rows = rows[2:]
    out = []
    for r in data_rows:
        if all(c == '' for c in r):
            continue
        first_label = header[0] if header and header[0] else ''
        out.append(f"- {first_label}: {r[0]}" if first_label else f"- {r[0]}")
        for ci in range(1, len(r)):
            label = header[ci] if ci < len(header) and header[ci] else ''
            out.append(f"    - {label}: {r[ci]}" if label else f"    - {r[ci]}")
        out.append("")
    return out


def normalize_renderer_safe(text):
    """Deterministic renderer-safe normalization for the 'none' scenario description.

    The platform's custom markdown renderer cannot display ATX headings, horizontal
    rules, language-tagged code fences, or markdown tables. This pass guarantees
    renderer-safe output regardless of model drift, WITHOUT altering any values:
    - ATX headings (`#`..`######`) -> bold `**Title**` (skipped inside code fences)
    - horizontal rules (`---`, `***`, `___`) -> removed
    - code-fence openers -> bare ``` (language identifier stripped)
    - markdown pipe-tables -> bullet/sub-bullet lists preserving every value
    """
    lines = text.replace('\r\n', '\n').split('\n')
    out = []
    in_fence = False
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]

        fence_match = re.match(r'^(\s*)(`{3,}|~{3,})(.*)$', line)
        if fence_match:
            indent, ticks, _rest = fence_match.groups()
            out.append(f"{indent}{ticks}")
            in_fence = not in_fence
            i += 1
            continue

        if in_fence:
            out.append(line)
            i += 1
            continue

        # Horizontal rule -> drop
        if re.match(r'^\s*([-*_])(\s*\1){2,}\s*$', line):
            i += 1
            continue

        # ATX heading -> bold title
        h = re.match(r'^\s*#{1,6}\s+(.*?)\s*#*\s*$', line)
        if h:
            title = h.group(1).strip()
            if title.startswith('**') and title.endswith('**'):
                out.append(title)
            else:
                out.append(f"**{title}**")
            i += 1
            continue

        # Markdown table -> bullet list
        if _is_table_row(line) and i + 1 < n and _is_table_separator(lines[i + 1]):
            table_lines = []
            while i < n and _is_table_row(lines[i]):
                table_lines.append(lines[i])
                i += 1
            out.extend(_table_to_bullets(table_lines))
            continue

        out.append(line)
        i += 1

    return '\n'.join(out)


def parse_problem_md(file_path):
    """Parse problem.md to extract metadata"""
    if not os.path.exists(file_path):
        print(f"Error: {file_path} not found.")
        sys.exit(1)
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    lines = content.split('\n')
    problem_name = "Unknown Problem"
    # `# Type:` carries the data-structure shape (standard / linked list /
    # binary tree). Normalize underscores -> spaces and lowercase so both the
    # canonical header form and any historical underscore form match the
    # downstream comparisons.
    structure_type = "standard"
    # `# Question Type:` carries function vs nonfunction. Default to function.
    question_kind = "function"
    scenario_level = "moderate"  # default for backward compatibility

    for line in lines:
        if line.startswith('# Problem:'):
            problem_name = line.replace('# Problem:', '').strip()
        elif line.startswith('# Question Type:'):
            value = line.replace('# Question Type:', '').strip().lower()
            question_kind = "nonfunction" if "non" in value else "function"
        elif line.startswith('# Type:'):
            structure_type = line.replace('# Type:', '').strip().lower().replace('_', ' ')
        elif line.startswith('# Scenario Level:'):
            value = line.replace('# Scenario Level:', '').strip().lower()
            if value in ['none', 'light', 'moderate', 'heavy']:
                scenario_level = value
        elif line.startswith('# Use Scenario:'):
            # Backward compatibility: map old yes/no to levels
            value = line.replace('# Use Scenario:', '').strip().lower()
            if value not in ['yes', 'true']:
                scenario_level = "none"

    return problem_name, structure_type, question_kind, scenario_level, content

def to_camel_case(name):
    """Normalize a function name to camelCase.

    Handles snake_case, kebab-case, spaced, PascalCase and SCREAMING_SNAKE
    inputs; an already-camelCase name is returned essentially unchanged (only
    its first character is lowercased). Any non-alphanumeric character is
    treated as a word separator. This is the single enforcement point that
    guarantees the function name flowing into generated code is camelCase,
    regardless of how it was written in the source description/user code.
    """
    if not name:
        return name
    raw = name.strip()
    if not raw:
        return raw
    tokens = [t for t in re.split(r'[^0-9a-zA-Z]+', raw) if t]
    if not tokens:
        return raw
    if len(tokens) == 1:
        token = tokens[0]
        # No delimiters: keep any internal camelCase, only fix the first char.
        # An all-uppercase token (e.g. SCREAMING) becomes fully lowercase.
        if token.isupper():
            return token.lower()
        return token[0].lower() + token[1:]

    def _norm(token, first):
        # Collapse all-caps tokens (SCREAMING_SNAKE / acronyms) to lowercase so
        # they capitalize cleanly; otherwise preserve any existing inner casing.
        base = token.lower() if token.isupper() else token
        if first:
            return base[0].lower() + base[1:]
        return base[0].upper() + base[1:]

    return ''.join(_norm(t, i == 0) for i, t in enumerate(tokens))


def _parse_signature(raw):
    """Robustly parse the function-signature JSON the extractor returns.

    The model may wrap the JSON in a code fence or add stray prose, so we strip
    fences and grab the first {...} block before parsing. Returns a normalized
    dict (with a non-empty function_name and a clean parameter list) or None.
    """
    if not raw:
        return None
    text = raw.strip()
    if text.startswith("```"):
        # Drop the opening fence line and any trailing fence.
        text = text.split('\n', 1)[-1].rsplit('```', 1)[0]
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        data = json.loads(text)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    name = str(data.get("function_name") or "").strip()
    if not name:
        return None
    # The function name must always be camelCase in the generated code, even
    # when the source description/user code used snake_case or PascalCase.
    name = to_camel_case(name)
    params = data.get("parameters") or []
    if not isinstance(params, list):
        params = []
    data["function_name"] = name
    data["parameters"] = [str(p).strip() for p in params if str(p).strip()]
    return data


LANG_MAP = {
    'python': 'python_code',
    'c++': 'cpp_code',
    'java': 'java_code',
    'node.js': 'nodejs_code',
}

LANG_ID_TO_KEY = {
    'python': 'python_code',
    'cpp': 'cpp_code',
    'java': 'java_code',
    'nodejs': 'nodejs_code',
}

TARGET_LANGS = {
    "cpp_code": "C++",
    "java_code": "Java",
    "nodejs_code": "Node.js",
    "python_code": "Python",
}

FILE_MAPPINGS = {
    'python_code': 'PYTHON.py',
    'cpp_code': 'CPP.cpp',
    'java_code': 'JAVA.java',
    'nodejs_code': 'NodeJS.js',
}


def _current_step_id():
    return os.environ.get("PIPELINE_STEP_ID") or "generate_question"


def _track_llm_usage(usage, label, purpose="chat"):
    update_usage(
        usage.get('prompt_tokens', 0),
        usage.get('completion_tokens', 0),
        label,
        model=usage.get('model', 'unknown'),
        purpose=purpose,
        step_id=_current_step_id(),
        cost=usage.get('cost', 0.0),
    )


def _strip_scratchpad(text):
    return re.sub(r'<scratchpad>.*?</scratchpad>', '', text, flags=re.DOTALL).strip()


def _generated_full_code_dir():
    path = os.path.join(OUTPUT_DIR, 'generatedFullCode')
    os.makedirs(path, exist_ok=True)
    return path


def _signature_path():
    return os.path.join(OUTPUT_DIR, 'description_signature.json')


def _working_code_path(detected_lang):
    """The single Outputs file holding the reference solution.

    Seeded from Inputs/ before any sub-step runs, rewritten IN PLACE by naming,
    read back by topics/codes. Naming used to write the same code twice
    (`Outputs/normalized_source.py` AND `generatedFullCode/PYTHON.py`), so a
    manual edit had to be made in two places to take effect. Everything
    downstream (testcases, brute force, split, execute, editorial) already reads
    generatedFullCode/, so that is the copy that survives.
    """
    key = LANG_MAP.get(detected_lang.lower(), 'python_code')
    return os.path.join(_generated_full_code_dir(), FILE_MAPPINGS[key])


def _read_text(path):
    """Read a file, tolerating its absence — a missing reference must not kill the step."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ""


def _description_path():
    return os.path.join(OUTPUT_DIR, 'generated_description.md')


def _load_description():
    path = _description_path()
    if not os.path.exists(path):
        return ""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def _save_description(text):
    with open(_description_path(), 'w', encoding='utf-8') as f:
        f.write(text)


def _save_signature(signature):
    if signature:
        with open(_signature_path(), 'w', encoding='utf-8') as f:
            json.dump(signature, f, indent=2)


def _load_signature():
    path = _signature_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _save_working_code(code, detected_lang):
    with open(_working_code_path(detected_lang), 'w', encoding='utf-8') as f:
        f.write(code)


def _load_working_code(detected_lang, fallback):
    path = _working_code_path(detected_lang)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    return fallback


def _seed_working_code(user_code, detected_lang):
    """Copy Inputs/solution.* into Outputs on first touch, so the editable copy
    exists no matter which sub-step runs first. Never overwrites: a re-run of
    topics/codes must not clobber the naming step's rename (or a hand edit)."""
    path = _working_code_path(detected_lang)
    if os.path.exists(path):
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(user_code)
    print(f"✓ Seeded editable solution copy at {os.path.relpath(path, OUTPUT_DIR)}")


def _save_solution_file(lang_key, code):
    filename = FILE_MAPPINGS.get(lang_key)
    if not filename:
        return
    out_path = os.path.join(_generated_full_code_dir(), filename)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(code)


def detect_user_solution():
    """Find the user's Python reference solution in Inputs/. Returns (path, 'python').

    PYTHON ONLY, enforced rather than assumed. The rest of the pipeline has no path for
    any other source language: there is no `translate_python` sub-step (the translation
    targets are defined by EXCLUDING python — see getPipelineTargetLanguages), so
    `Outputs/generatedFullCode/PYTHON.py` would never be written, and both
    generate_brute_force and testcase_manager_v4 exit on its absence. This used to accept
    .cpp/.java/.js and fail three steps later on a missing file, while the description and
    naming steps carried non-Python branches implying support that never existed.
    """
    exact = os.path.join(INPUT_DIR, 'solution.py')
    if os.path.exists(exact):
        return exact, 'python'

    matches = sorted(glob.glob(os.path.join(INPUT_DIR, '*.py')))
    if matches:
        # Prefer solution.py above; anything else is a guess worth naming out loud.
        print(f"Warning: no Inputs/solution.py — using {os.path.basename(matches[0])}"
              + (f" (ignoring {len(matches) - 1} other .py file(s))" if len(matches) > 1 else ""))
        return matches[0], 'python'

    others = sorted(
        os.path.basename(p)
        for pattern in ('*.cpp', '*.java', '*.js')
        for p in glob.glob(os.path.join(INPUT_DIR, pattern))
    )
    if others:
        print(f"Error: the reference solution must be Python. Found: {', '.join(others)}.")
        print("This pipeline translates Python INTO C++/Java/Node.js; it cannot start from"
              " them (no PYTHON.py would ever be produced, and the testcase and brute-force"
              " steps both require it).")
        sys.exit(1)

    print("Error: No solution file found in Inputs/")
    print("Please provide Inputs/solution.py")
    sys.exit(1)

MAX_DESCRIPTION_ATTEMPTS = 3

_DESC_REPAIR_SYSTEM = (
    "You are correcting a coding-problem statement. The reference solution is the source "
    "of truth: it RAN and printed the outputs shown below. Rewrite the statement so its "
    "worked Examples show what the reference actually prints, and so the Output Format "
    "describes that. Change nothing else — same scenario, same variable names, same "
    "constraints. Return the FULL corrected statement in the same markdown format, and "
    "keep the trailing OPEN_ENDED marker line."
)

_CODE_REPAIR_SYSTEM = (
    "You are repairing a reference solution that CRASHED or timed out on the problem "
    "statement's own worked Example inputs. Do NOT change the problem statement. Return "
    "ONLY the corrected full solution source, no markdown fences and no commentary."
)


def _mismatch_side(contract):
    """'code' when the reference did not run, 'description' when it ran and disagreed.

    These look alike from a distance and have opposite fixes. `verify_io_contract` writes
    `got` as `<error>` / `<timeout>` for a failed run and as the real stdout otherwise;
    an unconvertible display block carries its reason in `detail`."""
    for m in contract.get("mismatches") or []:
        blob = f"{m.get('got', '')} {m.get('detail', '')}"
        if "<error>" in blob or "<timeout>" in blob:
            return "code"
    return "description"


def _format_mismatches(contract):
    lines = []
    for m in contract.get("mismatches") or []:
        lines.append(
            f"- example {m.get('example')}:\n"
            f"    stdin           : {m.get('stdin')!r}\n"
            f"    statement claims: {m.get('expected')!r}\n"
            f"    reference printed: {m.get('got')!r}"
            + (f"  ({m.get('detail')!r})" if m.get("detail") else "")
        )
    return "\n".join(lines)


def reconcile_description(problem_name, desc_prompt, problem_content, optimal_path,
                          outputs_dir, scenario_level, llm=None, verifier=None,
                          code_writer=None, max_attempts=MAX_DESCRIPTION_ATTEMPTS):
    """Generate the statement, execute the reference against its own Examples, reconcile.

    The reference solution is an INPUT to this pipeline — it exists before the statement is
    written — so execution decides the example outputs and the model only writes prose.
    That removes a whole class of wrong-worked-example bugs instead of detecting them three
    steps later.

    Returns (description, {"verified", "attempts", "repairs", "reason"}).
    """
    if llm is None:
        llm = call_llm
    if verifier is None:
        from testcase_manager_v4 import verify_io_contract as verifier
    if code_writer is None:
        def code_writer(_key, code):
            with open(optimal_path, 'w', encoding='utf-8') as f:
                f.write(code)

    description = ""
    marker = ""
    repairs = []
    system, user = desc_prompt, problem_content
    for attempt in range(1, max_attempts + 1):
        content, usage = llm(system, user, purpose="chat")
        _track_llm_usage(usage, f"{problem_name}_description")
        content = _strip_scratchpad(content)
        if repairs and repairs[-1] == "code":
            # The model returned SOURCE, not a statement: keep the statement we had.
            code_writer("code", clean_generated_code(strip_code_fence(content), "python"))
        else:
            description = normalize_renderer_safe(content) if scenario_level == "none" else content
            # The repair prompt ASKS for the OPEN_ENDED marker back; a model that forgets
            # it would silently downgrade the problem to "not open-ended" — no checker,
            # no complaint. Carry the last decision forward instead of re-asking for it.
            found = list(OPEN_ENDED_MARKER_RE.finditer(description))
            if found:
                marker = found[-1].group(0)
            elif marker:
                description = f"{description.rstrip()}\n\n{marker}"

        contract = verifier(description, optimal_path, outputs_dir, llm=llm)
        if contract.get("verified"):
            return description, {"verified": True, "attempts": attempt,
                                 "repairs": repairs, "reason": ""}
        if not (contract.get("mismatches") or []):
            # Nothing parseable to reconcile against — not a defect we can repair.
            return description, {"verified": False, "attempts": attempt,
                                 "repairs": repairs,
                                 "reason": contract.get("reason") or "no parseable Examples"}
        if attempt == max_attempts:
            break
        side = _mismatch_side(contract)
        repairs.append(side)
        detail = _format_mismatches(contract)
        if side == "code":
            system = _CODE_REPAIR_SYSTEM
            user = (f"STATEMENT:\n{description}\n\n"
                    f"CURRENT SOLUTION:\n{_read_text(optimal_path)}\n\n"
                    f"It failed on the statement's own Examples:\n{detail}")
        else:
            system = _DESC_REPAIR_SYSTEM
            user = (f"CURRENT STATEMENT:\n{description}\n\n"
                    f"The reference solution disagrees with it:\n{detail}")

    side = repairs[-1] if repairs else "description"
    return description, {"verified": False, "attempts": max_attempts, "repairs": repairs,
                         "reason": f"gave up after {max_attempts} attempts while "
                                   f"repairing the {side}"}


def run_description_step(problem_name, structure_type, scenario_level, problem_content, user_code, detected_lang, question_kind="function"):
    print("\n" + "=" * 60)
    print("STEP: Description Creation")
    print("=" * 60)

    if question_kind == "nonfunction":
        desc_prompt = get_nonfunction_description_prompt(
            problem_name, structure_type, user_code, scenario_level
        )
    else:
        desc_prompt = get_description_prompt(problem_name, structure_type, user_code, scenario_level)

    # A re-described problem invalidates naming, so reset the editable copy back to the raw
    # input FIRST — reconciliation may repair that copy, and the reset would undo it.
    _save_working_code(user_code, detected_lang)
    optimal_path = _working_code_path(detected_lang)

    # Always reconciled: the reference is always Python (see detect_user_solution), so
    # `_run_reference_on_input` can always execute it. The old `else` branch here wrote the
    # statement with a bare LLM call and skipped reconciliation entirely for a C++/Java
    # reference — a path that could never reach generate_testcases anyway.
    desc_response, recon = reconcile_description(
        problem_name, desc_prompt, problem_content, optimal_path,
        OUTPUT_DIR, scenario_level,
    )
    if recon["verified"]:
        print(f"✓ Examples reconciled against the reference "
              f"({recon['attempts']} attempt(s), repairs={recon['repairs'] or 'none'})")
    else:
        print(f"⚠ Examples NOT reconciled — {recon['reason']}. "
              f"verify_io_contract will block at generate_testcases.")

    desc_response, open_ended, open_ended_reason = split_open_ended_marker(desc_response)
    save_problem_flags(open_ended, open_ended_reason, OUTPUT_DIR)
    _save_description(desc_response)
    print(f"✓ open_ended={open_ended}"
          + (f" — {open_ended_reason}" if open_ended_reason else ""))
    print(f"✓ Description created and saved to {_description_path()}")
    print(f"✓ Baseline solution saved to {os.path.relpath(_working_code_path(detected_lang), OUTPUT_DIR)}")


def run_naming_step(problem_name, structure_type, question_kind, user_code, detected_lang):
    print("\n" + "=" * 60)
    print("STEP: Naming Enforcement")
    print("=" * 60)

    if question_kind == "nonfunction":
        print("ℹ Non-function problem — skipping function-signature naming enforcement.")
        # DELETE, don't just skip. description_signature.json is the ONLY signal
        # testcase_manager_v4 uses to decide function vs STDIN/STDOUT, and nothing else
        # ever removes it — so a problem switched function -> nonfunction kept the old
        # file, `is_function` flipped back to True, and the suite was built with
        # function-style raw-stdin cases for a problem the rest of the pipeline treats as
        # a full program.
        stale = _signature_path()
        if os.path.exists(stale):
            os.remove(stale)
            print(f"✓ Removed stale {os.path.relpath(stale, OUTPUT_DIR)} left by an "
                  f"earlier function-mode run.")
        return

    from Prompts.signatureExtractionPrompt import get_signature_extraction_prompt

    desc_response = _load_description()
    if not desc_response.strip():
        print("ERROR: no description available — cannot extract a canonical signature.")
        sys.exit(1)

    sig_prompt = get_signature_extraction_prompt(desc_response)
    sig_response, sig_usage = call_llm(sig_prompt, "", purpose="chat")
    _track_llm_usage(sig_usage, f"{problem_name}_signature")
    description_signature = _parse_signature(sig_response)

    if not description_signature:
        # Never a warning-and-continue. Without description_signature.json,
        # testcase_manager_v4 sets is_function=False and builds a STDIN/STDOUT suite for
        # a function problem; and the rename never runs, so neither static gate below
        # ever sees the code. Both stay invisible until execute_tests scores zero.
        print("ERROR: could not extract a function signature from the description. "
              "The rename and the stdin/checker gates cannot run, and the testcase step "
              "would silently treat this function problem as STDIN/STDOUT.")
        sys.exit(1)

    print(f"Enforcing function name: {description_signature.get('function_name')}")
    open_ended = load_open_ended(OUTPUT_DIR)
    # The WORKING copy, not the raw input: the description step may have REPAIRED this
    # solution (reconcile_description writes corrected source when the reference crashed
    # on the statement's own Examples), and a reviewer may have hand-edited it.
    # Normalizing from Inputs/ throws both away — every other step here already reads
    # the working copy.
    working_code = _load_working_code(detected_lang, user_code)
    refactor_prompt = get_normalization_prompt(
        working_code, detected_lang, description_signature, desc_response, structure_type,
        open_ended=open_ended,
    )
    renamed_code, refactor_usage = call_llm(refactor_prompt, "", purpose="chat")
    _track_llm_usage(refactor_usage, f"{problem_name}_refactor")

    renamed_code = clean_generated_code(strip_code_fence(renamed_code), detected_lang)

    # EVERY problem, not only open-ended ones. A reference that parses the description's
    # `name = value` display form reproduces every stated answer, so it grounds clean,
    # verifies clean and passes every execution-based check — then scores zero against the
    # real driver. Static gate, because execution cannot see it.
    # Unconditional: the reference is always Python (see detect_user_solution). This used
    # to be guarded on the detected language, which meant the guard silently switched
    # itself off for exactly the inputs nobody had tested.
    io_defects = stdin_parsing_defects(renamed_code)
    if io_defects:
        print("ERROR: the normalized reference does not read raw stdin:")
        for d in io_defects:
            print(f"  - {d}")
        sys.exit(1)

    if open_ended:
        # Every defect here is invisible at grading time — fail loudly now instead.
        defects = checker_defects(renamed_code)
        if defects:
            print("ERROR: the emitted open-ended checker is malformed:")
            for d in defects:
                print(f"  - {d}")
            sys.exit(1)

    _save_signature(description_signature)
    _save_working_code(renamed_code, detected_lang)
    print(
        "✓ Given code updated with description naming and normalization "
        f"({os.path.relpath(_working_code_path(detected_lang), OUTPUT_DIR)})"
    )


def run_titles_step(problem_name):
    print("\n" + "=" * 60)
    print("STEP: Generating Titles")
    print("=" * 60)

    owner_title = os.environ.get("PIPELINE_OWNER_TITLE", "").strip()
    generate_with_ai = os.environ.get("PIPELINE_GENERATE_TITLE_WITH_AI", "").strip().lower() in (
        "1", "true", "yes"
    )
    titles_path = os.path.join(OUTPUT_DIR, 'generated_titles.txt')

    if owner_title and not generate_with_ai:
        with open(titles_path, 'w', encoding='utf-8') as f:
            f.write(owner_title + "\n")
        print(f"✓ Using owner-set title (final): {owner_title}")
        return

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_question (description sub-step) first.")
        sys.exit(1)

    title_prompt = get_title_prompt(desc_response)
    title_response, title_usage = call_llm(title_prompt, "", purpose="chat", reasoning_effort="medium")
    _track_llm_usage(title_usage, f"{problem_name}_titles")

    with open(titles_path, 'w', encoding='utf-8') as f:
        f.write(title_response)
    print("✓ Titles generated")


def run_difficulty_step(problem_name):
    print("\n" + "=" * 60)
    print("STEP: Generating Difficulty")
    print("=" * 60)

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_question (description sub-step) first.")
        sys.exit(1)

    diff_path = os.path.join(OUTPUT_DIR, 'generated_difficulty.txt')
    owner_difficulty = os.environ.get("PIPELINE_OWNER_DIFFICULTY", "").strip().lower()
    if owner_difficulty in ("easy", "medium", "hard"):
        with open(diff_path, 'w', encoding='utf-8') as f:
            f.write(owner_difficulty)
        print(f"✓ Using owner-set difficulty (final): {owner_difficulty}")
        return

    diff_prompt = get_difficulty_prompt(desc_response)
    diff_response, diff_usage = call_llm(diff_prompt, "", purpose="chat")
    _track_llm_usage(diff_usage, f"{problem_name}_difficulty")
    with open(diff_path, 'w', encoding='utf-8') as f:
        f.write(diff_response.strip())
    print("✓ Difficulty generated")


def run_topics_step(problem_name, user_code, detected_lang):
    print("\n" + "=" * 60)
    print("STEP: Generating Topics")
    print("=" * 60)

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_question (description sub-step) first.")
        sys.exit(1)

    topics_list_path = os.path.join(INPUT_DIR, 'topics_list.txt')
    if not os.path.exists(topics_list_path):
        print(f"Warning: {topics_list_path} not found. Skipping topic generation.")
        return

    with open(topics_list_path, 'r', encoding='utf-8') as f:
        topics_list_content = f.read()

    working_code = _load_working_code(detected_lang, user_code)
    topics_prompt = get_topics_prompt(desc_response, working_code, topics_list_content)
    topics_response, topics_usage = call_llm(topics_prompt, "", purpose="chat", reasoning_effort="medium")
    _track_llm_usage(topics_usage, f"{problem_name}_topics")

    topics_out_path = os.path.join(OUTPUT_DIR, 'generated_topics.json')
    try:
        topic_data = json.loads(strip_code_fence(topics_response))
    except ValueError as e:
        # The LLM call was made and paid for. Warning-and-continue left the step GREEN
        # with no generated_topics.json at all, so the omission only surfaced at packaging.
        print(f"ERROR: could not parse the generated topics JSON — {e}")
        print(f"Raw response:\n{topics_response[:2000]}")
        sys.exit(1)
    with open(topics_out_path, 'w', encoding='utf-8') as f:
        json.dump(topic_data, f, indent=4)
    print(f"✓ Topics generated and saved to {topics_out_path}")


def run_translate_step(problem_name, structure_type, user_code, detected_lang, selected_langs):
    print("\n" + "=" * 60)
    print("STEP: Converting to Other Languages")
    print("=" * 60)

    desc_response = _load_description()
    if not desc_response.strip():
        print("Error: no description found. Run generate_question (description sub-step) first.")
        sys.exit(1)

    working_code = _load_working_code(detected_lang, user_code)
    description_signature = _load_signature()
    user_lang_key = LANG_MAP.get(detected_lang.lower(), 'python_code')
    selected_keys = {LANG_ID_TO_KEY.get(l, '') for l in selected_langs}

    _save_working_code(working_code, detected_lang)

    for key, lang in TARGET_LANGS.items():
        if key == user_lang_key:
            continue
        if key not in selected_keys:
            print(f"  ⏭ Skipping {lang} (not selected)")
            continue
        print(f"  - Converting to {lang}...")
        conv_prompt = get_conversion_prompt(
            lang, working_code, structure_type, description_signature, desc_response
        )
        conv_response, conv_usage = call_llm(conv_prompt, "", purpose="code")
        _track_llm_usage(conv_usage, f"{problem_name}_convert_{lang}", purpose="code")

        clean_code = clean_generated_code(strip_code_fence(conv_response), lang)
        _save_solution_file(key, clean_code)

    print(f"✓ Solutions saved to {_generated_full_code_dir()}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate question content (one operation per invocation)")
    parser.add_argument(
        "--steps",
        required=True,
        help="Operation to run: description, naming, titles, difficulty, topics, codes",
    )
    parser.add_argument(
        "--langs",
        default="python,cpp,java,nodejs",
        help="Comma-separated languages for code translation: python,cpp,java,nodejs",
    )
    args = parser.parse_args()
    selected_steps = {s.strip() for s in args.steps.split(",") if s.strip()}
    selected_langs = [l.strip().lower() for l in args.langs.split(",")]

    print("=" * 60)
    print("CODE-CENTRIC QUESTION GENERATOR")
    print("=" * 60)
    print(f"Selected steps: {sorted(selected_steps)}")
    if "codes" in selected_steps:
        print(f"Selected languages: {selected_langs}")

    problem_path = os.path.join(INPUT_DIR, 'problem.md')
    problem_name, structure_type, question_kind, scenario_level, problem_content = parse_problem_md(problem_path)

    solution_path, detected_lang = detect_user_solution()
    print(f"\n📋 Problem: {problem_name} ({structure_type}, {question_kind})")
    print(f"🎭 Scenario Level: {scenario_level}")
    print(f"💻 User Code: {os.path.basename(solution_path)} ({detected_lang})")

    with open(solution_path, 'r', encoding='utf-8') as f:
        user_code = f.read()

    _seed_working_code(user_code, detected_lang)

    if "description" in selected_steps:
        run_description_step(
            problem_name, structure_type, scenario_level, problem_content, user_code, detected_lang, question_kind
        )

    if "naming" in selected_steps:
        run_naming_step(problem_name, structure_type, question_kind, user_code, detected_lang)

    if "titles" in selected_steps:
        run_titles_step(problem_name)

    if "difficulty" in selected_steps:
        run_difficulty_step(problem_name)

    if "topics" in selected_steps:
        pipeline_mode = os.environ.get("PIPELINE_MODE", "practice").strip().lower()
        if pipeline_mode == "exam":
            print("ℹ Exam mode — skipping topics generation.")
        else:
            run_topics_step(problem_name, user_code, detected_lang)

    if "codes" in selected_steps:
        run_translate_step(problem_name, structure_type, user_code, detected_lang, selected_langs)

    print("\n" + "=" * 60)
    print("✅ SUCCESS! Step completed.")
    print("=" * 60)


if __name__ == "__main__":
    main()
