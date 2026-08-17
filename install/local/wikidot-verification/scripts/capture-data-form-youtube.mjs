#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const verifierRoot = new URL("../", import.meta.url);
const defaultCases = new URL("fixtures/data-form-youtube/cases.json", verifierRoot);
const defaultOutput = new URL("artifacts/data-form-youtube-live-20260817.json", verifierRoot);
const defaultCasesReference =
  "install/local/wikidot-verification/fixtures/data-form-youtube/cases.json";
const accountHelper = "/home/roku/codex-consultant-20260517/scripts/wikidot_sandbox_accounts.py";

function parseArgs(argv) {
  const args = {cases: fileURLToPath(defaultCases), output: fileURLToPath(defaultOutput)};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--cases", "--output"].includes(option)) {
      throw new Error("usage: capture-data-form-youtube.mjs [--cases FILE] [--output FILE|-]");
    }
    args[option.slice(2)] = value;
  }
  return args;
}

function accountEnvironment() {
  const check = spawnSync("python3", [accountHelper, "check"], {encoding: "utf8"});
  if (check.status !== 0) throw new Error("sandbox account store validation failed");
  const exported = spawnSync("python3", [accountHelper, "env", "A"], {encoding: "utf8"});
  if (exported.status !== 0) throw new Error("sandbox account A export failed");
  const credentials = {};
  for (const line of exported.stdout.split("\n")) {
    const match = line.match(/^export (WIKIDOT_(?:USERNAME|PASSWORD))=(?:'((?:[^']|'"'"')*)'|"([^"]*)"|(.*))$/);
    if (!match) continue;
    credentials[match[1]] = (match[2] ?? match[3] ?? match[4] ?? "").replaceAll("'\"'\"'", "'");
  }
  if (!credentials.WIKIDOT_USERNAME || !credentials.WIKIDOT_PASSWORD) {
    throw new Error("sandbox account A is incomplete");
  }
  return {...process.env, ...credentials};
}

const pythonCapture = String.raw`
import json
import os
import random
import sys
import time

import httpx
import wikidot
from bs4 import BeautifulSoup
from wikidot.connector.ajax import AjaxModuleConnectorConfig

SITE = "sandbox-for-codex"
ORIGIN = "http://sandbox-for-codex.wikidot.com"

def wait_page(site, fullname, present):
    for _ in range(30):
        page = site.page.get(fullname, raise_when_not_found=False)
        if (page is not None) == present:
            return page
        time.sleep(0.5)
    raise RuntimeError(f"page visibility did not settle for {fullname}")

def page_is_absent(fullname):
    last_error = None
    for _ in range(5):
        try:
            response = httpx.get(
                f"{ORIGIN}/{fullname}/norender/true/noredirect/true",
                follow_redirects=False,
                timeout=30.0,
                trust_env=False,
            )
            return response.status_code == 404
        except httpx.TransportError as exc:
            last_error = exc
            time.sleep(0.5)
    raise last_error

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

def editor_snapshot(response, field_name):
    body = response.get("body")
    if not isinstance(body, str):
        raise RuntimeError("PageEditModule omitted its body")
    soup = BeautifulSoup(body, "html.parser")
    form = soup.select_one("form#edit-page-form.data-form")
    if form is None:
        raise RuntimeError("PageEditModule did not expose a data form")
    control = form.select_one(f'[name="field-{field_name}"]')
    if control is None:
        raise RuntimeError("PageEditModule omitted the wiki field control")
    form_fields = form.select_one('[name="form-fields"]')
    page_id = form.select_one('[name="page_id"]')
    return {
        "form_class": " ".join(form.get("class", [])),
        "form_fields": form_fields.get("value", "") if form_fields else None,
        "page_id": page_id.get("value", "") if page_id else None,
        "control": {
            "tag": control.name,
            "classes": list(control.get("class", [])),
            "rows": control.get("rows"),
            "cols": control.get("cols"),
            "text": control.get_text(),
        },
    }

def save_form(site, fullname, title, edit_response, editor, field_name, submitted):
    response = site.amc_request([{
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
        "comments": "run-owned data-form YouTube evidence",
        "form-use": "true",
        "form-fields": editor["form_fields"] or "",
        f"field-{field_name}": submitted,
    }])[0].json()
    if response.get("status") != "ok":
        raise RuntimeError(f"savePage failed with status {response.get('status')!r}")
    return {"status": response["status"], "revision_id": response.get("revisionId")}

def source_snapshot(page):
    page.refresh_source()
    return page.source.wiki_text

def display_snapshot(fullname):
    response = httpx.get(f"{ORIGIN}/{fullname}", follow_redirects=False, timeout=30.0, trust_env=False)
    response.raise_for_status()
    content = BeautifulSoup(response.text, "html.parser").select_one("#page-content")
    if content is None:
        raise RuntimeError("saved page omitted #page-content")
    data_control = content.select_one(".form-data-control")
    return {
        "html": str(content),
        "visible_text": content.get_text(" ", strip=True),
        "iframes": [dict(frame.attrs) for frame in content.select("iframe")],
        "form_data_control_html": str(data_control) if data_control else None,
        "contains_raw_outside_wrapper_literal": "[[div class=\"form-raw-outside\"]]" in str(content),
    }

def html_block_boundary_snapshot(fullname):
    response = httpx.get(f"{ORIGIN}/{fullname}", follow_redirects=False, timeout=30.0, trust_env=False)
    response.raise_for_status()
    content = BeautifulSoup(response.text, "html.parser").select_one("#page-content")
    if content is None:
        raise RuntimeError("saved boundary page omitted #page-content")
    frames = content.select("iframe")
    direct = len(frames) == 1 and "html-block-iframe" not in frames[0].get("class", [])
    return {
        "iframes": [dict(frame.attrs) for frame in frames],
        "direct": direct,
    }

def delete_and_verify(site, fullname):
    page = site.page.get(fullname, raise_when_not_found=False)
    if page is None:
        return page_is_absent(fullname)
    try:
        page.destroy()
    except Exception:
        # ListPages-backed lookups can briefly retain a deleted page after the
        # direct page endpoint is already 404. Treat that exact terminal state
        # as successful cleanup and re-raise every other failure.
        if page_is_absent(fullname):
            return True
        raise
    for _ in range(30):
        if page_is_absent(fullname):
            return True
        time.sleep(0.5)
    raise RuntimeError(f"direct page endpoint did not become 404 for {fullname}")

def main():
    cases = json.load(sys.stdin)
    if cases.get("schema") != "wikidot.live.data-form.youtube.cases.v1" or cases.get("site") != SITE:
        raise RuntimeError("unsupported cases fixture")
    username = os.environ.pop("WIKIDOT_USERNAME", None)
    password = os.environ.pop("WIKIDOT_PASSWORD", None)
    if not username or not password:
        raise RuntimeError("sandbox account A environment is unavailable")

    run_token = f"dfyt-{int(time.time())}-{os.getpid()}-{random.randrange(65536):04x}"
    template = f"{run_token}:_template"
    target = f"{run_token}:target"
    cleanup = {
        "target_deleted": False,
        "template_deleted": False,
        "boundary_pages_deleted": False,
        "boundary_pages": [],
        "absence_verified": False,
    }
    artifact = {
        "schema": "wikidot.live.data-form.youtube.v1",
        "captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "site": SITE,
        "surface_id": cases["surface_id"],
        "actor": "account-a",
        "fixture_identity": {"template": template, "target": target},
        "template_source": cases["template_source"],
        "submitted_values": {"create": cases["create_submission"], "edit": cases["edit_submission"]},
        "remote_media_fetches": [],
        "credentials_exposed": False,
        "cleanup": cleanup,
    }
    config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
    template_created = False
    target_created = False
    boundary_pages = []
    primary_error = None
    with wikidot.Client(username=username, password=password, amc_config=config) as client:
        site = client.site.get(SITE)
        try:
            if site.page.get(template, raise_when_not_found=False) is not None or site.page.get(target, raise_when_not_found=False) is not None:
                raise RuntimeError("unique run-owned fixture already exists")
            site.page.publish(
                template,
                title="Data-form YouTube evidence template",
                source=cases["template_source"],
                comment="run-owned data-form YouTube evidence template",
                verify_source=True,
                post_save_visibility_attempts=5,
                post_save_visibility_interval=0.5,
            )
            template_created = True

            create_lock = lock(site, target)
            create_editor = editor_snapshot(create_lock, cases["field_name"])
            create_receipt = save_form(site, target, "Data-form YouTube evidence", create_lock, create_editor, cases["field_name"], cases["create_submission"])
            target_created = True
            page = wait_page(site, target, True)
            artifact["create"] = {
                "editor": create_editor,
                "save_receipt": create_receipt,
                "saved_source": source_snapshot(page),
                "display": display_snapshot(target),
            }

            edit_lock = lock(site, target)
            edit_editor = editor_snapshot(edit_lock, cases["field_name"])
            edit_receipt = save_form(site, target, "Data-form YouTube evidence", edit_lock, edit_editor, cases["field_name"], cases["edit_submission"])
            page = wait_page(site, target, True)
            artifact["edit"] = {
                "editor": edit_editor,
                "save_receipt": edit_receipt,
                "saved_source": source_snapshot(page),
                "display": display_snapshot(target),
            }

            reload_lock = lock(site, target)
            artifact["reload"] = {
                "editor": editor_snapshot(reload_lock, cases["field_name"]),
                "saved_source": source_snapshot(page),
                "display": display_snapshot(target),
            }
            artifact["html_block_boundary"] = []
            for index, boundary_case in enumerate(cases["html_block_boundary_cases"], start=1):
                # Keep these probes outside the run's data-form category so
                # its category template cannot alter the HTML-block boundary being
                # observed.
                boundary_page = f"{run_token}-html-boundary-{index}"
                site.page.publish(
                    boundary_page,
                    title=f"HTML iframe boundary {boundary_case['name']}",
                    source=f"[[html]]\n{boundary_case['source']}\n[[/html]]",
                    comment="run-owned HTML iframe boundary evidence",
                    verify_source=True,
                    post_save_visibility_attempts=5,
                    post_save_visibility_interval=0.5,
                )
                boundary_pages.append(boundary_page)
                artifact["html_block_boundary"].append({
                    "name": boundary_case["name"],
                    "source": boundary_case["source"],
                    "expected_direct": boundary_case["direct"],
                    "display": html_block_boundary_snapshot(boundary_page),
                })
            artifact["status"] = "observed"
        except Exception as exc:
            primary_error = exc
            artifact["status"] = "blocked"
            artifact["blocker"] = f"{type(exc).__name__}: {exc}"
        finally:
            cleanup_errors = []
            boundary_cleanup = []
            for boundary_page in reversed(boundary_pages):
                try:
                    deleted = delete_and_verify(site, boundary_page)
                    boundary_cleanup.append({"page": boundary_page, "deleted": deleted})
                except Exception as exc:
                    boundary_cleanup.append({"page": boundary_page, "deleted": False})
                    cleanup_errors.append(f"boundary {boundary_page}: {type(exc).__name__}: {exc}")
            cleanup["boundary_pages"] = list(reversed(boundary_cleanup))
            cleanup["boundary_pages_deleted"] = (
                len(boundary_cleanup) == len(cases["html_block_boundary_cases"])
                and all(item["deleted"] for item in boundary_cleanup)
            )
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
                    page_is_absent(target)
                    and page_is_absent(template)
                    and all(page_is_absent(boundary_page) for boundary_page in boundary_pages)
                )
            except Exception as exc:
                cleanup_errors.append(f"absence: {type(exc).__name__}: {exc}")
            if cleanup_errors:
                artifact["status"] = "blocked"
                artifact["cleanup_errors"] = cleanup_errors
                if primary_error is not None:
                    artifact["blocker"] += "; cleanup also failed"

    json.dump(artifact, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")

main()
`;

const args = parseArgs(process.argv.slice(2));
const caseBytes = await readFile(args.cases);
JSON.parse(caseBytes);
const result = spawnSync(
  "/home/roku/.codex/skills/wikidot-py-operations/scripts/wikidot-python",
  ["-c", pythonCapture],
  {input: caseBytes, encoding: "utf8", env: accountEnvironment(), maxBuffer: 16 * 1024 * 1024},
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const artifact = JSON.parse(result.stdout);
artifact.cases_fixture = {
  path: args.cases === fileURLToPath(defaultCases) ? defaultCasesReference : args.cases,
  sha256: createHash("sha256").update(caseBytes).digest("hex"),
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (args.output === "-") {
  process.stdout.write(serialized);
} else {
  await writeFile(args.output, serialized, {flag: "wx"});
  console.log(JSON.stringify({output: args.output, status: artifact.status, cleanup: artifact.cleanup}));
}
