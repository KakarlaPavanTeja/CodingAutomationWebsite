#!/usr/bin/env python3
"""Create exam coding_questions.json from a LUA file and testcases JSON."""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import prepare_platform_json as ppj  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="LUA + testcases JSON -> exam coding_questions.json")
    parser.add_argument("--lua", required=True, help="Path to exam .lua file")
    parser.add_argument("--testcases", required=True, help="Path to testcases .json file")
    parser.add_argument("-o", "--output", default="coding_questions.json", help="Output JSON path")
    args = parser.parse_args()

    with open(args.lua, encoding="utf-8") as f:
        lua = f.read()

    container = ppj.load_testcases(args.testcases)
    difficulty = ppj.parse_difficulty(lua)
    json_data = ppj.build_exam_json(lua, container, difficulty)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=4, ensure_ascii=False)

    print(f"Wrote {args.output}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
