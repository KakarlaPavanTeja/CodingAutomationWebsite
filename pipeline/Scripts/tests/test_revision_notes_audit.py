"""Revision notes safety check: deterministic checks, the independent review's
reply parsing, the outcome status, the automatic repair round, and the
Verify step. LLM calls are stubbed."""

import copy
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import revision_notes_audit as audit
import revision_notes_manager as rn
from tests.test_revision_notes import EDITORIAL, notes as llm_reply

SOLS = rn.split_solutions(EDITORIAL)
IDS = rn.editorial_identifiers(EDITORIAL)
TITLE = "Union of Two Sorted Arrays"


def saved_notes():
    """Notes exactly as the generator would save them."""
    result, errors, soft = rn.validate_notes(llm_reply(), SOLS, IDS)
    assert not errors and not soft, (errors, soft)
    return result


def failing(checks):
    return {c["id"]: c["details"] for c in checks if not c["ok"]}


def usage(model="fake-reviewer"):
    return {"prompt_tokens": 1, "completion_tokens": 1, "model": model, "cost": 0.0}


class DeterministicChecks(unittest.TestCase):
    def test_clean_notes_pass_every_check(self):
        checks = audit.deterministic_checks(saved_notes(), SOLS, IDS, TITLE)
        self.assertEqual(failing(checks), {})
        self.assertGreaterEqual(len(checks), 12)

    def test_edited_complexity_name_and_label_are_errors(self):
        n = saved_notes()
        n["approaches"][1].update(tc="O(N)", name="Merge", label="Better")
        bad = failing(audit.deterministic_checks(n, SOLS, IDS, TITLE))
        self.assertIn("complexity", bad)
        self.assertIn("names", bad)
        self.assertIn("labels", bad)

    def test_edited_steps_with_new_names_are_an_error(self):
        n = saved_notes()
        n["approaches"][1]["steps"] = ["Create ans", "ans.push(x) for each x", "Return ans"]
        bad = failing(audit.deterministic_checks(n, SOLS, IDS, TITLE))
        self.assertIn("steps", bad)
        self.assertIn("ans", bad["steps"][0])

    def test_too_many_steps_is_a_fit_warning(self):
        n = saved_notes()
        n["approaches"][1]["steps"] = ["Return result"] * 8
        checks = audit.deterministic_checks(n, SOLS, IDS, TITLE)
        fit = next(c for c in checks if c["id"] == "fit")
        self.assertFalse(fit["ok"])
        self.assertEqual(fit["level"], "warning")

    def test_missing_note_or_reorder_is_an_error(self):
        n = saved_notes()
        n["approaches"] = n["approaches"][:1]
        self.assertIn("solutions", failing(audit.deterministic_checks(n, SOLS, IDS, TITLE)))

    def test_dry_run_must_trace_the_last_solution_and_match_the_example(self):
        n = saved_notes()
        n["dryRun"]["approach"] = "Brute"
        n["dryRun"]["result"] = "[1, 2]"
        details = failing(audit.deterministic_checks(n, SOLS, IDS, TITLE))["dry_run"]
        self.assertTrue(any("not the last solution" in d for d in details))
        self.assertTrue(any("example's output" in d for d in details))

    def test_dry_run_columns_checked_against_the_traced_solution(self):
        n = saved_notes()
        n["dryRun"]["columns"] = ["st", "x", "result"]  # st belongs to solution 1
        self.assertIn("dry_run_columns", failing(audit.deterministic_checks(n, SOLS, IDS, TITLE)))

    def test_empty_section_is_an_error(self):
        n = saved_notes()
        n["approaches"][0]["takeaway"] = ""
        self.assertIn("required", failing(audit.deterministic_checks(n, SOLS, IDS, TITLE)))

    def test_title_mismatch_is_a_warning(self):
        checks = audit.deterministic_checks(saved_notes(), SOLS, IDS, "Another Title")
        title = next(c for c in checks if c["id"] == "title")
        self.assertFalse(title["ok"])
        self.assertEqual(title["level"], "warning")


class ReviewReply(unittest.TestCase):
    def test_parses_and_normalises(self):
        issues = audit.parse_audit_reply(json.dumps({"issues": [
            {"path": "dryRun.rows[2]", "severity": "ERROR", "problem": "x should be 3", "fix": "3"},
            {"path": "edgeCases[0]", "severity": "odd", "problem": "vague"},
            {"path": "x", "severity": "error", "problem": ""},  # no problem text: dropped
        ]}))
        self.assertEqual([i["severity"] for i in issues], ["error", "warning"])
        self.assertEqual(issues[0]["path"], "dryRun.rows[2]")

    def test_rejects_reply_without_issues(self):
        with self.assertRaises(ValueError):
            audit.parse_audit_reply('{"ok": true}')


class Outcome(unittest.TestCase):
    def test_status(self):
        ok = [{"ok": True, "level": "error"}]
        warn = [{"ok": False, "level": "warning"}]
        err = [{"ok": False, "level": "error"}]
        self.assertEqual(audit.audit_status(ok, []), "passed")
        self.assertEqual(audit.audit_status(warn, []), "passed_with_warnings")
        self.assertEqual(audit.audit_status(ok, [{"severity": "warning"}]), "passed_with_warnings")
        self.assertEqual(audit.audit_status(err, []), "needs_review")
        self.assertEqual(audit.audit_status(ok, [{"severity": "error"}]), "needs_review")

    def test_unavailable_reviewer_means_needs_review_not_verified(self):
        with mock.patch.object(audit, "call_llm", side_effect=RuntimeError("503")):
            result = audit.run_audit(saved_notes(), SOLS, IDS, TITLE, "", EDITORIAL, "x")
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["model"], "unavailable")

    def test_reviewer_sees_notes_without_the_old_audit(self):
        n = saved_notes()
        n["audit"] = {"status": "passed"}
        seen = {}

        def fake(system, user, **kw):
            seen["user"] = user
            return '{"issues": []}', usage()

        with mock.patch.object(audit, "call_llm", fake), mock.patch.object(audit, "track_usage"):
            result = audit.run_audit(n, SOLS, IDS, TITLE, "", EDITORIAL, "x")
        self.assertEqual(result["status"], "passed")
        self.assertNotIn('"audit"', seen["user"])


class Pipeline(unittest.TestCase):
    """generate_revision_notes and verify_revision_notes on a temp workspace."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.makedirs(os.path.join(self.tmp.name, "Outputs"))
        with open(os.path.join(self.tmp.name, "Outputs", "editorial.md"), "w") as f:
            f.write(EDITORIAL)
        self.env = mock.patch.dict(os.environ, {"PIPELINE_BASE_DIR": self.tmp.name, "PIPELINE_OWNER_TITLE": TITLE})
        self.env.start()
        self.patches = [
            mock.patch.object(rn, "track_usage"),
            mock.patch.object(audit, "track_usage"),
            # Per-note steps check: faithful unless a test says otherwise.
            mock.patch.object(rn, "check_steps_faithful", return_value=[]),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.env.stop()
        self.tmp.cleanup()

    def saved(self):
        with open(os.path.join(self.tmp.name, "Outputs", rn.OUTPUT_NAME)) as f:
            return json.load(f)

    def test_review_error_triggers_one_repair_and_the_fix_is_kept(self):
        wrong = llm_reply()
        wrong["approaches"][1]["whyBetter"] = "It uses a hash map."  # wrong, per the editorial
        fixed = llm_reply()
        gen_replies = [json.dumps(wrong), json.dumps(fixed)]
        reviews = [
            json.dumps({"issues": [{"path": "approaches[1].whyBetter", "severity": "error",
                                    "problem": "The editorial uses two pointers, not a hash map.",
                                    "fix": "The set re-sorts sorted data; one merge pass does it."}]}),
            '{"issues": []}',
        ]
        gen_prompts = []

        def gen(system, user, **kw):
            gen_prompts.append(user)
            return gen_replies.pop(0), usage("fake-generator")

        with mock.patch.object(rn, "call_llm", gen), \
             mock.patch.object(audit, "call_llm", lambda s, u, **k: (reviews.pop(0), usage())):
            self.assertEqual(rn.generate_revision_notes(), 0)

        out = self.saved()
        self.assertEqual(out["audit"]["status"], "passed")
        self.assertEqual(out["audit"]["repairs"], 1)
        self.assertEqual(out["approaches"][1]["whyBetter"], fixed["approaches"][1]["whyBetter"])
        self.assertIn("not a hash map", gen_prompts[1], "the repair prompt carries the reviewer's finding")

    def test_repair_keeps_checked_steps_unless_the_review_flagged_it(self):
        first = llm_reply()
        repair = llm_reply()
        repair["approaches"][1]["whyBetter"] = "One merge pass over the sorted arrays."
        repair["approaches"][1]["steps"] = ["Return result"]  # a regression the repair must not ship
        gen_replies = [json.dumps(first), json.dumps(repair)]
        reviews = [
            json.dumps({"issues": [{"path": "approaches[1].whyBetter", "severity": "error", "problem": "vague", "fix": ""}]}),
            '{"issues": []}',
        ]
        with mock.patch.object(rn, "call_llm", lambda s, u, **k: (gen_replies.pop(0), usage())), \
             mock.patch.object(audit, "call_llm", lambda s, u, **k: (reviews.pop(0), usage())):
            self.assertEqual(rn.generate_revision_notes(), 0)
        out = self.saved()
        self.assertEqual(out["approaches"][1]["whyBetter"], "One merge pass over the sorted arrays.")
        self.assertEqual(out["approaches"][1]["steps"], first["approaches"][1]["steps"])

    def test_clean_first_pass_needs_no_repair(self):
        with mock.patch.object(rn, "call_llm", lambda s, u, **k: (json.dumps(llm_reply()), usage())), \
             mock.patch.object(audit, "call_llm", lambda s, u, **k: ('{"issues": []}', usage())):
            self.assertEqual(rn.generate_revision_notes(), 0)
        out = self.saved()
        self.assertEqual((out["audit"]["status"], out["audit"]["repairs"]), ("passed", 0))
        self.assertFalse(out["audit"]["stale"])

    def test_verify_step_rechecks_reviewer_edits(self):
        edited = copy.deepcopy(saved_notes())
        edited["approaches"][1]["tc"] = "O(N)"  # a reviewer's wrong edit
        edited["audit"] = {"status": "passed", "stale": True, "repairs": 1}
        with open(os.path.join(self.tmp.name, "Outputs", rn.OUTPUT_NAME), "w") as f:
            json.dump(edited, f)
        with mock.patch.object(audit, "call_llm", lambda s, u, **k: ('{"issues": []}', usage())):
            self.assertEqual(audit.verify_revision_notes(), 0)
        out = self.saved()
        self.assertEqual(out["audit"]["status"], "needs_review")
        self.assertFalse(out["audit"]["stale"])
        self.assertEqual(out["audit"]["repairs"], 1)
        self.assertIn("complexity", failing(out["audit"]["checks"]))
        self.assertEqual(out["approaches"][1]["tc"], "O(N)", "verify reports; it never rewrites the notes")


if __name__ == "__main__":
    unittest.main()
