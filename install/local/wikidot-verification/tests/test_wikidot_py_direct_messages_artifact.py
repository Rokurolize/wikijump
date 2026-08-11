import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
CASES_PATH = ROOT / "install/local/wikidot-verification/fixtures/wikidot-py-direct-messages/cases.json"
ARTIFACT_PATH = ROOT / "install/local/wikidot-verification/artifacts/wikidot-py-direct-messages-live-20260810.json"
SCRIPT_PATH = ROOT / "install/local/wikidot-verification/scripts/capture_wikidot_py_direct_messages.py"
PINNED_COMMIT = "551fe7f05cac0c3322f9c69f43fbd4866d3fdfd2"
EXPECTED_CASES = {
    "inbox_omitted_page",
    "inbox_explicit_page_1",
    "sent_omitted_page",
    "sent_explicit_page_1",
    "recipient_detail",
    "sender_detail_if_permitted",
    "anonymous_inbox_denial",
    "missing_session_inbox_denial",
    "unrelated_actor_detail_denial",
    "nonexistent_item",
    "invalid_page",
}


def test_blocked_direct_message_artifact_is_private_and_complete() -> None:
    cases = json.loads(CASES_PATH.read_text())
    artifact = json.loads(ARTIFACT_PATH.read_text())

    assert SCRIPT_PATH.is_file()
    assert cases["schema"] == "wikijump.wikidot_py_direct_messages_cases.v1"
    assert {case["id"] for case in cases["cases"]} == EXPECTED_CASES
    assert artifact["schema"] == "wikijump.wikidot_py_direct_messages_live.v1"
    assert artifact["status"] == "blocked"
    assert artifact["pinned_client"]["commit"] == PINNED_COMMIT
    assert artifact["pinned_client"]["version"] == "4.4.1"
    assert artifact["run_marker_sha256"] == hashlib.sha256(artifact["run_marker_public_seed"].encode()).hexdigest()
    assert artifact["run_owned_message_ids"] == []
    assert artifact["positive_controls"] == []
    assert {result["case_id"] for result in artifact["case_results"]} == EXPECTED_CASES
    assert all(result["disposition"] in {"blocked", "observed"} for result in artifact["case_results"])
    assert all(result.get("message_ids", []) == [] for result in artifact["case_results"])
    assert all("body" not in result and "subject" not in result and "html" not in result for result in artifact["case_results"])
    assert artifact["privacy_review"]["unrelated_correspondence_persisted"] is False
    assert artifact["privacy_review"]["credentials_persisted"] is False
    assert artifact["privacy_review"]["raw_authenticated_responses_persisted"] is False
    assert artifact["cleanup"]["messages_sent"] == 0
    assert artifact["cleanup"]["messages_deleted"] == 0
    assert artifact["cleanup"]["safe_public_cleanup_available"] is False
    serialized = json.dumps(artifact, sort_keys=True)
    for forbidden in ("WIKIDOT_SESSION_ID", "wikidot_token7", "password"):
        assert forbidden not in serialized
