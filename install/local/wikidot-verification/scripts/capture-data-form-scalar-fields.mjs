#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const verifierRoot = new URL("../", import.meta.url);
const defaultCases = new URL("fixtures/data-form-scalar-fields/cases.json", verifierRoot);
const defaultOutput = new URL("artifacts/data-form-hidden-password-static-url-live-20260810.json", verifierRoot);

function parseArgs(argv) {
  const args = {cases: fileURLToPath(defaultCases), output: fileURLToPath(defaultOutput)};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--cases", "--output"].includes(option)) {
      throw new Error("usage: capture-data-form-scalar-fields.mjs [--cases FILE] [--output FILE]");
    }
    args[option.slice(2)] = value;
  }
  return args;
}

const pythonCapture = String.raw`
import json
import os
import random
import re
import sys
import time

import httpx
import wikidot
from bs4 import BeautifulSoup
from wikidot.connector.ajax import AjaxModuleConnectorConfig

SITE = "sandbox-for-codex"
ORIGIN = "http://sandbox-for-codex.wikidot.com"

def wait_page(site, fullname, present):
    for _ in range(10):
        page = site.page.get(fullname, raise_when_not_found=False)
        if (page is not None) == present:
            return page
        time.sleep(0.5)
    raise RuntimeError(f"page visibility did not settle for {fullname}")

def editor_snapshot(response, field_name):
    body = response.get("body")
    if not isinstance(body, str):
        raise RuntimeError("PageEditModule omitted its body")
    soup = BeautifulSoup(body, "html.parser")
    form = soup.select_one("form#edit-page-form.data-form")
    if form is None:
        raise RuntimeError("PageEditModule did not expose a data form")
    control = form.select_one(f'[name="field-{field_name}"]')
    form_fields = form.select_one('[name="form-fields"]')
    page_id = form.select_one('[name="page_id"]')
    return {
        "form_class": " ".join(form.get("class", [])),
        "form_fields": form_fields.get("value", "") if form_fields else None,
        "page_id": page_id.get("value", "") if page_id else None,
        "control": {
            "tag": control.name if control else None,
            "type": control.get("type") if control else None,
            "class": " ".join(control.get("class", [])) if control else None,
            "value": control.get("value") if control else None,
        },
        "field_fragment": str(control) if control else None,
        "body": body,
    }

def display_snapshot(fullname):
    response = httpx.get(f"{ORIGIN}/{fullname}", follow_redirects=False, timeout=30.0, trust_env=False)
    response.raise_for_status()
    content = BeautifulSoup(response.text, "html.parser").select_one("#page-content")
    if content is None:
        raise RuntimeError("saved page omitted #page-content")
    table = content.select_one("table.form-table")
    if table is None:
        raise RuntimeError("saved data-form page omitted table.form-table")
    return {"text": table.get_text(" ", strip=True), "html": str(table)}

def lock(site, fullname):
    response = site.amc_request([{
        "mode": "page",
        "wiki_page": fullname,
        "moduleName": "edit/PageEditModule",
    }])[0].json()
    if response.get("status") not in (None, "ok") or response.get("locked") or response.get("other_locks"):
        raise RuntimeError("PageEditModule refused an uncontested lock")
    if not response.get("lock_id") or not response.get("lock_secret"):
        raise RuntimeError("PageEditModule omitted lock credentials")
    return response

def save_form(site, fullname, title, edit_response, editor, field_name, submitted):
    request = {
        "action": "WikiPageAction",
        "event": "savePage",
        "moduleName": "Empty",
        "mode": "page",
        "lock_id": edit_response["lock_id"],
        "lock_secret": edit_response["lock_secret"],
        "revision_id": edit_response.get("page_revision_id") or "",
        "wiki_page": fullname,
        "page_id": editor["page_id"] or "",
        "title": title,
        "source": "",
        "comments": "run-owned FW09 scalar field evidence",
        "form-use": "true",
        "form-fields": editor["form_fields"] or "",
        f"field-{field_name}": submitted,
    }
    response = site.amc_request([request])[0].json()
    if response.get("status") != "ok":
        raise RuntimeError(f"savePage failed with status {response.get('status')!r}")
    return {"status": response["status"], "revision_id": response.get("revisionId")}

def source_snapshot(page):
    page.refresh_source()
    return page.source.wiki_text

def control_results(field, create, edit, reload, submitted):
    create_source = create["saved_source"]
    edit_source = edit["saved_source"]
    create_text = create["display"]["text"]
    edit_text = edit["display"]["text"]
    if field == "hidden":
        checks = [
            "HIDDEN_CONFIGURED_ALPHA" in create_source and "HIDDEN_CONFIGURED_ALPHA" in create_text,
            edit_source == create_source and reload["saved_source"] == edit_source,
            create["control"]["tag"] is None and edit["control"]["tag"] is None,
            submitted["create"] not in create_source and submitted["edit"] not in edit_source,
        ]
    elif field == "password":
        checks = [
            submitted["create"] in create_source and submitted["create"] not in create_text,
            submitted["edit"] in edit_source and reload["control"]["value"] == submitted["edit"],
            create["control"]["type"] == "password" and edit["control"]["type"] == "password",
            submitted["create"] not in create_text and submitted["edit"] not in edit_text,
        ]
    elif field == "static":
        checks = [
            "STATIC BOLD ALPHA" in create_text and "<strong>BOLD</strong>" in create["display"]["html"],
            edit_text == create_text and reload["display"]["text"] == edit_text,
            create_source == "null" and edit_source == "null",
            create["control"]["tag"] is None and submitted["create"] not in create_text and submitted["edit"] not in edit_text,
        ]
    else:
        checks = [
            create_text.endswith("http://example.com/alpha"),
            edit_text.endswith("ftp://example.com/beta") and reload["control"]["value"] == submitted["edit"],
            create_source.endswith("example.com/alpha") and "http://example.com/alpha" not in create_source,
            edit["control"]["value"] == submitted["create"],
        ]
    return checks

def delete_and_verify(site, fullname):
    page = site.page.get(fullname, raise_when_not_found=False)
    if page is None:
        return False
    page.destroy()
    wait_page(site, fullname, False)
    return True

def capture_run(site, plan, run_token):
    field = plan["field"]
    category = f"fw09scalar-{field}-{run_token}"
    template = f"{category}:_template"
    target = f"{category}:target"
    title = f"FW09 {field} scalar"
    template_created = False
    target_created = False
    cleanup = {"target_deleted": False, "template_deleted": False, "absence_verified": False}
    result = {
        "field": field,
        "surface_id": plan["surface_id"],
        "status": "blocked",
        "template_source": plan["template_source"],
        "fixture_identity": {"template": template, "target": target},
        "submitted_values": {"create": plan["create_submission"], "edit": plan["edit_submission"]},
        "controls": [{**control, "passed": False} for control in plan["controls"]],
        "cleanup": cleanup,
    }
    primary_error = None
    try:
        if site.page.get(template, raise_when_not_found=False) is not None or site.page.get(target, raise_when_not_found=False) is not None:
            raise RuntimeError("unique run-owned fixture already exists")
        site.page.publish(
            template,
            title=title + " template",
            source=plan["template_source"],
            comment="run-owned FW09 scalar field template",
            verify_source=True,
            post_save_visibility_attempts=5,
            post_save_visibility_interval=0.5,
        )
        template_created = True

        create_lock = lock(site, target)
        create_editor = editor_snapshot(create_lock, plan["field_name"])
        create_receipt = save_form(site, target, title, create_lock, create_editor, plan["field_name"], plan["create_submission"])
        target_created = True
        page = wait_page(site, target, True)
        create = {
            "control": create_editor["control"],
            "form_fields": create_editor["form_fields"],
            "field_fragment": create_editor["field_fragment"],
            "submitted_value": plan["create_submission"],
            "save_receipt": create_receipt,
            "saved_source": source_snapshot(page),
            "display": display_snapshot(target),
        }

        edit_lock = lock(site, target)
        edit_editor = editor_snapshot(edit_lock, plan["field_name"])
        edit_receipt = save_form(site, target, title, edit_lock, edit_editor, plan["field_name"], plan["edit_submission"])
        page = wait_page(site, target, True)
        edit = {
            "control": edit_editor["control"],
            "form_fields": edit_editor["form_fields"],
            "field_fragment": edit_editor["field_fragment"],
            "submitted_value": plan["edit_submission"],
            "save_receipt": edit_receipt,
            "saved_source": source_snapshot(page),
            "display": display_snapshot(target),
        }

        reload_lock = lock(site, target)
        reload_editor = editor_snapshot(reload_lock, plan["field_name"])
        page = wait_page(site, target, True)
        reload = {
            "control": reload_editor["control"],
            "form_fields": reload_editor["form_fields"],
            "field_fragment": reload_editor["field_fragment"],
            "saved_source": source_snapshot(page),
            "display": display_snapshot(target),
        }
        checks = control_results(field, create, edit, reload, result["submitted_values"])
        result.update({"create": create, "edit": edit, "reload": reload})
        result["controls"] = [{**control, "passed": passed} for control, passed in zip(plan["controls"], checks)]
        result["status"] = "observed" if all(checks) else "blocked"
        if not all(checks):
            result["blocker"] = "one or more independently evaluated controls did not hold"
    except Exception as exc:
        primary_error = exc
        result["blocker"] = f"{type(exc).__name__}: {exc}"
    finally:
        cleanup_errors = []
        if target_created:
            try:
                cleanup["target_deleted"] = delete_and_verify(site, target)
            except Exception as exc:
                cleanup_errors.append(f"target: {type(exc).__name__}: {exc}")
        if template_created:
            try:
                cleanup["template_deleted"] = delete_and_verify(site, template)
            except Exception as exc:
                cleanup_errors.append(f"template: {type(exc).__name__}: {exc}")
        try:
            cleanup["absence_verified"] = (
                site.page.get(target, raise_when_not_found=False) is None
                and site.page.get(template, raise_when_not_found=False) is None
            )
        except Exception as exc:
            cleanup_errors.append(f"absence: {type(exc).__name__}: {exc}")
        if cleanup_errors:
            result["status"] = "blocked"
            result["cleanup_errors"] = cleanup_errors
        if primary_error is not None and cleanup_errors:
            result["blocker"] += "; cleanup also failed"
    return result

def main():
    cases = json.load(sys.stdin)
    if cases.get("schema") != "wikidot.live.data-form.scalar-fields.cases.v1" or cases.get("site") != SITE:
        raise RuntimeError("unsupported cases fixture")
    username = os.environ.pop("WIKIDOT_USERNAME", None)
    password = os.environ.pop("WIKIDOT_PASSWORD", None)
    if not username or not password:
        raise RuntimeError("WIKIDOT_USERNAME and WIKIDOT_PASSWORD are required")
    config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
    run_token = f"{int(time.time())}-{os.getpid()}-{random.randrange(65536):04x}"
    with wikidot.Client(username=username, password=password, amc_config=config) as client:
        site = client.site.get(SITE)
        runs = [capture_run(site, plan, run_token) for plan in cases["field_runs"]]
    artifact = {
        "schema": "wikidot.live.data-form.scalar-fields.v1",
        "observed_at": "2026-08-10",
        "site": SITE,
        "actor": "authenticated account A through wikidot.py and Wikidot Ajax Module Connector public page lifecycle requests",
        "credential_material": "none",
        "surface_ids": [plan["surface_id"] for plan in cases["field_runs"]],
        "field_runs": runs,
        "routes": [
            "Authenticated PageEditModule create and edit controls",
            "Authenticated WikiPageAction savePage submissions",
            "Authenticated wikidot.py saved-source readback",
            "Anonymous saved-page GET display and reload",
            "Authenticated identity-scoped target and template deletion followed by absence readback",
        ],
        "redactions": ["WIKIDOT_USERNAME", "WIKIDOT_PASSWORD", "WIKIDOT_SESSION_ID", "wikidot_token7", "PageEditModule lock credentials"],
        "cleanup": {
            "verified": all(run["cleanup"]["absence_verified"] for run in runs),
            "remaining_pages": [
                identity
                for run in runs
                for identity in run["fixture_identity"].values()
                if not run["cleanup"]["absence_verified"]
            ],
        },
    }
    json.dump(artifact, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")

main()
`;

const args = parseArgs(process.argv.slice(2));
const caseBytes = await readFile(args.cases);
const cases = JSON.parse(caseBytes);
const result = spawnSync(
  "/home/roku/src/Rokurolize/wikidot.py/.venv/bin/python",
  ["-c", pythonCapture],
  {input: caseBytes, encoding: "utf8", env: process.env, maxBuffer: 16 * 1024 * 1024},
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const artifact = JSON.parse(result.stdout);
artifact.cases_fixture = {
  path: args.cases,
  sha256: createHash("sha256").update(caseBytes).digest("hex"),
};
await writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
console.log(JSON.stringify({output: args.output, field_statuses: Object.fromEntries(artifact.field_runs.map((run) => [run.field, run.status])), cleanup: artifact.cleanup}));
