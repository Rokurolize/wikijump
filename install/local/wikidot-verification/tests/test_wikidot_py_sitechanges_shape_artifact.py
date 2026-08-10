import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
CASES_PATH = ROOT / "install/local/wikidot-verification/fixtures/wikidot-py-sitechanges-shape/cases.json"
ARTIFACT_PATH = ROOT / "install/local/wikidot-verification/artifacts/wikidot-py-sitechanges-shape-live-20260810.json"
PINNED_COMMIT = "2434bf77744488cb2095327c9e0e4450add78df3"
EXPECTED_CASE_IDS = [
    "client-page-one-default",
    "client-later-page",
    "control-empty-options",
    "control-source-options",
    "control-bad-page",
    "control-bad-perpage",
    "control-missing-options",
    "control-unknown-field",
    "control-browser-shape",
]
MAX_ARTIFACT_BYTES = 100_000
MAX_STRUCTURE_MARKERS = 12
MAX_EXACT_CONTROL_BODY_BYTES = 256


class WikidotPySiteChangesShapeArtifactTest(unittest.TestCase):
    def test_artifact_rejects_unbounded_response_and_parser_rows(self) -> None:
        artifact = json.loads(ARTIFACT_PATH.read_text())
        violations = []
        if ARTIFACT_PATH.stat().st_size > MAX_ARTIFACT_BYTES:
            violations.append(f"artifact exceeds {MAX_ARTIFACT_BYTES} bytes")
        for case in artifact["cases"]:
            if "items" in case["parser_result"]:
                violations.append(f"{case['id']} retains parser items")
            for request in case["requests"]:
                response = request["response"]
                if "body" in response:
                    violations.append(f"{case['id']} retains an unbounded response body")
                if set(response["body_summary"]) != {
                    "byte_length",
                    "sha256",
                    "leading_structure",
                    "trailing_structure",
                    "changes_list_item_count",
                    "pager_count",
                    "no_revisions_message",
                    "bounded_exact_body",
                }:
                    violations.append(f"{case['id']} has an unexpected body summary field")
        serialized = json.dumps(artifact)
        for private_row_field in ("page_fullname", "page_title", "revision_no", "changed_by", "changed_at", "comment"):
            if f'"{private_row_field}"' in serialized:
                violations.append(f"artifact retains parser field {private_row_field}")
        for raw_html_marker in ("href=", "onclick=", "<div", "<table"):
            if raw_html_marker in serialized:
                violations.append(f"artifact retains raw HTML marker {raw_html_marker}")
        self.assertEqual(violations, [])

    def test_live_artifact_proves_client_shape_and_keeps_controls_separate(self) -> None:
        cases = json.loads(CASES_PATH.read_text())
        artifact = json.loads(ARTIFACT_PATH.read_text())

        self.assertEqual(cases["schema"], "wikijump.wikidot_py_sitechanges_shape_cases.v1")
        self.assertEqual(artifact["schema"], "wikijump.wikidot_py_sitechanges_shape_live.v1")
        self.assertEqual(artifact["surface_id"], "wikidot-py-amc-module:changes/SiteChangesListModule:parameters=options,page,perpage")
        self.assertEqual(artifact["pinned_client"]["wikidot_py_commit"], PINNED_COMMIT)
        self.assertEqual(artifact["pinned_client"]["installed_commit"], PINNED_COMMIT)
        self.assertEqual(artifact["pinned_client"]["version"], "4.4.1")
        self.assertEqual(artifact["cases_sha256"], hashlib.sha256(CASES_PATH.read_bytes()).hexdigest())
        self.assertEqual(artifact["mutated"], False)
        self.assertEqual(artifact["redactions"], [
            "wikidot_token7 values",
            "cookie values",
            "credentials",
            "response row content and parser records",
        ])

        case_plans = cases["cases"]
        observations = artifact["cases"]
        self.assertEqual([case["id"] for case in case_plans], EXPECTED_CASE_IDS)
        self.assertEqual([case["id"] for case in observations], EXPECTED_CASE_IDS)
        plans_by_id = {case["id"]: case for case in case_plans}

        for observation in observations:
            with self.subTest(case=observation["id"]):
                plan = plans_by_id[observation["id"]]
                self.assertEqual(observation["driver"], plan["driver"])
                self.assertEqual(observation["role"], plan["role"])
                self.assertGreaterEqual(len(observation["requests"]), 1)
                for request in observation["requests"]:
                    expected_fields = ["wikidot_token7", *request["client_body_field_names"]]
                    self.assertEqual(request["outgoing_field_names_in_order"], expected_fields)
                    self.assertEqual(request["outgoing_field_multiset"], {name: expected_fields.count(name) for name in dict.fromkeys(expected_fields)})
                    self.assertEqual(request["outgoing_fields_in_order"][0], ["wikidot_token7", "<redacted>"])
                    self.assertIn("wikidot_token7", request["cookie_field_names"])
                    self.assertIn("WIKIDOT_SESSION_ID", request["cookie_field_names"])
                    response = request["response"]
                    self.assertEqual(response["http_status"], 200)
                    self.assertEqual(response["status"], "ok")
                    self.assertIsNone(response["callback"])
                    self.assertEqual(response["css"], [])
                    self.assertEqual(response["js"], [])
                    body = response["body_summary"]
                    self.assertGreater(body["byte_length"], 0)
                    self.assertRegex(body["sha256"], r"^[0-9a-f]{64}$")
                    self.assertLessEqual(len(body["leading_structure"]), MAX_STRUCTURE_MARKERS)
                    self.assertLessEqual(len(body["trailing_structure"]), MAX_STRUCTURE_MARKERS)
                    self.assertIsInstance(body["changes_list_item_count"], int)
                    self.assertIsInstance(body["pager_count"], int)
                    exact_body = body["bounded_exact_body"]
                    if exact_body is not None:
                        self.assertLessEqual(len(exact_body.encode()), MAX_EXACT_CONTROL_BODY_BYTES)

        page_one = observations[0]
        self.assertEqual(page_one["driver"], "Site.get_recent_changes")
        self.assertEqual(page_one["requests"][0]["client_body_fields_in_order"], [
            ["moduleName", "changes/SiteChangesListModule"],
            ["perpage", "1000"],
            ["page", "1"],
            ["options", "{'all':true}"],
        ])
        self.assertEqual(page_one["parser_result"]["kind"], "site_changes")
        self.assertGreater(page_one["parser_result"]["count"], 0)

        later_page = observations[1]
        self.assertEqual([request["client_body_fields_in_order"][2] for request in later_page["requests"]], [["page", "1"], ["page", "2"]])
        self.assertEqual(later_page["parser_result"]["kind"], "site_changes")
        self.assertEqual(later_page["parser_result"]["count"], 1001)

        for observation in observations[2:]:
            self.assertEqual(observation["driver"], "Site.amc_request control")
            self.assertEqual(observation["parser_result"], {"kind": "not_invoked_control"})
            plan = plans_by_id[observation["id"]]
            expected = [[name, str(value)] for name, value in plan["body_fields_in_order"]]
            self.assertEqual(observation["requests"][0]["client_body_fields_in_order"], expected)

        browser = observations[-1]["requests"][0]["client_body_field_names"]
        self.assertIn("pageId", browser)
        self.assertIn("categoryId", browser)
        self.assertNotEqual(browser, page_one["requests"][0]["client_body_field_names"])


if __name__ == "__main__":
    unittest.main()
