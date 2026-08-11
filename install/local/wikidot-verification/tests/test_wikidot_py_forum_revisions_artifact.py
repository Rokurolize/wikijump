import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
CASES_PATH = ROOT / "install/local/wikidot-verification/fixtures/wikidot-py-forum-revisions/cases.json"
ARTIFACT_PATH = ROOT / "install/local/wikidot-verification/artifacts/wikidot-py-forum-revisions-live-20260810.json"

EXPECTED_CASE_IDS = {
    "EDIT_FORM_PERMITTED",
    "REVISION_LIST_KNOWN_POST",
    "REVISION_BODY_EACH_KNOWN_REVISION",
    "EDIT_FORM_WRONG_THREAD",
    "EDIT_FORM_NONEXISTENT_POST",
    "REVISION_LIST_NONEXISTENT_POST",
    "REVISION_BODY_NONEXISTENT_REVISION",
    "EDIT_FORM_UNAUTHORIZED",
    "REVISION_LIST_UNAUTHORIZED",
    "REVISION_BODY_UNAUTHORIZED",
    "EDIT_FORM_MALFORMED_NUMERIC",
    "REVISION_LIST_MALFORMED_NUMERIC",
    "REVISION_BODY_MALFORMED_NUMERIC",
}


class WikidotPyForumRevisionsArtifactTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases_bytes = CASES_PATH.read_bytes()
        cls.cases = json.loads(cls.cases_bytes)
        cls.artifact = json.loads(ARTIFACT_PATH.read_text())
        cls.by_id = {case["case_id"]: case for case in cls.artifact["cases"]}

    def test_identity_and_case_manifest_are_pinned(self) -> None:
        self.assertEqual(self.cases["schema"], "wikijump.wikidot_py_forum_revisions.cases.v1")
        self.assertEqual(self.artifact["schema"], "wikijump.wikidot_py_forum_revisions.live.v1")
        self.assertEqual(self.artifact["lane_id"], "FW-07-WIKIDOTPY-FORUM-REVISION-EVIDENCE")
        self.assertEqual(self.artifact["base_head"], "d26a60418808668336ebf57c3429353e77ccd733")
        self.assertEqual(
            self.artifact["case_manifest_sha256"],
            hashlib.sha256(self.cases_bytes).hexdigest(),
        )
        self.assertEqual(set(self.by_id), EXPECTED_CASE_IDS)
        self.assertEqual({case["case_id"] for case in self.cases["cases"]}, EXPECTED_CASE_IDS)
        self.assertEqual(
            self.artifact["pinned_client_identity"]["commit"],
            "9f33c0f450de9daf333b068e8d70527e033fc07c",
        )
        self.assertFalse(self.artifact["pinned_client_identity"]["dirty"])

    def test_request_shapes_are_exactly_the_pinned_client_shapes(self) -> None:
        for case in self.artifact["cases"]:
            requests = case.get("requests", [case.get("request")])
            for request in requests:
                module_name = request["moduleName"]
                if module_name == "forum/sub/ForumEditPostFormModule":
                    self.assertEqual(set(request), {"moduleName", "postId", "threadId"})
                elif module_name == "forum/sub/ForumPostRevisionsModule":
                    self.assertEqual(set(request), {"moduleName", "postId"})
                elif module_name == "forum/sub/ForumPostRevisionModule":
                    self.assertEqual(set(request), {"moduleName", "revisionId"})
                    self.assertIsInstance(request["revisionId"], (int, str))
                else:
                    self.fail(f"unexpected module: {module_name}")

    def test_positive_controls_bind_parsers_to_live_envelopes(self) -> None:
        edit = self.by_id["EDIT_FORM_PERMITTED"]
        self.assertEqual(edit["response_envelope"]["status"], "ok")
        self.assertEqual(edit["parser_result"]["form_id"], "edit-post-form")
        self.assertIsInstance(edit["parser_result"]["current_revision_id"], int)
        self.assertEqual(edit["parser_result"]["source"], "FW07 revision two")

        revisions = self.by_id["REVISION_LIST_KNOWN_POST"]
        self.assertEqual(revisions["response_envelope"]["status"], "ok")
        revision_ids = revisions["parser_result"]["revision_ids"]
        self.assertGreaterEqual(len(revision_ids), 3)
        self.assertEqual(len(revision_ids), len(set(revision_ids)))

        bodies = self.by_id["REVISION_BODY_EACH_KNOWN_REVISION"]
        self.assertEqual([request["revisionId"] for request in bodies["requests"]], revision_ids)
        self.assertEqual(
            [entry["revision_id"] for entry in bodies["response_envelopes"]],
            revision_ids,
        )
        self.assertEqual(
            [entry["revision_id"] for entry in bodies["parser_results"]],
            revision_ids,
        )
        self.assertTrue(all(entry["status"] == "ok" for entry in bodies["response_envelopes"]))
        self.assertTrue(all(isinstance(entry["content"], str) for entry in bodies["parser_results"]))

    def test_negative_controls_preserve_observed_failure_envelopes(self) -> None:
        negative_ids = EXPECTED_CASE_IDS - {
            "EDIT_FORM_PERMITTED",
            "REVISION_LIST_KNOWN_POST",
            "REVISION_BODY_EACH_KNOWN_REVISION",
        }
        for case_id in negative_ids:
            case = self.by_id[case_id]
            envelope = case["response_envelope"]
            self.assertIn(envelope["kind"], {"response", "exception"})
            if envelope["kind"] == "response":
                self.assertIsInstance(envelope["status"], str)
            else:
                self.assertIsInstance(envelope["exception_type"], str)
                self.assertIsInstance(envelope["message"], str)
            self.assertIn("classification", case["parser_result"])

    def test_cleanup_moves_only_run_owned_threads_to_deleted_category(self) -> None:
        fixtures = self.artifact["fixture_identities"]
        self.assertEqual(len(fixtures["thread_ids"]), 2)
        self.assertEqual(len(fixtures["post_ids"]), 2)
        cleanup = self.artifact["cleanup"]
        self.assertEqual(cleanup["method"], "ForumAction/moveThread")
        self.assertEqual(cleanup["status"], "complete")
        self.assertEqual(
            {receipt["thread_id"] for receipt in cleanup["receipts"]},
            set(fixtures["thread_ids"]),
        )
        self.assertTrue(all(receipt["response_status"] == "ok" for receipt in cleanup["receipts"]))
        self.assertTrue(all(receipt["verified_deleted_category"] for receipt in cleanup["receipts"]))

    def test_artifact_contains_no_credentials_or_session_material(self) -> None:
        serialized = json.dumps(self.artifact).lower()
        for forbidden in ("password", "wikidot_session_id", "wikidot_token7", "cookie"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
