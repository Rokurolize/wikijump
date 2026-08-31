#!/usr/bin/env python3
import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import uuid
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import wikidot
from wikidot.connector.ajax import AjaxModuleConnectorConfig


SCHEMA = "wikijump_wikidot_py.membership_applications_live.v1"
MODULE_NAME = "managesite/ManageSiteMembersApplicationsModule"
SURFACE_ID = f"wikidot-py-amc-module:{MODULE_NAME}:parameters=(none)"
MEMBERSHIP_APPLY_JAVASCRIPT = (
    "http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/"
    "common--modules/js/membership/MembershipApplyModule.js"
)
WIKIDOT_USER_PROFILE_URL = re.compile(
    r"((?:https?:)?//www\.wikidot\.com/user:info/)[^\"'<\s]+"
)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture Wikidot membership application list evidence"
    )
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def load_cases(path: Path) -> tuple[bytes, dict[str, Any]]:
    raw = path.read_bytes()
    data = json.loads(raw)
    if data.get("schema") != "wikijump_wikidot_py.membership_applications_cases.v1":
        raise ValueError("unexpected cases schema")
    if data.get("surface_ids") != [SURFACE_ID]:
        raise ValueError(
            "cases do not select the exact membership applications surface"
        )
    if data.get("module_name") != MODULE_NAME:
        raise ValueError("cases select an unexpected module")
    return raw, data


def credential(label: str) -> tuple[str, str]:
    username_name = f"WIKIDOT_{label}_USERNAME"
    password_name = f"WIKIDOT_{label}_PASSWORD"
    try:
        return os.environ[username_name], os.environ[password_name]
    except KeyError as exc:
        raise RuntimeError(
            f"missing sandbox credential environment for account {label}"
        ) from exc


def authenticated_client(site_name: str, label: str) -> wikidot.Client:
    username, password = credential(label)
    config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=site_name)
    return wikidot.Client(username=username, password=password, amc_config=config)


def exact_envelope(response: Any) -> dict[str, Any]:
    data = response.json()
    expected_keys = {
        "CURRENT_TIMESTAMP",
        "body",
        "callbackIndex",
        "cssInclude",
        "jsInclude",
        "status",
    }
    if (
        not isinstance(data, dict)
        or not expected_keys.issubset(data)
        or set(data) - expected_keys != ({"title"} if "title" in data else set())
    ):
        raise RuntimeError(
            f"unexpected response envelope keys: {sorted(data) if isinstance(data, dict) else type(data).__name__}"
        )
    if not isinstance(data["status"], str) or not isinstance(data["body"], str):
        raise RuntimeError("response status and body must both be strings")
    return data


def request_envelopes(
    site: Any, request_bodies: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    return [exact_envelope(response) for response in site.amc_request(request_bodies)]


def stable_payload(envelope: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in envelope.items()
        if key not in {"CURRENT_TIMESTAMP", "callbackIndex"}
    }


def fixture_case(cases: dict[str, Any], case_id: str) -> dict[str, Any]:
    matches = [case for case in cases["cases"] if case["case_id"] == case_id]
    if len(matches) != 1:
        raise RuntimeError(f"case {case_id} must occur exactly once")
    return matches[0]


def result(
    case: dict[str, Any],
    classification: str,
    responses: list[dict[str, Any]],
    **extra: Any,
) -> dict[str, Any]:
    return {
        "case_id": case["case_id"],
        "actor": case["actor"],
        "request_bodies": case["request_bodies"],
        "classification": classification,
        "responses": responses,
        **extra,
    }


def normalize_populated_body(
    body: str, marker: str, applicant_name: str, applicant_id: int
) -> str:
    normalized = body.replace(marker, "<RUN_OWNED_APPLICATION_MARKER>")
    normalized = normalized.replace(applicant_name, "<RUN_OWNED_APPLICANT>")
    normalized = normalized.replace(str(applicant_id), "<RUN_OWNED_APPLICANT_ID>")
    normalized = WIKIDOT_USER_PROFILE_URL.sub(
        r"\1RUN_OWNED_APPLICANT", normalized
    )
    if (
        marker in normalized
        or applicant_name in normalized
        or str(applicant_id) in normalized
    ):
        raise RuntimeError("populated response sanitization was incomplete")
    return normalized


def verify_public_setup_contract() -> dict[str, str]:
    response = httpx.get(MEMBERSHIP_APPLY_JAVASCRIPT, follow_redirects=True, timeout=20)
    response.raise_for_status()
    javascript = response.text
    required = [
        'a.action="MembershipApplyAction"',
        'a.event="apply"',
        'requestModule("membership/MembershipApplySuccessModule"',
    ]
    if any(fragment not in javascript for fragment in required):
        raise RuntimeError(
            "live MembershipApply JavaScript no longer proves the public setup request"
        )
    return {
        "javascript_url": MEMBERSHIP_APPLY_JAVASCRIPT,
        "javascript_sha256": sha256_bytes(response.content),
        "action": "MembershipApplyAction",
        "event": "apply",
        "module_name": "membership/MembershipApplySuccessModule",
        "field": "comment",
    }


def verify_pinned_client(repository_root: Path, expected_commit: str) -> dict[str, str]:
    requirements_path = (
        repository_root / "install/local/wikidot-verification/requirements.txt"
    )
    requirements_bytes = requirements_path.read_bytes()
    match = re.search(
        rb"^wikidot @ git\+https://github\.com/Rokurolize/wikidot\.py@([0-9a-f]{40})$",
        requirements_bytes,
        re.MULTILINE,
    )
    if match is None or match.group(1).decode() != expected_commit:
        raise RuntimeError("the verifier wikidot.py pin does not match the cases")
    installed_module_path = (
        Path(wikidot.__file__).resolve().parent / "module/site_application.py"
    )
    return {
        "wikidot_py_commit": expected_commit,
        "wikidot_py_version": importlib.metadata.version("wikidot"),
        "requirements_sha256": sha256_bytes(requirements_bytes),
        "installed_site_application_sha256": sha256_bytes(
            installed_module_path.read_bytes()
        ),
    }


def main() -> None:
    args = parse_args()
    if args.output.exists():
        raise FileExistsError(f"refusing to replace existing artifact: {args.output}")
    cases_bytes, cases = load_cases(args.cases)
    repository_root = Path(__file__).resolve().parents[4]
    client_identity = verify_pinned_client(
        repository_root, cases["pinned_client_commit"]
    )
    setup_contract = verify_public_setup_contract()
    site_name = cases["site"]
    administrator_label = cases["administrator_label"]
    nonadministrator_label = cases["nonadministrator_label"]
    applicant_label = cases["run_owned_applicant_label"]
    marker = f"FW08-APPLICATIONS-20260810-{uuid.uuid4().hex}"
    marker_sha256 = sha256_bytes(marker.encode())
    case_results: list[dict[str, Any]] = []
    setup_receipt: dict[str, Any] | None = None
    cleanup_receipt = {"result": "not_created", "matching_applications_after": 0}
    submission_attempted = False

    with ExitStack() as stack:
        administrator = stack.enter_context(
            authenticated_client(site_name, administrator_label)
        )
        administrator_site = administrator.site.get(site_name)
        nonadministrator = stack.enter_context(
            authenticated_client(site_name, nonadministrator_label)
        )
        nonadministrator_site = nonadministrator.site.get(site_name)
        applicant = stack.enter_context(
            authenticated_client(site_name, applicant_label)
        )
        applicant_site = applicant.site.get(site_name)
        anonymous = stack.enter_context(wikidot.Client())
        anonymous_site = anonymous.site.get(site_name)

        empty_case = fixture_case(cases, "FW08_ADMIN_EMPTY")
        empty_responses = request_envelopes(
            administrator_site, empty_case["request_bodies"]
        )
        if len(empty_responses) != 1 or empty_responses[0]["status"] != "ok":
            raise RuntimeError(
                "administrator empty preflight did not return one ok envelope"
            )
        empty_body = empty_responses[0]["body"]
        if (
            "Membership application from" in empty_body
            or "Sorry, no applications" not in empty_body
        ):
            raise RuntimeError(
                "administrator preflight is not empty; refusing to capture another user's application"
            )
        case_results.append(result(empty_case, "positive_empty", empty_responses))

        anonymous_case = fixture_case(cases, "FW08_ANONYMOUS_DENIAL")
        anonymous_responses = request_envelopes(
            anonymous_site, anonymous_case["request_bodies"]
        )
        if (
            len(anonymous_responses) != 1
            or "WIKIDOT.page.listeners.loginClick(event)"
            not in anonymous_responses[0]["body"]
        ):
            raise RuntimeError("anonymous denial envelope changed")
        case_results.append(
            result(anonymous_case, "negative_permission_denial", anonymous_responses)
        )

        nonadministrator_case = fixture_case(cases, "FW08_AUTH_NONADMIN_DENIAL")
        nonadministrator_responses = request_envelopes(
            nonadministrator_site, nonadministrator_case["request_bodies"]
        )
        if stable_payload(nonadministrator_responses[0]) != stable_payload(
            anonymous_responses[0]
        ):
            raise RuntimeError(
                "authenticated nonadministrator denial differs from the anonymous denial"
            )
        case_results.append(
            result(
                nonadministrator_case,
                "negative_permission_denial",
                nonadministrator_responses,
            )
        )

        extra_case = fixture_case(cases, "FW08_EXTRA_PARAMETER_IGNORED")
        extra_responses = request_envelopes(
            administrator_site, extra_case["request_bodies"]
        )
        if stable_payload(extra_responses[0]) != stable_payload(empty_responses[0]):
            raise RuntimeError(
                "extra parameter no longer produces the canonical administrator empty response"
            )

        duplicate_case = fixture_case(cases, "FW08_DUPLICATE_BATCH")
        duplicate_responses = request_envelopes(
            administrator_site, duplicate_case["request_bodies"]
        )
        if len(duplicate_responses) != 2 or any(
            stable_payload(response) != stable_payload(empty_responses[0])
            for response in duplicate_responses
        ):
            raise RuntimeError(
                "duplicate batch did not return two independent canonical responses"
            )

        preview_response = request_envelopes(
            applicant_site,
            [
                {
                    "moduleName": "edit/PagePreviewModule",
                    "mode": "page",
                    "source": "[[module MembershipApply]]",
                    "title": "FW08 membership application setup preflight",
                }
            ],
        )[0]
        if (
            'id="membership-by-apply-form"' not in preview_response["body"]
            or 'name="comment"' not in preview_response["body"]
        ):
            raise RuntimeError(
                "run-owned applicant does not receive the public MembershipApply form"
            )

        submission_attempted = True
        try:
            setup_response = request_envelopes(
                applicant_site,
                [
                    {
                        "action": setup_contract["action"],
                        "event": setup_contract["event"],
                        "comment": marker,
                        "moduleName": setup_contract["module_name"],
                    }
                ],
            )[0]
            if setup_response["status"] != "ok":
                raise RuntimeError("public MembershipApply submission failed")
            setup_receipt = {
                "interface": "public_wikidot_ajax_module_connector",
                "request_shape": {
                    "action": setup_contract["action"],
                    "event": setup_contract["event"],
                    "fields": ["comment"],
                    "moduleName": setup_contract["module_name"],
                },
                "response": {
                    "status": setup_response["status"],
                    "body_sha256": sha256_bytes(setup_response["body"].encode()),
                },
            }
            populated_case = fixture_case(cases, "FW08_ADMIN_POPULATED_RUN_OWNED")
            populated_responses = request_envelopes(
                administrator_site, populated_case["request_bodies"]
            )
            populated_body = populated_responses[0]["body"]
            applications = administrator_site.applications
            matching = [
                application
                for application in applications
                if application.text == marker
            ]
            if len(applications) != 1 or len(matching) != 1:
                raise RuntimeError(
                    "populated preflight is not exactly one run-owned application"
                )
            application = matching[0]
            if application.user.name != credential(applicant_label)[
                0
            ] or not isinstance(application.user.id, int):
                raise RuntimeError(
                    "the populated application does not belong to the run-owned applicant"
                )
            populated_responses[0]["body"] = normalize_populated_body(
                populated_body,
                marker,
                application.user.name,
                application.user.id,
            )
            populated_result = result(
                populated_case,
                "positive_populated_run_owned",
                populated_responses,
                raw_body_sha256=sha256_bytes(populated_body.encode()),
            )
        finally:
            if submission_attempted:
                cleanup_matches = [
                    application
                    for application in administrator_site.applications
                    if application.text == marker
                ]
                if len(cleanup_matches) > 1:
                    raise RuntimeError(
                        "more than one marker-owned application exists; refusing ambiguous cleanup"
                    )
                if cleanup_matches:
                    cleanup_matches[0].decline()
                remaining_matches = [
                    application
                    for application in administrator_site.applications
                    if application.text == marker
                ]
                cleanup_receipt = {
                    "interface": "wikidot.py SiteApplication.decline public AMC action",
                    "result": "removed"
                    if cleanup_matches and not remaining_matches
                    else "not_created",
                    "matching_applications_after": len(remaining_matches),
                }
                if remaining_matches:
                    raise RuntimeError(
                        "run-owned application cleanup did not remove the application"
                    )

        case_results.insert(1, populated_result)
        case_results.append(
            result(extra_case, "unsupported_input_observed_ignored", extra_responses)
        )
        case_results.append(
            result(
                duplicate_case,
                "unsupported_input_observed_independent",
                duplicate_responses,
            )
        )
        expired_case = fixture_case(cases, "FW08_EXPIRED_APPLICATION_UNOBSERVED")
        case_results.append(
            result(
                expired_case,
                "optional_unobserved",
                [],
                gap="no public expiry setup or expiration clock control is established for a run-owned application",
            )
        )

    expected_case_ids = [case["case_id"] for case in cases["cases"]]
    if [case["case_id"] for case in case_results] != expected_case_ids:
        raise RuntimeError("artifact case order does not match the fixture")
    if setup_receipt is None or cleanup_receipt["result"] != "removed":
        raise RuntimeError("run-owned fixture lifecycle is incomplete")

    artifact = {
        "schema": SCHEMA,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "surface_ids": [SURFACE_ID],
        "provenance": {
            "site": site_name,
            "site_origin": f"http://{site_name}.wikidot.com",
            "module_name": MODULE_NAME,
            "parameters": [],
            "authenticated_transport_scope": site_name,
            "cases_sha256": sha256_bytes(cases_bytes),
            **client_identity,
            "public_setup_contract": setup_contract,
        },
        "fixture": {
            "applicant_account_label": applicant_label,
            "marker_sha256": marker_sha256,
            "created_application_count": 1,
            "setup": setup_receipt,
            "cleanup": cleanup_receipt,
        },
        "cases": case_results,
        "privacy_review": {
            "passed": True,
            "credentials_recorded": False,
            "cookies_recorded": False,
            "run_marker_recorded": False,
            "applicant_identity_normalized": True,
            "other_applications_captured": False,
        },
        "promotable_rules": [
            "The no-parameter administrator request returns an ok envelope with the application-list body.",
            "An empty administrator list and an exactly-one populated list have distinct bodies.",
            "Anonymous and authenticated nonadministrator requests return the same ok login-required body.",
            "The observed extra parameter is ignored and a duplicate batch returns two independent canonical responses; these inputs remain outside the declared no-parameter surface.",
        ],
        "remaining_gap": "Application expiry behavior is unobserved because no public expiry setup or expiration clock control is established.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(artifact, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
