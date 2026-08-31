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
                mock.patch.object(usage_tracker, "_spool"), \
                mock.patch.object(usage_tracker, "_append_local") as append_local:
            usage_tracker.update_usage(10, 5, "two_sum", model="m", purpose="chat", cost=0.01)
        return append_local

    def test_no_local_write_when_db_insert_succeeds(self):
        self.assertEqual(self._run(True).call_count, 0)

    def test_local_write_when_db_insert_fails(self):
        self.assertEqual(self._run(False).call_count, 1)


class TestRefusedRowsAreSpooled(unittest.TestCase):
    """A row the DB refuses must survive somewhere replayable.

    It previously went only into usage_tracker.json, whose history is capped at
    500 entries and rewritten in place — so spend fell off the end and never
    reached `llm_usage`. The spool is append-only and uncapped.
    """

    def _run(self, remote_ok: bool):
        with mock.patch.object(usage_tracker, "_insert_remote", return_value=remote_ok), \
                mock.patch.object(usage_tracker, "_append_local"), \
                mock.patch.object(usage_tracker, "_spool") as spool:
            row = usage_tracker.update_usage(
                10, 5, "two_sum", model="m", purpose="chat", cost=0.01
            )
        return spool, row

    def test_refused_row_is_spooled(self):
        spool, row = self._run(False)
        self.assertEqual(spool.call_count, 1)
        self.assertEqual(spool.call_args[0][0]["id"], row["id"])

    def test_accepted_row_is_not_spooled(self):
        self.assertEqual(self._run(True)[0].call_count, 0)

    def test_row_carries_an_id_so_a_replay_cannot_double_bill(self):
        _, row = self._run(False)
        self.assertRegex(row["id"], r"^[0-9a-f-]{36}$")

    def test_spool_round_trips_through_the_atomic_writer(self):
        import json
        import tempfile

        rows = [{"id": "a", "cost_usd": 0.5}, {"id": "b", "cost_usd": 0.25}]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage_spool.jsonl")
            usage_tracker._write_lines_atomic(path, [json.dumps(r) for r in rows])
            with open(path) as f:
                back = [json.loads(line) for line in f if line.strip()]
        self.assertEqual(back, rows)

    def test_rewriting_the_spool_empty_leaves_no_rows(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage_spool.jsonl")
            usage_tracker._write_lines_atomic(path, ['{"id": "a"}'])
            usage_tracker._write_lines_atomic(path, [])
            with open(path) as f:
                self.assertEqual(f.read().strip(), "")

    def test_nothing_is_spooled_when_no_internal_api_is_configured(self):
        """Otherwise a test or bare local run leaves fabricated spend on disk
        for replay_usage_spool.py to insert into the real llm_usage table."""
        import tempfile

        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(usage_tracker, "OUTPUT_DIR", d), \
                mock.patch.object(
                    usage_tracker, "USAGE_SPOOL_FILE", os.path.join(d, "usage_spool.jsonl")
                ), \
                mock.patch.object(usage_tracker, "_INTERNAL_API_URL", ""), \
                mock.patch.object(usage_tracker, "_INTERNAL_API_SECRET", ""):
            usage_tracker._spool({"id": "a", "cost_usd": 0.01})
            self.assertEqual(os.listdir(d), [])


class TestKeyFingerprint(unittest.TestCase):
    """The server attributes spend to an account from this digest.

    Sending nothing (the old behaviour) made it re-derive the account from a UI
    toggle, which mislabelled about $37 of August spend as the wrong key.
    """

    def test_fingerprint_is_a_short_hex_digest_of_the_configured_key(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-or-v1-fake"}):
            fp = usage_tracker._key_fingerprint()
        self.assertRegex(fp, r"^[0-9a-f]{12}$")

    def test_fingerprint_is_not_a_slice_of_the_key(self):
        key = "sk-or-v1-fake"
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": key}):
            self.assertNotIn(usage_tracker._key_fingerprint(), key)

    def test_different_keys_get_different_fingerprints(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "key-one"}):
            one = usage_tracker._key_fingerprint()
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "key-two"}):
            self.assertNotEqual(one, usage_tracker._key_fingerprint())

    def test_no_key_configured_yields_none_rather_than_a_digest_of_empty(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}):
            self.assertIsNone(usage_tracker._key_fingerprint())

    def test_posted_row_carries_the_fingerprint(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-or-v1-fake"}), \
                mock.patch.object(usage_tracker, "_insert_remote", return_value=True) as insert:
            usage_tracker.update_usage(1, 1, "two_sum", model="m", purpose="chat", cost=0.0)
        self.assertRegex(insert.call_args[0][0]["key_fp"], r"^[0-9a-f]{12}$")


if __name__ == "__main__":
    unittest.main()
