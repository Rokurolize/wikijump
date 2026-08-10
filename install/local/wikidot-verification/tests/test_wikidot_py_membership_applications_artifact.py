import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
CASES_PATH = (
    ROOT
    / "install/local/wikidot-verification/fixtures/wikidot-py-membership-applications/cases.json"
)
ARTIFACT_PATH = (
    ROOT
    / "install/local/wikidot-verification/artifacts/wikidot-py-membership-applications-live-20260810.json"
)
SURFACE_ID = "wikidot-py-amc-module:managesite/ManageSiteMembersApplicationsModule:parameters=(none)"
PINNED_CLIENT_COMMIT = "2434bf77744488cb2095327c9e0e4450add78df3"
EXPECTED_CASE_IDS = [
    "FW08_ADMIN_EMPTY",
    "FW08_ADMIN_POPULATED_RUN_OWNED",
    "FW08_ANONYMOUS_DENIAL",
    "FW08_AUTH_NONADMIN_DENIAL",
    "FW08_EXTRA_PARAMETER_IGNORED",
    "FW08_DUPLICATE_BATCH",
    "FW08_EXPIRED_APPLICATION_UNOBSERVED",
]
EXPECTED_ENVELOPE_KEYS = {
    "CURRENT_TIMESTAMP",
    "body",
    "callbackIndex",
    "cssInclude",
    "jsInclude",
    "status",
}


class MembershipApplicationsArtifactTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases_bytes = CASES_PATH.read_bytes()
        cls.cases = json.loads(cls.cases_bytes)
        cls.artifact_bytes = ARTIFACT_PATH.read_bytes()
        cls.artifact = json.loads(cls.artifact_bytes)
        cls.results = {case["case_id"]: case for case in cls.artifact["cases"]}

    def test_fixture_and_artifact_are_bound_to_the_exact_surface_and_client(
        self,
    ) -> None:
        self.assertEqual(self.cases["surface_ids"], [SURFACE_ID])
        self.assertEqual(self.artifact["surface_ids"], [SURFACE_ID])
        self.assertEqual(self.cases["pinned_client_commit"], PINNED_CLIENT_COMMIT)
        self.assertEqual(
            self.artifact["provenance"]["wikidot_py_commit"], PINNED_CLIENT_COMMIT
        )
        self.assertEqual(
            self.artifact["provenance"]["cases_sha256"],
            hashlib.sha256(self.cases_bytes).hexdigest(),
        )
        self.assertEqual(
            self.artifact["provenance"]["module_name"],
            "managesite/ManageSiteMembersApplicationsModule",
        )
        self.assertEqual(self.artifact["provenance"]["parameters"], [])

    def test_case_matrix_is_complete_and_ordered(self) -> None:
        fixture_case_ids = [case["case_id"] for case in self.cases["cases"]]
        artifact_case_ids = [case["case_id"] for case in self.artifact["cases"]]
        self.assertEqual(fixture_case_ids, EXPECTED_CASE_IDS)
        self.assertEqual(artifact_case_ids, EXPECTED_CASE_IDS)

    def test_admin_empty_and_populated_envelopes_are_exact(self) -> None:
        empty = self.results["FW08_ADMIN_EMPTY"]["responses"][0]
        populated = self.results["FW08_ADMIN_POPULATED_RUN_OWNED"]["responses"][0]
        self.assertEqual(set(empty), EXPECTED_ENVELOPE_KEYS)
        self.assertEqual(set(populated), EXPECTED_ENVELOPE_KEYS)
        self.assertEqual(empty["status"], "ok")
        self.assertIn("Sorry, no applications", empty["body"])
        self.assertNotIn("Membership application from", empty["body"])
        self.assertEqual(populated["status"], "ok")
        self.assertEqual(populated["body"].count("Membership application from"), 1)
        self.assertIn("<RUN_OWNED_APPLICATION_MARKER>", populated["body"])
        self.assertIn("<RUN_OWNED_APPLICANT>", populated["body"])
        self.assertIn("<RUN_OWNED_APPLICANT_ID>", populated["body"])

    def test_anonymous_and_authenticated_nonadmin_receive_the_same_denial(self) -> None:
        anonymous = self.results["FW08_ANONYMOUS_DENIAL"]["responses"][0]
        nonadmin = self.results["FW08_AUTH_NONADMIN_DENIAL"]["responses"][0]
        self.assertEqual(anonymous["body"], nonadmin["body"])
        self.assertEqual(anonymous["status"], nonadmin["status"])
        self.assertEqual(anonymous["cssInclude"], nonadmin["cssInclude"])
        self.assertEqual(anonymous["jsInclude"], nonadmin["jsInclude"])
        self.assertEqual(anonymous["status"], "ok")
        self.assertIn("WIKIDOT.page.listeners.loginClick(event)", anonymous["body"])
        self.assertNotIn("Membership application from", anonymous["body"])

    def test_extra_parameter_and_duplicate_batch_are_observed_without_widening_the_surface(
        self,
    ) -> None:
        canonical = self.results["FW08_ADMIN_EMPTY"]["responses"][0]
        extra = self.results["FW08_EXTRA_PARAMETER_IGNORED"]["responses"][0]
        duplicate = self.results["FW08_DUPLICATE_BATCH"]["responses"]
        for response in [extra, *duplicate]:
            self.assertEqual(response["body"], canonical["body"])
            self.assertEqual(response["status"], canonical["status"])
            self.assertEqual(response["cssInclude"], canonical["cssInclude"])
            self.assertEqual(response["jsInclude"], canonical["jsInclude"])
        self.assertEqual(len(duplicate), 2)
        self.assertEqual(
            self.results["FW08_EXTRA_PARAMETER_IGNORED"]["classification"],
            "unsupported_input_observed_ignored",
        )
        self.assertEqual(
            self.results["FW08_DUPLICATE_BATCH"]["classification"],
            "unsupported_input_observed_independent",
        )

    def test_optional_expiry_case_is_not_invented(self) -> None:
        expired = self.results["FW08_EXPIRED_APPLICATION_UNOBSERVED"]
        self.assertEqual(expired["classification"], "optional_unobserved")
        self.assertEqual(expired["responses"], [])
        self.assertIn("no public expiry setup", expired["gap"])

    def test_run_owned_fixture_was_removed_and_private_values_are_absent(self) -> None:
        fixture = self.artifact["fixture"]
        self.assertRegex(fixture["marker_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(fixture["created_application_count"], 1)
        self.assertEqual(fixture["cleanup"]["matching_applications_after"], 0)
        self.assertEqual(fixture["cleanup"]["result"], "removed")
        serialized = self.artifact_bytes.decode()
        self.assertNotRegex(serialized, r"WIKIDOT_[A-G]_(?:USERNAME|PASSWORD)")
        self.assertNotIn("WIKIDOT_SESSION_ID", serialized)
        self.assertNotIn("FW08-APPLICATIONS-20260810-", serialized)
        self.assertNotRegex(serialized, r'"marker"\s*:')
        self.assertTrue(self.artifact["privacy_review"]["passed"])


if __name__ == "__main__":
    unittest.main()
