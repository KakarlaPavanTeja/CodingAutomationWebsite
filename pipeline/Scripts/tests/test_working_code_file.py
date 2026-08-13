"""The reference solution must live in exactly ONE Outputs file.

Naming used to write the renamed code to both `Outputs/normalized_source.py` and
`Outputs/generatedFullCode/PYTHON.py`, so editing one by hand silently had no
effect on whichever step read the other. These tests pin the single-file
contract: seed, naming's rewrite, and the topics/codes read all resolve to the
same path, and the seed never clobbers a rename or a manual edit.

generate_full_question imports LLM prompt/client modules at load time (prod deps
not present in every test env), so we stub them and skip cleanly if the import
still fails (mirrors test_grounding.py).
"""

import os
import sys
import tempfile
import types
import unittest


class _Auto(types.ModuleType):
    def __getattr__(self, name):
        return type(name, (), {"__init__": lambda self, *a, **k: None})


_BASE = tempfile.TemporaryDirectory()


def _import_gfq():
    for dep in ("httpx", "openai", "anthropic", "requests", "tiktoken", "dotenv"):
        sys.modules.setdefault(dep, _Auto(dep))
    # Resolved at import time into BASE_DIR/OUTPUT_DIR.
    os.environ["PIPELINE_BASE_DIR"] = _BASE.name
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        import generate_full_question  # noqa: E402
        return generate_full_question
    except Exception:
        return None


_gfq = _import_gfq()

_RAW = "def two_sum(nums, target):\n    return []\n"
_RENAMED = "def twoSum(nums, target):\n    return []\n"


@unittest.skipIf(_gfq is None, "generate_full_question deps unavailable in this env")
class WorkingCodeFileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved_output_dir = _gfq.OUTPUT_DIR
        _gfq.OUTPUT_DIR = self.tmp.name

    def tearDown(self):
        _gfq.OUTPUT_DIR = self._saved_output_dir
        self.tmp.cleanup()

    def test_python_input_resolves_to_generated_full_code(self):
        path = _gfq._working_code_path("python")
        self.assertEqual(
            os.path.relpath(path, self.tmp.name),
            os.path.join("generatedFullCode", "PYTHON.py"),
        )

    def test_seed_then_rename_updates_the_same_file(self):
        _gfq._seed_working_code(_RAW, "python")
        self.assertEqual(_gfq._load_working_code("python", "FALLBACK"), _RAW)

        # Naming rewrites in place; topics/codes read the rename back.
        _gfq._save_working_code(_RENAMED, "python")
        self.assertEqual(_gfq._load_working_code("python", "FALLBACK"), _RENAMED)

        # ...and no second copy was left behind for an editor to miss.
        strays = [
            n for n in os.listdir(self.tmp.name)
            if n.startswith("normalized_source")
        ]
        self.assertEqual(strays, [])

    def test_seed_never_clobbers_an_existing_edit(self):
        _gfq._save_working_code(_RENAMED, "python")
        _gfq._seed_working_code(_RAW, "python")
        self.assertEqual(_gfq._load_working_code("python", "FALLBACK"), _RENAMED)

    def test_load_falls_back_when_nothing_written_yet(self):
        self.assertEqual(_gfq._load_working_code("python", _RAW), _RAW)

    def test_non_python_input_uses_its_own_language_file(self):
        self.assertEqual(
            os.path.relpath(_gfq._working_code_path("c++"), self.tmp.name),
            os.path.join("generatedFullCode", "CPP.cpp"),
        )


if __name__ == "__main__":
    unittest.main()
