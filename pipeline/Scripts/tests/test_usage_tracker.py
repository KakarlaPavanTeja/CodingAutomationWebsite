"""The local usage_tracker.json is a *fallback*, not a mirror.

Writing it on every LLM call meant a full read-modify-rewrite of the whole file
under an exclusive flock per call, serialising concurrent pipeline steps, even
when the row was already safely in the DB.
"""

import os
import sys
import types
import unittest
from unittest import mock

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, SCRIPT_DIR)

# usage_tracker imports `requests` at module level purely for the remote insert,
# which these tests stub out; keep the import working without the dependency.
sys.modules.setdefault("requests", types.ModuleType("requests"))

import usage_tracker  # noqa: E402


class TestLocalWriteIsFallbackOnly(unittest.TestCase):
    def _run(self, remote_ok: bool):
        with mock.patch.object(usage_tracker, "_insert_remote", return_value=remote_ok), \
                mock.patch.object(usage_tracker, "_append_local") as append_local:
            usage_tracker.update_usage(10, 5, "two_sum", model="m", purpose="chat", cost=0.01)
        return append_local

    def test_no_local_write_when_db_insert_succeeds(self):
        self.assertEqual(self._run(True).call_count, 0)

    def test_local_write_when_db_insert_fails(self):
        self.assertEqual(self._run(False).call_count, 1)


if __name__ == "__main__":
    unittest.main()
