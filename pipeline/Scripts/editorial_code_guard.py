"""A function-based editorial must ship its `main()` driver COMMENTED OUT.

The editorial prompt says so in three separate places and the model still leaves a
live `main()` behind on some runs, so the reviewer has to re-run the whole editorial
with a change request to get it back. This is the deterministic pass that makes the
prompt rule true: when the problem is function-based (driver code exists), wrap the
trailing driver of every editorial code fence in a comment.

`editorial_execution_manager._uncomment_main` is the exact inverse — it unwraps the
same trailing block so a NON-function editorial runs standalone.
"""

import re

_MULTILANG_RE = re.compile(
    r"<MultiLanguageCodeBlock>(.*?)</MultiLanguageCodeBlock>", re.DOTALL
)
# Groups: (opening fence line, tag, body, closing fence)
_FENCE_RE = re.compile(r"(```([A-Za-z0-9+#]*)[ \t]*\n)(.*?)(```)", re.DOTALL)

_FENCE_LANG = {
    "cpp": "cpp", "c++": "cpp",
    "python": "python", "py": "python",
    "java": "java",
    "js": "js", "javascript": "js", "nodejs": "js", "node": "js",
}

# Where the trailing driver starts. The templates always put it LAST, after the
# solution class — so the driver is "this line to the end of the fence".
# ponytail: positional, not a parser. A fence with the driver ABOVE the solution
# class is left alone (see comment_out_driver); parse for real only if that shows up.
_DRIVER_START = {
    "cpp": re.compile(r"^[ \t]*(?:int|void)[ \t]+main[ \t]*\(", re.M),
    "java": re.compile(
        r"^[ \t]*(?:public[ \t]+)?class[ \t]+Main\b"
        r"|^[ \t]*public[ \t]+static[ \t]+void[ \t]+main[ \t]*\(",
        re.M,
    ),
    "js": re.compile(
        r"^[ \t]*(?:async[ \t]+)?function[ \t]+main[ \t]*\("
        r"|^[ \t]*(?:const|let|var)[ \t]+main[ \t]*=",
        re.M,
    ),
}

# Python and JavaScript can also put the driver at MODULE LEVEL, with no `main` at all —
# the JS editorial that prompted this shipped a live
# `const fs = require("fs"); ... console.log(result)` after the class, which the `main`
# patterns above cannot see. C++ and Java have no such shape: a driver there IS a main.
#   decl:       starts a top-level declaration (the solution) — the driver comes after
#               the LAST one, so a constant ABOVE the class is never mistaken for it
#   not_driver: a top-level line that is still part of the solution's scaffolding
#   stdin:      the driver must actually read input (or call main), or it is not a driver
_MODULE_LEVEL = {
    "python": {
        "decl": re.compile(r"^(?:class|def|async[ \t]+def)\b"),
        "not_driver": re.compile(r"^(?:import|from|class|def|async[ \t]+def|@|#)"),
        "stdin": re.compile(r"\binput[ \t]*\(|\bsys\.stdin|\breadline[ \t]*\("),
    },
    "js": {
        "decl": re.compile(r"^(?:export[ \t]+)?(?:class|(?:async[ \t]+)?function)\b"),
        "not_driver": re.compile(r"^(?:import|export|class|(?:async[ \t]+)?function"
                                 r"|[});\]]|//|/\*|\*)"),
        "stdin": re.compile(r"\breadFileSync\b|\bprocess\.stdin\b|\bcreateInterface\b"
                           r"|\bmain[ \t]*\([ \t]*\)"),
    },
}


def _comment_spans(code, lang):
    """Spans already inside a block comment (or, in Python, a triple-quoted string)."""
    spans = []
    if lang == "python":
        for quote in ("'''", '"""'):
            i = 0
            while True:
                a = code.find(quote, i)
                if a == -1:
                    break
                b = code.find(quote, a + len(quote))
                if b == -1:
                    break
                spans.append((a, b + len(quote)))
                i = b + len(quote)
    else:
        i = 0
        while True:
            a = code.find("/*", i)
            if a == -1:
                break
            b = code.find("*/", a + 2)
            if b == -1:
                break
            spans.append((a, b + 2))
            i = b + 2
        spans.extend(m.span() for m in re.finditer(r"//[^\n]*", code))
    return spans


def _in_comment(pos, spans):
    return any(a <= pos < b for a, b in spans)


def _line_start(code, pos):
    nl = code.rfind("\n", 0, pos)
    return 0 if nl == -1 else nl + 1


def _module_level_driver_start(code, spans, lang):
    """Offset of the trailing module-level driver, or None.

    Only statements that come AFTER the last top-level declaration AND read stdin
    count — otherwise a module-level constant above the solution class
    (`MOD = 10 ** 9 + 7`, `const fs = require("fs")`) would swallow the whole
    solution into a comment.
    """
    rules = _MODULE_LEVEL[lang]
    lines = code.split("\n")
    offsets, pos = [], 0
    for line in lines:
        offsets.append(pos)
        pos += len(line) + 1

    last_def = -1
    for i, line in enumerate(lines):
        if line[:1].isspace() or not line.strip():
            continue
        if rules["decl"].match(line) and not _in_comment(offsets[i], spans):
            last_def = i
    if last_def == -1:
        return None

    for i in range(last_def + 1, len(lines)):
        line = lines[i]
        if not line.strip() or line[:1].isspace():
            continue
        if rules["not_driver"].match(line):
            continue
        if _in_comment(offsets[i], spans):
            continue
        return offsets[i] if rules["stdin"].search(code[offsets[i]:]) else None
    return None


def comment_out_driver(code, lang):
    """Comment out a live trailing `main()`/driver. Returns (code, changed)."""
    spans = _comment_spans(code, lang)

    start = None
    if lang in _DRIVER_START:
        for m in _DRIVER_START[lang].finditer(code):
            if not _in_comment(m.start(), spans):
                start = _line_start(code, m.start())
                break
    # A `main` declaration wins: it opens the whole driver, and the module-level rule
    # would otherwise skip past its body and wrap only the trailing `main();`.
    if start is None and lang in _MODULE_LEVEL:
        start = _module_level_driver_start(code, spans, lang)
    if start is None:
        return code, False

    head, tail = code[:start], code[start:]
    body = tail.rstrip()
    trailing = tail[len(body):] or "\n"
    open_, close = ("'''", "'''") if lang == "python" else ("/*", "*/")
    return f"{head}{open_}\n{body}\n{close}{trailing}", True


def comment_out_editorial_drivers(md):
    """Comment out every live driver in the editorial's code fences.

    Returns (markdown, number of fences changed). Only fences inside a
    <MultiLanguageCodeBlock> are touched — pseudocode blocks are left alone.
    """
    fixed = 0

    def fix_fence(m):
        nonlocal fixed
        lang = _FENCE_LANG.get((m.group(2) or "").strip().lower())
        if not lang:
            return m.group(0)
        code, changed = comment_out_driver(m.group(3), lang)
        fixed += 1 if changed else 0
        return f"{m.group(1)}{code}{m.group(4)}"

    def fix_block(m):
        return "<MultiLanguageCodeBlock>{}</MultiLanguageCodeBlock>".format(
            _FENCE_RE.sub(fix_fence, m.group(1))
        )

    return _MULTILANG_RE.sub(fix_block, md), fixed
