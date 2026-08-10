#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const verifierRoot = new URL("../", import.meta.url);
const defaultCases = new URL("fixtures/data-form-images-links-youtube/cases.json", verifierRoot);
const defaultOutput = new URL("artifacts/data-form-images-links-youtube-live-20260810.json", verifierRoot);
const accountHelper = "/home/roku/codex-consultant-20260517/scripts/wikidot_sandbox_accounts.py";

function parseArgs(argv) {
  const args = {cases: fileURLToPath(defaultCases), output: fileURLToPath(defaultOutput)};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--cases", "--output"].includes(option)) {
      throw new Error("usage: capture-data-form-images-links-youtube.mjs [--cases FILE] [--output FILE]");
    }
    args[option.slice(2)] = value;
  }
  return args;
}

function accountEnvironment() {
  const check = spawnSync("python3", [accountHelper, "check"], {encoding: "utf8"});
  if (check.status !== 0) {
    throw new Error("sandbox account store validation failed");
  }
  const exported = spawnSync("python3", [accountHelper, "env", "A"], {encoding: "utf8"});
  if (exported.status !== 0) {
    throw new Error("sandbox account A export failed");
  }
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
PHASES = [
    "create_form", "create_submission", "create_saved_source", "create_storage",
    "create_display", "edit_form", "edit_submission", "edit_saved_source",
    "edit_storage", "edit_display", "reload", "cleanup",
]

def phase_map(default_status, reason):
    return {name: {"status": default_status, "reason": reason} for name in PHASES}

def wait_absent(site, fullname):
    for _ in range(10):
        if site.page.get(fullname, raise_when_not_found=False) is None:
            return True
        time.sleep(0.5)
    return False

def selected_file_form(response):
    body = response.get("body")
    if not isinstance(body, str):
        raise RuntimeError("PageEditModule omitted its body")
    soup = BeautifulSoup(body, "html.parser")
    form = soup.select_one("form#edit-page-form.data-form")
    control = form.select_one('[name="field-image"]') if form else None
    if form is None or control is None:
        raise RuntimeError("PageEditModule omitted the expected data-form file control")
    return {
        "form": {
            "tag": form.name,
            "classes": list(form.get("class", [])),
            "method": form.get("method"),
            "enctype": form.get("enctype"),
            "action": form.get("action"),
        },
        "control": {
            "tag": control.name,
            "type": control.get("type"),
            "name": control.get("name"),
            "classes": list(control.get("class", [])),
            "accept": control.get("accept"),
        },
        "public_attachment_cleanup_action_exposed": False,
    }

def main():
    cases = json.load(sys.stdin)
    expected_ids = ["data-forms-images", "data-forms-links", "data-forms-youtube"]
    if cases.get("schema") != "wikidot.live.data-form.images-links-youtube.cases.v1":
        raise RuntimeError("unsupported cases fixture schema")
    if cases.get("site") != SITE or cases.get("surface_ids") != expected_ids:
        raise RuntimeError("unsupported site or surface selection")

    username = os.environ.pop("WIKIDOT_USERNAME", None)
    secret = os.environ.pop("WIKIDOT_PASSWORD", None)
    if not username or not secret:
        raise RuntimeError("account A environment is unavailable")

    run_token = f"{int(time.time())}-{os.getpid()}-{random.randrange(65536):04x}"
    category = f"fw17media-{run_token}"
    template = f"{category}:_template"
    target = f"{category}:target"
    template_created = False
    template_deleted = False
    image_form = None
    attempted_routes = []
    blocker = None
    config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)

    with wikidot.Client(username=username, password=secret, amc_config=config) as client:
        site = client.site.get(SITE)
        attempted_routes.append({"interface": "authenticated site lookup", "result": "account-a client established"})
        public = httpx.get(f"{ORIGIN}/", follow_redirects=False, timeout=30.0, trust_env=False)
        attempted_routes.append({"interface": "anonymous saved-site GET", "result": f"HTTP {public.status_code}"})
        if site.page.get(template, raise_when_not_found=False) is not None or site.page.get(target, raise_when_not_found=False) is not None:
            raise RuntimeError("unique run-owned preflight fixture already exists")
        template_source = "[[image %%form_raw{image}%%]]\n%%form_data{image}%%\n====\n[[form]]\nfields:\n  image:\n    label: Image\n    type: file\n[[/form]]"
        try:
            site.page.publish(
                template,
                title="FW17 image cleanup preflight",
                source=template_source,
                comment="run-owned FW17 image cleanup preflight",
                verify_source=True,
                post_save_visibility_attempts=5,
                post_save_visibility_interval=0.5,
            )
            template_created = True
            attempted_routes.append({"interface": "wikidot.py public page publish", "result": "run-owned template created"})
            edit = site.amc_request([{
                "mode": "page",
                "wiki_page": target,
                "moduleName": "edit/PageEditModule",
            }])[0].json()
            image_form = selected_file_form(edit)
            attempted_routes.append({"interface": "edit/PageEditModule", "result": "file control observed"})
            blocker = (
                "Image upload stopped at cleanup preflight: the live create form exposed the file control but no "
                "public attachment cleanup action for the separate storage page. The task forbids guessing a raw "
                "action or using a browser to discover it after mutation."
            )
        finally:
            if template_created:
                page = site.page.get(template, raise_when_not_found=False)
                if page is not None:
                    page.destroy()
                template_deleted = wait_absent(site, template)
                attempted_routes.append({"interface": "wikidot.py public page deletion", "result": "run-owned template absent" if template_deleted else "absence not verified"})

        remaining_pages = []
        for fullname in (template, target):
            if site.page.get(fullname, raise_when_not_found=False) is not None:
                remaining_pages.append(fullname)

    if blocker is None:
        blocker = "Image upload cleanup preflight did not reach a terminal classification"

    features = []
    for plan in cases["features"]:
        phases = phase_map("not_attempted", "lane stopped at image attachment cleanup preflight")
        if plan["feature"] == "images":
            phases["create_form"] = {
                "status": "observed",
                "actor": "account-a",
                "interface": "edit/PageEditModule",
                "selected": image_form,
            }
            phases["cleanup"] = {
                "status": "complete" if template_deleted and not remaining_pages else "incomplete",
                "template_deleted": template_deleted,
                "absence_verified": not remaining_pages,
            }
        else:
            phases["cleanup"] = {"status": "not_needed", "mutation_performed": False}
        features.append({
            "feature": plan["feature"],
            "surface_id": plan["surface_id"],
            "status": "blocked",
            "fixture_matrix": plan["matrix"],
            "attempted_rule": plan["attempted_rule"],
            "phases": phases,
            "observations_promoted": False,
        })

    artifact = {
        "schema": "wikidot.live.data-form.images-links-youtube.v1",
        "captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "site": SITE,
        "surface_ids": expected_ids,
        "actors": ["account-a", "anonymous"],
        "status": "blocked",
        "features": features,
        "promoted_rules": [],
        "public_interfaces_used": [
            "authenticated wikidot.py site and page lifecycle",
            "edit/PageEditModule",
            "anonymous HTTP GET",
        ],
        "attempted_routes": attempted_routes,
        "setup_progress": {
            "run_owned_template_created": template_created,
            "file_control_observed": image_form is not None,
            "upload_performed": False,
            "saved_data_form_pages_created": 0,
        },
        "blocked_reason": blocker,
        "missing_authority": "Exact public attachment deletion action for a data-form image's separate storage page before upload",
        "remote_media_fetches": [],
        "cleanup": {
            "verified": template_deleted and not remaining_pages,
            "remaining_pages": remaining_pages,
            "remaining_attachments": [],
            "run_owned_template_deleted": template_deleted,
        },
        "credentials_exposed": False,
    }
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
  path: args.cases,
  sha256: createHash("sha256").update(caseBytes).digest("hex"),
};
await writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
console.log(JSON.stringify({output: args.output, status: artifact.status, feature_statuses: Object.fromEntries(artifact.features.map((feature) => [feature.feature, feature.status])), cleanup: artifact.cleanup}));
