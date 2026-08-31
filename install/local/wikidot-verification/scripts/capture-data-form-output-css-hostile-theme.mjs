#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const verifierRoot = new URL("../", import.meta.url);
const defaultCases = new URL("fixtures/data-form-output-css-hostile-theme/cases.json", verifierRoot);
const defaultOutput = new URL("artifacts/data-form-output-css-hostile-theme-live-20260810.json", verifierRoot);

function parseArgs(argv) {
  const args = {cases: fileURLToPath(defaultCases), output: fileURLToPath(defaultOutput)};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--cases", "--output"].includes(option)) {
      throw new Error("usage: capture-data-form-output-css-hostile-theme.mjs [--cases FILE] [--output FILE]");
    }
    args[option.slice(2)] = value;
  }
  return args;
}

const pythonCapture = String.raw`
import hashlib
import json
import os
import random
import sys
import time
from datetime import datetime, timezone

import httpx
import wikidot
from bs4 import BeautifulSoup
from wikidot.connector.ajax import AjaxModuleConnectorConfig

SITE = "sandbox-for-codex"
ORIGIN = "http://sandbox-for-codex.wikidot.com"

def wait_page(site, fullname, present):
    for _ in range(12):
        page = site.page.get(fullname, raise_when_not_found=False)
        if (page is not None) == present:
            return page
        time.sleep(0.5)
    raise RuntimeError(f"page visibility did not settle for {fullname}")

def class_tokens(node):
    return list(node.get("class", [])) if node else []

def selected_node(node):
    if node is None:
        return None
    selected = {
        "tag": node.name,
        "classes": class_tokens(node),
        "text": node.get_text(" ", strip=True),
    }
    for attribute in ("type", "name", "value"):
        value = node.get(attribute)
        if value is not None:
            selected[attribute] = value
    return selected

def form_snapshot(response, field_names):
    body = response.get("body")
    if not isinstance(body, str):
        raise RuntimeError("PageEditModule omitted its body")
    soup = BeautifulSoup(body, "html.parser")
    form = soup.select_one("form#edit-page-form.data-form")
    table = form.select_one("table.form-table") if form else None
    if form is None or table is None:
        raise RuntimeError("PageEditModule did not expose a data-form table")
    rows = []
    for row in table.select("tr"):
        labels = row.select_one("td.form-labels")
        values = row.select_one("td.form-values")
        wrapper = values.select_one(".form-value") if values else None
        control = next((form.select_one(f'[name="field-{name}"]') for name in field_names if form.select_one(f'[name="field-{name}"]') and form.select_one(f'[name="field-{name}"]') in row.descendants), None)
        rows.append({
            "tag": row.name,
            "classes": class_tokens(row),
            "label_cell": selected_node(labels),
            "label": selected_node(labels.select_one(".form-label") if labels else None),
            "value_cell": selected_node(values),
            "value_wrapper": selected_node(wrapper),
            "control": selected_node(control),
        })
    fields = {}
    for name in field_names:
        control = form.select_one(f'[name="field-{name}"]')
        wrapper = form.select_one(f".form-value.field-{name}")
        fields[name] = {"control": selected_node(control), "wrapper": selected_node(wrapper)}
    form_fields = form.select_one('[name="form-fields"]')
    page_id = form.select_one('[name="page_id"]')
    return {
        "form_tag": form.name,
        "form_classes": class_tokens(form),
        "table_tag": table.name,
        "table_classes": class_tokens(table),
        "rows": rows,
        "fields": fields,
        "form_fields": form_fields.get("value", "") if form_fields else "",
        "page_id": page_id.get("value", "") if page_id else "",
        "error_nodes": [selected_node(node) for node in form.select(".form-error, .form-message")],
    }

def response_error_snapshot(response):
    body = response.get("body")
    if not isinstance(body, str):
        return {"response_status": response.get("status"), "nodes": [], "body_present": False}
    soup = BeautifulSoup(body, "html.parser")
    nodes = [selected_node(node) for node in soup.select(".form-error, .form-message")]
    return {"response_status": response.get("status"), "nodes": nodes, "body_present": True}

def display_snapshot(fullname, css_source):
    response = httpx.get(f"{ORIGIN}/{fullname}", follow_redirects=False, timeout=30.0, trust_env=False)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    content = soup.select_one("#page-content")
    if content is None:
        raise RuntimeError("saved page omitted #page-content")
    rows = []
    for row in content.select("table.form-table tr"):
        labels = row.select_one("td.form-labels")
        values = row.select_one("td.form-values")
        wrapper = values.select_one(".form-value") if values else None
        rows.append({
            "classes": class_tokens(row),
            "label_cell": selected_node(labels),
            "label": selected_node(labels.select_one(".form-label") if labels else None),
            "value_cell": selected_node(values),
            "value_wrapper": selected_node(wrapper),
        })
    custom_spans = [selected_node(node) for node in content.select("span.normal, span.critical")]
    style = next((node for node in soup.select("style") if ".normal" in node.get_text()), None)
    return {
        "status_code": response.status_code,
        "content_text": content.get_text(" ", strip=True),
        "table": selected_node(content.select_one("table.form-table")),
        "rows": rows,
        "custom_output_spans": custom_spans,
        "error_nodes": [selected_node(node) for node in content.select(".form-error, .form-message")],
        "emitted_css_fragment": {
            "tag": style.name if style else None,
            "attributes": dict(style.attrs) if style else {},
            "source": style.get_text().strip() if style else None,
            "contains_exact_authored_source": css_source in style.get_text() if style else False,
        },
    }

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

def save_attempt(site, fullname, title, edit_response, editor, values, comment):
    request = {
        "action": "WikiPageAction",
        "event": "savePage",
        "moduleName": "Empty",
        "mode": "page",
        "lock_id": edit_response["lock_id"],
        "lock_secret": edit_response["lock_secret"],
        "revision_id": edit_response.get("page_revision_id") or "",
        "wiki_page": fullname,
        "page_id": editor["page_id"],
        "title": title,
        "source": "",
        "comments": comment,
        "form-use": "true",
        "form-fields": editor["form_fields"],
    }
    request.update({f"field-{name}": value for name, value in values.items()})
    response = site.amc_request([request])[0].json()
    return response, {
        "action": "WikiPageAction",
        "event": "savePage",
        "module_name": "Empty",
        "field_names": sorted(values),
        "status": response.get("status"),
        "revision_id": response.get("revisionId"),
    }

def source_snapshot(page):
    page.refresh_source()
    return page.source.wiki_text

def storage_snapshot(source, values):
    return {"saved_source": source, "submitted_raw_values": values}

def delete_and_verify(site, fullname):
    page = site.page.get(fullname, raise_when_not_found=False)
    if page is None:
        return False
    page.destroy()
    wait_page(site, fullname, False)
    return True

def cleanup_preflight(site, fullname):
    if site.page.get(fullname, raise_when_not_found=False) is not None:
        raise RuntimeError("cleanup preflight fullname already exists")
    site.page.publish(
        fullname,
        title="FW18 cleanup preflight",
        source="run-owned cleanup preflight",
        comment="run-owned FW18 cleanup preflight",
        verify_source=True,
        post_save_visibility_attempts=5,
        post_save_visibility_interval=0.5,
    )
    wait_page(site, fullname, True)
    deleted = delete_and_verify(site, fullname)
    return {"fullname": fullname, "created": True, "deleted": deleted, "absence_verified": site.page.get(fullname, raise_when_not_found=False) is None}

def has_structural_hooks(snapshot, field_names):
    if snapshot.get("table_tag") != "table" or "form-table" not in snapshot.get("table_classes", []):
        return False
    rows = snapshot.get("rows", [])
    if not rows or not all("form-row" in row["classes"] for row in rows):
        return False
    if not all(row["label_cell"] and "form-labels" in row["label_cell"]["classes"] for row in rows):
        return False
    if not all(row["label"] and "form-label" in row["label"]["classes"] for row in rows):
        return False
    if not all(row["value_cell"] and "form-values" in row["value_cell"]["classes"] for row in rows):
        return False
    for name in field_names:
        field = snapshot["fields"].get(name)
        if not field or not field["wrapper"] or f"field-{name}" not in field["wrapper"]["classes"]:
            return False
        if field["control"] and not any(token.startswith("form-") and token != "form-control" for token in field["control"]["classes"]):
            return False
    return True

def display_roles_not_exchanged(snapshot):
    rows = snapshot.get("rows", [])
    return bool(rows) and all(
        "form-values" not in row["label_cell"]["classes"]
        and "form-labels" not in row["value_cell"]["classes"]
        for row in rows
    )

def wrapper_tag(snapshot, field_name):
    for row in snapshot.get("rows", []):
        wrapper = row.get("value_wrapper")
        if wrapper and f"field-{field_name}" in wrapper.get("classes", []):
            return wrapper.get("tag")
    return None

def evaluate_rules(cases, fixtures):
    output = next(item for item in fixtures if item["fixture_id"] == "output-style")
    structure = next(item for item in fixtures if item["fixture_id"] == "css-structure")
    create_span = output["create_display"]["custom_output_spans"][0] if output["create_display"]["custom_output_spans"] else None
    edit_span = output["reload"]["display"]["custom_output_spans"][0] if output["reload"]["display"]["custom_output_spans"] else None
    structure_create = structure["create_form"]
    structure_edit = structure["edit_form"]
    create_display = structure["create_display"]
    edit_display = structure["reload"]["display"]
    rule_checks = {
        "raw-key-versus-display-label": [
            bool(create_span and "normal" in create_span["classes"] and create_span["text"] == "Normal"),
            bool(edit_span and "critical" in edit_span["classes"] and edit_span["text"] == "Critical"),
            bool(create_span and "Normal" not in create_span["classes"] and edit_span and "Critical" not in edit_span["classes"]),
            bool(create_span and create_span["text"] != "normal" and edit_span and edit_span["text"] != "critical"),
        ],
        "documented-form-css-structure": [
            has_structural_hooks(structure_create, ["headline", "bodycopy", "fixednote"]),
            has_structural_hooks(structure_edit, ["headline", "bodycopy", "fixednote"]),
            display_roles_not_exchanged(create_display) and display_roles_not_exchanged(edit_display),
            wrapper_tag(create_display, "headline") == "span" and wrapper_tag(create_display, "bodycopy") == "div" and wrapper_tag(create_display, "fixednote") == "div",
        ],
        "validation-state-hook": [
            bool(structure["invalid_create"]["error_snapshot"]["nodes"]),
            bool(structure["invalid_edit"]["error_snapshot"]["nodes"]),
            not structure["create_form"]["error_nodes"] and not structure["create_display"]["error_nodes"],
            not structure["reload"]["form"]["error_nodes"] and not structure["reload"]["display"]["error_nodes"],
        ],
        "hostile-theme-server-dom-stability": [
            bool(create_span and "normal" in create_span["classes"] and has_structural_hooks(structure_create, ["headline", "bodycopy", "fixednote"])),
            bool(edit_span and "critical" in edit_span["classes"] and has_structural_hooks(structure_edit, ["headline", "bodycopy", "fixednote"])),
            bool(create_span and "Normal" not in create_span["classes"] and edit_span and "Critical" not in edit_span["classes"]),
            has_structural_hooks(structure_create, ["headline", "bodycopy", "fixednote"]) and has_structural_hooks(structure_edit, ["headline", "bodycopy", "fixednote"]),
        ],
    }
    evaluated = []
    for rule in cases["rules"]:
        checks = rule_checks[rule["rule_id"]]
        evaluated.append({
            "rule_id": rule["rule_id"],
            "optional": rule.get("optional", False),
            "controls": [{**control, "passed": passed} for control, passed in zip(rule["controls"], checks)],
        })
    return evaluated

def capture_fixture(site, plan, css_source, run_token):
    category = f"fw18-{plan['fixture_id']}-{run_token}"
    template = f"{category}:_template"
    target = f"{category}:target"
    title = f"FW18 {plan['fixture_id']}"
    field_names = [field["name"] for field in plan["fields"]]
    cleanup = {"target_deleted": False, "template_deleted": False, "absence_verified": False}
    result = {
        "fixture_id": plan["fixture_id"],
        "template_source": plan["template_source"],
        "fixture_identity": {"template": template, "target": target},
        "authored_css_source": css_source,
        "cleanup": cleanup,
    }
    template_created = False
    target_created = False
    try:
        if site.page.get(template, raise_when_not_found=False) is not None or site.page.get(target, raise_when_not_found=False) is not None:
            raise RuntimeError("unique run-owned fixture already exists")
        site.page.publish(
            template,
            title=title + " template",
            source=plan["template_source"],
            comment="run-owned FW18 hostile CSS template",
            verify_source=True,
            post_save_visibility_attempts=5,
            post_save_visibility_interval=0.5,
        )
        template_created = True

        create_lock = lock(site, target)
        create_form = form_snapshot(create_lock, field_names)
        invalid_response, invalid_receipt = save_attempt(site, target, title, create_lock, create_form, plan["invalid_values"], "run-owned FW18 invalid create")
        invalid_create = {
            "request": invalid_receipt,
            "error_snapshot": response_error_snapshot(invalid_response),
            "target_absent_after_attempt": site.page.get(target, raise_when_not_found=False) is None,
        }

        create_lock = lock(site, target)
        create_form_after_invalid = form_snapshot(create_lock, field_names)
        create_response, create_receipt = save_attempt(site, target, title, create_lock, create_form_after_invalid, plan["create_values"], "run-owned FW18 valid create")
        if create_response.get("status") != "ok":
            raise RuntimeError(f"valid create failed with status {create_response.get('status')!r}")
        target_created = True
        page = wait_page(site, target, True)
        create_source = source_snapshot(page)
        create_display = display_snapshot(target, css_source)

        edit_lock = lock(site, target)
        edit_form = form_snapshot(edit_lock, field_names)
        invalid_response, invalid_receipt = save_attempt(site, target, title, edit_lock, edit_form, plan["invalid_values"], "run-owned FW18 invalid edit")
        page = wait_page(site, target, True)
        invalid_edit = {
            "request": invalid_receipt,
            "error_snapshot": response_error_snapshot(invalid_response),
            "saved_source_unchanged": source_snapshot(page) == create_source,
        }

        edit_lock = lock(site, target)
        edit_form_after_invalid = form_snapshot(edit_lock, field_names)
        edit_response, edit_receipt = save_attempt(site, target, title, edit_lock, edit_form_after_invalid, plan["edit_values"], "run-owned FW18 valid edit")
        if edit_response.get("status") != "ok":
            raise RuntimeError(f"valid edit failed with status {edit_response.get('status')!r}")
        page = wait_page(site, target, True)
        edit_source = source_snapshot(page)
        edit_display = display_snapshot(target, css_source)

        reload_lock = lock(site, target)
        reload_form = form_snapshot(reload_lock, field_names)
        page = wait_page(site, target, True)
        reload_source = source_snapshot(page)
        reload_display = display_snapshot(target, css_source)

        result.update({
            "create_form": create_form,
            "invalid_create": invalid_create,
            "valid_create_submission": create_receipt,
            "create_saved_source": create_source,
            "create_storage": storage_snapshot(create_source, plan["create_values"]),
            "create_display": create_display,
            "edit_form": edit_form,
            "invalid_edit": invalid_edit,
            "valid_edit_submission": edit_receipt,
            "edit_saved_source": edit_source,
            "edit_storage": storage_snapshot(edit_source, plan["edit_values"]),
            "edit_display": edit_display,
            "reload": {"form": reload_form, "saved_source": reload_source, "display": reload_display},
            "emitted_css_fragment": reload_display["emitted_css_fragment"],
        })
    except Exception as exc:
        result["capture_error"] = f"{type(exc).__name__}: {exc}"
    finally:
        errors = []
        if target_created:
            try:
                cleanup["target_deleted"] = delete_and_verify(site, target)
            except Exception as exc:
                errors.append(f"target cleanup: {type(exc).__name__}: {exc}")
        if template_created:
            try:
                cleanup["template_deleted"] = delete_and_verify(site, template)
            except Exception as exc:
                errors.append(f"template cleanup: {type(exc).__name__}: {exc}")
        try:
            cleanup["absence_verified"] = site.page.get(target, raise_when_not_found=False) is None and site.page.get(template, raise_when_not_found=False) is None
        except Exception as exc:
            errors.append(f"absence verification: {type(exc).__name__}: {exc}")
            cleanup["absence_verified"] = False
        if errors:
            cleanup["errors"] = errors
    return result

def main():
    cases = json.load(sys.stdin)
    if cases.get("schema") != "wikidot.live.data-form.output-css-hostile-theme.cases.v1" or cases.get("site") != SITE:
        raise RuntimeError("unsupported cases fixture")
    username = os.environ.pop("WIKIDOT_USERNAME", None)
    password = os.environ.pop("WIKIDOT_PASSWORD", None)
    if not username or not password:
        raise RuntimeError("account environment is required")
    config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
    run_token = f"{int(time.time())}-{os.getpid()}-{random.randrange(65536):04x}"
    fixture_results = []
    preflight = None
    blocked_reason = None
    missing_authority = None
    with wikidot.Client(username=username, password=password, amc_config=config) as client:
        site = client.site.get(SITE)
        preflight_name = f"fw18-cleanup-preflight-{run_token}"
        try:
            preflight = cleanup_preflight(site, preflight_name)
            if not preflight["deleted"] or not preflight["absence_verified"]:
                raise RuntimeError("public page deletion preflight did not restore absence")
            for plan in cases["fixtures"]:
                fixture_result = capture_fixture(site, plan, cases["hostile_css_source"], run_token)
                fixture_results.append(fixture_result)
                if "capture_error" in fixture_result or not fixture_result["cleanup"]["absence_verified"]:
                    break
        except Exception as exc:
            blocked_reason = f"{type(exc).__name__}: {exc}"
            missing_authority = "complete public setup, observation, validation, or cleanup route"
    complete_fixtures = len(fixture_results) == len(cases["fixtures"])
    cleanup_verified = bool(preflight and preflight["absence_verified"]) and all(item["cleanup"]["absence_verified"] for item in fixture_results)
    evaluated_rules = evaluate_rules(cases, fixture_results) if complete_fixtures else []
    required_rules_pass = complete_fixtures and all(
        all(control["passed"] for control in rule["controls"])
        for rule in evaluated_rules
        if not rule["optional"]
    )
    if not required_rules_pass and blocked_reason is None:
        blocked_reason = "one or more required server-side controls did not hold"
        missing_authority = "required live server distinction"
    status = "observed" if required_rules_pass and cleanup_verified else "blocked"
    promoted = [rule for rule in evaluated_rules if all(control["passed"] for control in rule["controls"])] if status == "observed" else []
    artifact = {
        "schema": "wikidot.live.data-form.output-css-hostile-theme.v1",
        "status": status,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "site": SITE,
        "surface_ids": cases["surface_ids"],
        "actor_labels": {"mutation": "account-a", "saved_page_read": "anonymous"},
        "credential_material": "none",
        "public_interfaces": [
            "edit/PageEditModule",
            "WikiPageAction savePage",
            "wikidot.py public page source read",
            "anonymous saved-page HTTP GET",
            "wikidot.py public page deletion and absence readback",
        ],
        "hostile_css": {"source": cases["hostile_css_source"], "sha256": hashlib.sha256(cases["hostile_css_source"].encode()).hexdigest()},
        "fixtures": fixture_results,
        "promoted_rules": promoted,
        "server_dom_claims": [
            "selected server-emitted element kinds, class tokens, hierarchy, raw stored values, display labels, validation nodes, and authored CSS source only"
        ] if status == "observed" else [],
        "browser_computed_claims": [],
        "attempted_public_routes": ["PageEditModule", "WikiPageAction savePage", "saved source read", "anonymous page GET", "page deletion"],
        "cleanup_preflight": preflight,
        "cleanup": {
            "verified": cleanup_verified,
            "remaining_pages": [
                fullname
                for item in fixture_results
                if not item["cleanup"]["absence_verified"]
                for fullname in item["fixture_identity"].values()
            ],
        },
        "blocked_reason": blocked_reason if status == "blocked" else None,
        "missing_authority": missing_authority if status == "blocked" else None,
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
  {input: caseBytes, encoding: "utf8", env: process.env, maxBuffer: 32 * 1024 * 1024},
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const artifact = JSON.parse(result.stdout);
artifact.evidence_identity = {
  cases_sha256: createHash("sha256").update(caseBytes).digest("hex"),
  capture_script_sha256: createHash("sha256").update(scriptBytes).digest("hex"),
};
await writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
console.log(JSON.stringify({output: args.output, status: artifact.status, cleanup: artifact.cleanup}));
