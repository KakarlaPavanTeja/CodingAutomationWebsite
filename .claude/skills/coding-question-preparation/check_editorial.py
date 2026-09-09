#!/usr/bin/env python3
"""Audit an editorial.md against Prompts/editorialPrompt.py before you execute it.

Every rule here was broken in a real session and cost a rewrite. Run it as the last
thing before editorial_execution_manager.py:

    /usr/bin/python3 check_editorial.py <run>/Outputs/editorial.md
"""
import re
import sys

SUBS = ["### Intuition", "### Approach", "### Pseudocode",
        "### Code Implementation", "### Complexity Analysis"]


def section(md, name):
    m = re.search(rf"### {name}\n(.*?)(?=\n### |\Z)", md, re.S)
    return m.group(1) if m else ""


def check(path):
    md = open(path, encoding="utf-8").read()
    bad = []

    heads = re.findall(r"^(#{1,3} .+)$", md, re.M)
    if not heads or not heads[0].startswith("# "):
        bad.append("missing the '# [Problem Name]' H1 (must be the first heading)")
    solutions = [h for h in heads if h.startswith("## ")]
    if not solutions:
        bad.append("no '## [Approach Name]' heading")
    for h in solutions:
        block = md.split(h, 1)[1].split("\n## ")[0]
        got = [s for s in SUBS if s in block]
        if got != SUBS:
            bad.append(f"{h.strip()}: subsections {got} — must be exactly {SUBS} in order")

    for name in ("Intuition", "Approach"):
        body = section(md, name)
        if not body.strip():
            bad.append(f"{name}: empty")
            continue
        if "`" in body:
            bad.append(f"{name}: contains backticks (plain English only)")
        if re.search(r"^\s*\d+\.\s", body, re.M):
            bad.append(f"{name}: numbered list (bullets only)")
        bullets = [l for l in body.split("\n") if l.startswith("- ")]
        if not bullets:
            bad.append(f"{name}: no bullet points")
        for b in bullets:
            if len(b) > 260:
                bad.append(f"{name}: paragraph-length bullet — {b[:60]}...")
        if re.search(r"\bthrow\b|std::|\w+\(\)|\bfor\s*\(|\bif\s*\(", body):
            bad.append(f"{name}: code token / syntax (plain English only)")
    n = len([l for l in section(md, "Approach").split("\n") if l.startswith("- ")])
    if n and not 3 <= n <= 6:
        bad.append(f"Approach: {n} bullets (easy 3-4, medium 4-5, hard 5-6)")

    for ps in re.findall(r"```pseudocode\n(.*?)```", md, re.S):
        code = re.sub(r"/\*.*?\*/", "", ps, flags=re.S)     # ignore comment prose
        if "//" in ps:
            bad.append("pseudocode: '//' comment — use /* ... */ only")
        if "/*" not in ps:
            bad.append("pseudocode: no comments (needs ~1:1 comment-to-code)")
        if ";" in code:
            bad.append("pseudocode: semicolon in a statement")
        if not re.search(r"^\s*\w+\(.*\)\s*\{", ps, re.M):
            bad.append("pseudocode: not C-like 'name(params) {' brace form")
        if re.search(r"\b(int|long|float|double|string|bool|vector|void)\s+\w", code):
            bad.append("pseudocode: data types (omit them)")
    for tag in re.findall(r"<CodeBlock[^>]*>", md):
        if tag != "<CodeBlock language={customtext} showNumberOfLines={15} fontStyle={Normal Code}>":
            bad.append(f"pseudocode: wrong CodeBlock tag — {tag}")

    for block in re.findall(r"<MultiLanguageCodeBlock[^>]*>(.*?)</MultiLanguageCodeBlock>", md, re.S):
        head = block.split("/*", 1)[0]                       # before the commented-out main
        if re.search(r"^\s*//", head, re.M) or re.search(r"\S\s+//", head):
            bad.append("Code Implementation: contains comments (owner preference: none)")
    for tag in re.findall(r"<MultiLanguageCodeBlock[^>]*>", md):
        if "enableMoveCode" not in tag:
            bad.append("MultiLanguageCodeBlock missing enableMoveCode={true} — run ensure_move_code")

    cx = section(md, "Complexity Analysis")
    if not re.search(r"^\* \*\*Time Complexity", cx, re.M):
        bad.append("Complexity: Time not '* **Time Complexity: `O(...)`**'")
    if not re.search(r"^\* \*\*Space Complexity", cx, re.M):
        bad.append("Complexity: Space not '* **Space Complexity: `O(...)`**'")
    if len(re.findall(r"^  \* ", cx, re.M)) < 4:
        bad.append("Complexity: needs 2-3 '  * ' sub-bullets under each heading")

    tail = md.rstrip().split("### Complexity Analysis")[-1]
    if re.search(r"^#{1,3} |^\*\*[A-Z]", tail, re.M):
        bad.append("content after Complexity Analysis (it must be the last section)")
    if re.search(r"^(---|\*\*\*|___)\s*$", md, re.M):
        bad.append("horizontal rule (renderer cannot show it)")
    if "|---" in md:
        bad.append("markdown table (renderer cannot show it)")
    stray = [f for f in re.findall(r"^```(\w*)", md, re.M)
             if f not in ("pseudocode", "cpp", "python", "java", "js", "")]
    if stray:
        bad.append(f"stray code fences: {stray}")

    print(f"{path}: {'PASS — every editorial rule satisfied' if not bad else 'FAIL'}")
    for b in bad:
        print(f"  ✗ {b}")
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: check_editorial.py <editorial.md> [...]")
    sys.exit(max(check(p) for p in sys.argv[1:]))
