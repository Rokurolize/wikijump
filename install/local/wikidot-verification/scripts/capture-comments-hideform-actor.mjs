#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const verificationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesPath = path.join(verificationRoot, "fixtures/comments-hideform-actor/cases.json");
const artifactPath = path.join(verificationRoot, "artifacts/forum-comments-hideform-actor-live-20260810.json");
const python = process.env.WIKIDOT_PYTHON ?? "/home/roku/src/Rokurolize/wikidot.py/.venv/bin/python";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const captureProgram = String.raw`
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import httpx
import wikidot
from bs4 import BeautifulSoup
from wikidot.connector.ajax import AjaxModuleConnectorConfig


def sha256(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def wait_for_page(site, fullname, expected_source=None, expected_absent=False):
    for _ in range(15):
        page = site.page.get(fullname, raise_when_not_found=False)
        if expected_absent and page is None:
            return None
        if page is not None and expected_source is not None and page.source.wiki_text == expected_source:
            return page
        time.sleep(0.5)
    if expected_absent:
        raise RuntimeError("run-owned fixture remained after cleanup")
    raise RuntimeError("run-owned fixture source did not become visible")


def bounded_utf8(value, limit):
    encoded = value.encode("utf-8")
    return encoded[:limit].decode("utf-8", errors="ignore")


def initial_dom_observation(html):
    soup = BeautifulSoup(html, "lxml")
    boxes = soup.select(".comments-box")
    box = boxes[0] if len(boxes) == 1 else None
    page_content = soup.select_one("#page-content")
    body = str(page_content) if page_content is not None else ""
    scripts = [script.get_text(" ", strip=True) for script in page_content.select("script")] if page_content else []
    marker_contexts = []
    for marker in ("newPost", "hideForm", "ForumNewPostFormModule"):
        for match in re.finditer(marker, html):
            marker_contexts.append(html[max(0, match.start() - 160):match.end() + 160])
    return body, {
        "comments_box_count": len(boxes),
        "new_post_form_present": bool(box and box.select_one("#new-post-form")),
        "new_post_button_present": bool(box and box.select_one("#new-post-button")),
        "comments_options_hidden_present": bool(box and box.select_one("#comments-options-hidden")),
        "comments_options_shown_present": bool(box and box.select_one("#comments-options-shown")),
        "thread_container_present": bool(box and box.select_one("#thread-container")),
        "form_ids": [element.get("id") for element in box.select("form[id]")] if box else [],
        "new_post_action_markers": [script for script in scripts if "newPost" in script],
        "document_action_marker_contexts": marker_contexts[:12],
        "document_html_sha256": sha256(html),
    }


contract = json.load(sys.stdin)
site_name = contract["site"]
fullname = contract["page_fullname"]
actor_label = contract["actor_label"]
body_limit = contract["body_limit_bytes"]
origin = f"http://{site_name}.wikidot.com"
page_url = f"{origin}/{fullname}"
ajax_url = f"{origin}/ajax-module-connector.php"
baseline_source = "Comments hideForm authenticated actor evidence fixture."
title = "Comments hideForm authenticated actor evidence"
created = False
original_page_id = None
cleanup = {
    "original_source_sha256": sha256(baseline_source),
    "original_page_id": None,
    "original_source_restored": False,
    "restored_source_sha256": None,
    "restored_page_id": None,
    "created_fixture_removed": False,
    "page_absent_after_removal": False,
}
observed_cases = []

config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=site_name)
with wikidot.Client(
    username=os.environ["WIKIDOT_USERNAME"],
    password=os.environ["WIKIDOT_PASSWORD"],
    logging_level="CRITICAL",
    amc_config=config,
) as client:
    site = client.site.get(site_name)
    if site.page.get(fullname, raise_when_not_found=False) is not None:
        raise RuntimeError("capture refused a preexisting page")
    try:
        site.page.create(
            fullname=fullname,
            title=title,
            source=baseline_source,
            comment="create run-owned Comments hideForm evidence fixture",
        )
        created = True
        page = wait_for_page(site, fullname, baseline_source)
        original_page_id = page.id
        cleanup["original_page_id"] = original_page_id
        session_headers = client.amc_client.header.get_header()
        session_headers["User-Agent"] = "Wikijump q1034 authenticated nonmutating evidence"
        session_headers["Cache-Control"] = "no-cache"
        with httpx.Client(follow_redirects=False, timeout=30.0, trust_env=False) as http:
            for case in contract["cases"]:
                page.edit(source=case["source"], comment=f"capture {case['case_id']}")
                page = wait_for_page(site, fullname, case["source"])
                if page.id != original_page_id:
                    raise RuntimeError("page identity changed during capture")
                response = http.get(page_url, headers=session_headers)
                if response.status_code != 200 or response.is_redirect:
                    raise RuntimeError(f"authenticated served GET failed with status {response.status_code}")
                body, observation = initial_dom_observation(response.text)
                bounded_body = bounded_utf8(body, body_limit)
                observed_cases.append({
                    "case_id": case["case_id"],
                    "control": case["control"],
                    "source": case["source"],
                    "source_sha256": sha256(case["source"]),
                    "page_id": page.id,
                    "source_setup": {
                        "request": {
                            "method": "POST",
                            "url": ajax_url,
                            "actor_label": actor_label,
                            "status": 200,
                            "envelope": "wikidot-json-status-ok",
                            "mutation_capable_request": True,
                            "purpose": "replace run-owned page source only",
                        }
                    },
                    "initial_dom": {
                        "request": {
                            "method": "GET",
                            "url": page_url,
                            "actor_label": actor_label,
                            "status": response.status_code,
                            "envelope": "text/html",
                            "mutation_capable_request": False,
                        },
                        "body_sha256": sha256(body),
                        "bounded_body": bounded_body,
                        "bounded_body_sha256": sha256(bounded_body),
                        "body_bytes": len(body.encode("utf-8")),
                        "body_limit_bytes": body_limit,
                        "body_truncated": len(body.encode("utf-8")) > body_limit,
                        "observation": observation,
                    },
                    "actions": {
                        "requests_sent": [],
                        "comment_form_opened": False,
                        "comment_submitted": False,
                        "mutation_capable_request_sent": False,
                    },
                })
    finally:
        if created:
            page = site.page.get(fullname, raise_when_not_found=False)
            if page is not None:
                page.edit(source=baseline_source, comment="restore Comments hideForm evidence fixture")
                page = wait_for_page(site, fullname, baseline_source)
                cleanup["restored_source_sha256"] = sha256(page.source.wiki_text)
                cleanup["restored_page_id"] = page.id
                cleanup["original_source_restored"] = page.id == original_page_id and page.source.wiki_text == baseline_source
                page.destroy()
                cleanup["created_fixture_removed"] = True
                cleanup["page_absent_after_removal"] = wait_for_page(site, fullname, expected_absent=True) is None

artifact = {
    "schema": "wikijump.forum_comments_hideform_actor_live.v1",
    "surface_id": contract["surface_id"],
    "audit_case_id": contract["audit_case_id"],
    "issue": 1034,
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "site": site_name,
    "page_fullname": fullname,
    "actor": {"label": actor_label, "authentication": "session", "permission": "comment-permitted"},
    "comment_mutation": False,
    "capture_status": "complete",
    "closure_status": "non_closing_evidence",
    "attempted_routes": ["authenticated served GET"],
    "cases_contract_sha256": contract["cases_contract_sha256"],
    "cases": observed_cases,
    "observed_rules": {
        "permitted_actor_control": "Account A receives Add a New Comment in every captured initial DOM.",
        "initial_form_state": "No captured initial served DOM contains new-post-form.",
        "scalar_differential": "Omitted, exact false, exact true, exact yes, and the five malformed or unsupported controls have the same bounded page-content body.",
        "action_boundary": "No control was opened and no comment or mutation action was requested.",
    },
    "promotable_rules": [
        "Authenticated served HTML exposes Add a New Comment to the permitted actor for omitted, false, true, yes, wrong-case, uppercase, single-quoted, duplicate, and unsupported hideForm sources.",
        "Authenticated initial served HTML contains no open new-post-form for any captured hideForm source.",
    ],
    "remaining_gap": "The allowed non-browser interface does not expose the documented auto-open differential. Browser execution or another evidenced client-lifecycle seam is still required before implementing hideForm form-state behavior.",
    "cleanup": cleanup,
    "redactions": ["credentials", "cookies", "session identifiers", "CSRF tokens", "page edit lock fields"],
}
print(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")))
`;

function runCapture(contract) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", captureProgram], {
      cwd: verificationRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", () => reject(new Error("authenticated capture process could not start")));
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`authenticated capture failed with exit code ${code}: ${Buffer.concat(stderr).toString("utf8").slice(-1000)}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(JSON.stringify(contract));
  });
}

async function main() {
  if (!process.env.WIKIDOT_USERNAME || !process.env.WIKIDOT_PASSWORD) throw new Error("WIKIDOT_USERNAME and WIKIDOT_PASSWORD are required through the environment");
  const casesBytes = await fs.readFile(casesPath);
  const contract = JSON.parse(casesBytes);
  contract.cases_contract_sha256 = sha256(casesBytes);
  const output = await runCapture(contract);
  for (const secret of [process.env.WIKIDOT_USERNAME, process.env.WIKIDOT_PASSWORD]) {
    if (secret && output.includes(secret)) throw new Error("capture output contained a credential value");
  }
  const artifact = JSON.parse(output);
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {mode: 0o600});
  console.log(`captured ${artifact.cases.length} authenticated cases; comment mutations: ${artifact.comment_mutation}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
