import re

def strip_comments_from_code(code, language):
    """
    Removes comments from code based on language.
    Handles single-line and multi-line comments.
    """
    language = language.lower()
    
    if language in ['python']:
        # Remove Python comments (# ...)
        # Keep strings intact
        lines = code.split('\n')
        cleaned_lines = []
        for line in lines:
            # Skip lines that are only comments
            stripped = line.lstrip()
            if stripped.startswith('#'):
                continue
            # Remove inline comments (but preserve # in strings)
            # Simple approach: remove # and everything after if not in quotes
            if '#' in line:
                # Check if # is inside a string
                in_string = False
                quote_char = None
                for i, char in enumerate(line):
                    if char in ['"', "'"] and (i == 0 or line[i-1] != '\\'):
                        if not in_string:
                            in_string = True
                            quote_char = char
                        elif char == quote_char:
                            in_string = False
                    elif char == '#' and not in_string:
                        line = line[:i].rstrip()
                        break
            cleaned_lines.append(line)
        return '\n'.join(cleaned_lines)
    
    elif language in ['c++', 'cpp', 'java', 'javascript', 'node.js', 'nodejs', 'js']:
        # Remove C-style comments (// ... and /* ... */)
        # Remove single-line comments
        code = re.sub(r'//.*?$', '', code, flags=re.MULTILINE)
        # Remove multi-line comments
        code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
        # Remove empty lines created by comment removal
        lines = [line for line in code.split('\n') if line.strip()]
        return '\n'.join(lines)
    
    return code

def clean_generated_code(code, language):
    """
    Main cleaning function for generated code.
    - Strips comments
    - Removes excessive blank lines
    """
    # Strip comments
    code = strip_comments_from_code(code, language)
    
    # Remove excessive blank lines (more than 1 consecutive)
    code = re.sub(r'\n\s*\n\s*\n+', '\n\n', code)
    
    # Trim trailing whitespace from each line
    lines = [line.rstrip() for line in code.split('\n')]
    code = '\n'.join(lines)
    
    return code.strip()
