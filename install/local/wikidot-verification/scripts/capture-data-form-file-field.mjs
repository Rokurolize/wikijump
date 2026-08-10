#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const verifierRoot = new URL("../", import.meta.url);
const defaultCases = new URL("fixtures/data-form-file-field/cases.json", verifierRoot);
const defaultOutput = new URL("artifacts/data-form-file-field-live-20260810.json", verifierRoot);

function parseArgs(argv) {
  const args = {cases: fileURLToPath(defaultCases), output: fileURLToPath(defaultOutput)};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--cases", "--output"].includes(option)) {
      throw new Error("usage: capture-data-form-file-field.mjs [--cases FILE] [--output FILE]");
    }
    args[option.slice(2)] = value;
  }
  return args;
}

const pythonCapture = String.raw`
import datetime
import hashlib
import json
import os
import random
import sys
import time

import wikidot
from bs4 import BeautifulSoup
from wikidot.connector.ajax import AjaxModuleConnectorConfig

SITE = "sandbox-for-codex"

PHASES = [
    "create_form",
    "create_submission",
    "create_saved_source",
    "create_storage",
    "create_display",
    "edit_form",
    "edit_submission",
    "edit_saved_source",
    "edit_storage",
    "edit_display",
    "reload",
    "cleanup",
]

def wait_absent(site, fullname):
    for _ in range(10):
        if site.page.get(fullname, raise_when_not_found=False) is None:
            return
        time.sleep(0.5)
    raise RuntimeError(f"run-owned page remained present after cleanup: {fullname}")

def delete_run_owned_page(site, fullname):
    page = site.page.get(fullname, raise_when_not_found=False)
    if page is None:
        return False
    page.destroy()
    wait_absent(site, fullname)
    return True

def form_snapshot(response, field_name):
    body = response.get("body")
    if not isinstance(body, str):
        raise RuntimeError("PageEditModule omitted its body")
    soup = BeautifulSoup(body, "html.parser")
    form = soup.select_one("form#edit-page-form.data-form")
    if form is None:
        raise RuntimeError("PageEditModule did not expose form#edit-page-form.data-form")
    control = form.select_one(f'[name="field-{field_name}"]')
    if control is None:
        raise RuntimeError("PageEditModule did not expose the file field control")
    return {
        "status": "observed",
        "field_control": {
            "tag": control.name,
            "type": control.get("type"),
            "name": control.get("name"),
            "classes": list(control.get("class", [])),
            "accept": control.get("accept"),
            "multiple": control.has_attr("multiple"),
        },
        "sanitized_form_metadata": {
            "tag": form.name,
            "id": form.get("id"),
            "classes": list(form.get("class", [])),
            "method": form.get("method"),
            "enctype": form.get("enctype"),
            "action": form.get("action"),
        },
        "standalone_upload_route_exposed": bool(form.get("action")),
    }

def skipped(reason):
    return {"status": "not_attempted", "reason": reason}

def capture_run(site, plan, token):
    category = f"fw16-file-{plan['category_mode']}-{token}"
    template = f"{category}:_template"
    target = f"{category}:target"
    explicit_category = f"{plan.get('category_prefix', 'file')}-{token}"
    template_source = plan.get("template_source") or plan["template_source_format"].replace("%CATEGORY%", explicit_category)
    filename = f"{plan['upload']['filename_label']}-{token}.txt"
    payload = plan["upload"]["content_seed"].encode("utf-8")
    if len(payload) != plan["upload"]["byte_length"]:
        raise RuntimeError(f"fixture byte length mismatch for {plan['run_id']}")
    reason = "safe authenticated multipart upload and attachment cleanup operations were not established through the repository-pinned public client"
    phases = {phase: skipped(reason) for phase in PHASES}
    run = {
        "run_id": plan["run_id"],
        "status": "blocked",
        "category_mode": plan["category_mode"],
        "fixture_identity": {
            "template": template,
            "target": target,
            "explicit_category": explicit_category if plan["category_mode"] == "explicit" else None,
        },
        "upload": {
            "filename": filename,
            "byte_length": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "submitted": False,
        },
        "phases": phases,
    }
    template_created = False
    cleanup_errors = []
    try:
        if site.page.get(template, raise_when_not_found=False) is not None:
            raise RuntimeError("unique run-owned template already exists")
        if site.page.get(target, raise_when_not_found=False) is not None:
            raise RuntimeError("unique run-owned target already exists")
        site.page.publish(
            template,
            title=f"FW16 file-field {plan['run_id']} template",
            source=template_source,
            comment="run-owned FW16 file-field evidence preflight",
            verify_source=True,
            post_save_visibility_attempts=5,
            post_save_visibility_interval=0.5,
        )
        template_created = True
        response = site.amc_request([{
            "mode": "page",
            "wiki_page": target,
            "moduleName": "edit/PageEditModule",
        }])[0].json()
        phases["create_form"] = form_snapshot(response, plan["field_name"])
        phases["create_storage"] = {
            "status": "preflight_only",
            "target_page_present": site.page.get(target, raise_when_not_found=False) is not None,
            "target_page_attachments": [],
            "storage_page_fullname": None,
            "storage_page_attachments": [],
            "reason": "no upload occurred because the cleanup-safe multipart route was not established",
        }
    except Exception as exc:
        run["preflight_error"] = f"{type(exc).__name__}: {exc}"
    finally:
        if template_created:
            try:
                deleted = delete_run_owned_page(site, template)
            except Exception as exc:
                deleted = False
                cleanup_errors.append(f"template deletion failed: {type(exc).__name__}: {exc}")
        else:
            deleted = False
        try:
            template_absent = site.page.get(template, raise_when_not_found=False) is None
            target_absent = site.page.get(target, raise_when_not_found=False) is None
        except Exception as exc:
            template_absent = False
            target_absent = False
            cleanup_errors.append(f"absence verification failed: {type(exc).__name__}: {exc}")
        phases["cleanup"] = {
            "status": "verified" if template_absent and target_absent and not cleanup_errors else "incomplete",
            "template_deleted": deleted,
            "template_absent": template_absent,
            "target_absent": target_absent,
            "upload_submitted": False,
            "storage_page_created": False,
            "errors": cleanup_errors,
        }
    return run

def main():
    cases = json.load(sys.stdin)
    if cases.get("schema") != "wikidot.live.data-form.file-field.cases.v1":
        raise RuntimeError("unsupported cases schema")
    if cases.get("site") != SITE:
        raise RuntimeError("unsupported live site")
    if cases.get("surface_ids") != ["catalog-feature:data-forms-file-field"]:
        raise RuntimeError("unexpected target surface")
    username = os.environ.pop("WIKIDOT_USERNAME", None)
    password = os.environ.pop("WIKIDOT_PASSWORD", None)
    if not username or not password:
        raise RuntimeError("Account A environment credentials are required")
    token = f"{int(time.time())}-{os.getpid()}-{random.randrange(65536):04x}"
    config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
    with wikidot.Client(username=username, password=password, amc_config=config) as client:
        site = client.site.get(SITE)
        runs = [capture_run(site, plan, token) for plan in cases["runs"]]
    remaining = [
        fullname
        for run in runs
        for fullname in (run["fixture_identity"]["template"], run["fixture_identity"]["target"])
        if not (
            run["phases"]["cleanup"].get("template_absent")
            and run["phases"]["cleanup"].get("target_absent")
        )
    ]
    cleanup_verified = not remaining and all(run["phases"]["cleanup"]["status"] == "verified" for run in runs)
    artifact = {
        "schema": "wikidot.live.data-form.file-field.v1",
        "captured_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "site": SITE,
        "surface_ids": cases["surface_ids"],
        "status": "blocked",
        "actor_labels": {"mutation": "account-a", "public_read": "anonymous"},
        "public_interfaces": [
            "wikidot.py public page publish and source verification",
            "edit/PageEditModule generated create form",
            "wikidot.py public page existence and attachment inventory reads",
            "wikidot.py public page deletion and absence verification",
        ],
        "attempted_public_routes": [
            "authenticated run-owned category template publish",
            "authenticated edit/PageEditModule create-form preflight",
            "authenticated target-page existence and attachment-inventory preflight",
            "authenticated run-owned template deletion and absence readback",
        ],
        "mutation_performed": True,
        "membership_or_site_setting_mutation_performed": False,
        "promoted_rules": [],
        "blocked_reason": "The live form exposed a file control, but no cleanup-safe authenticated multipart upload operation was available through the repository-pinned public client, so upload behavior was not inferred.",
        "missing_authority": "An exact public multipart submission operation and exact public attachment cleanup operation usable through wikidot.py without copying session credentials outside its connector.",
        "runs": runs,
        "cleanup": {
            "verified": cleanup_verified,
            "remaining_run_owned_objects": remaining,
            "templates_created": sum(run["phases"]["cleanup"].get("template_deleted", False) for run in runs),
            "uploads_submitted": 0,
            "storage_pages_created": 0,
        },
        "credentials_exposed": False,
        "redactions": [
            "account credentials",
            "session identifiers",
            "PageEditModule operational lock material",
            "hidden form fields",
        ],
        "remaining_gaps": [
            "file upload submission and saved-source representation",
            "default and explicit separate storage-page category selection",
            "saved-page link DOM",
            "edit replacement and old-file retention semantics",
            "duplicate filename and filename normalization behavior",
            "validation failures and permission behavior",
            "ListPages behavior, image treatment, and Gallery exclusion",
            "browser-visible upload intervals",
        ],
    }
    json.dump(artifact, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")

main()
`;

const args = parseArgs(process.argv.slice(2));
const caseBytes = await readFile(args.cases);
const scriptBytes = await readFile(fileURLToPath(import.meta.url));
const result = spawnSync(
  "/home/roku/.codex/skills/wikidot-py-operations/scripts/wikidot-python",
  ["-c", pythonCapture],
  {input: caseBytes, encoding: "utf8", env: process.env, maxBuffer: 16 * 1024 * 1024},
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const artifact = JSON.parse(result.stdout);
artifact.evidence_identity = {
  cases_path: args.cases,
  cases_sha256: createHash("sha256").update(caseBytes).digest("hex"),
  capture_script_path: fileURLToPath(import.meta.url),
  capture_script_sha256: createHash("sha256").update(scriptBytes).digest("hex"),
};
await writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
console.log(JSON.stringify({output: args.output, status: artifact.status, cleanup: artifact.cleanup}));
