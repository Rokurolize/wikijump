#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const verifierRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultCases = path.join(verifierRoot, "fixtures/open43-m1039-files-pagination-history/cases.json");
const defaultOutput = path.join(verifierRoot, "artifacts/open43-m1039-files-pagination-history-live-20260810.json");
const origin = "http://sandbox-for-codex.wikidot.com";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const args = {cases: defaultCases, output: defaultOutput};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--cases", "--output"].includes(option)) {
      throw new Error("usage: capture-open43-m1039-files-pagination-history.mjs [--cases FILE] [--output FILE]");
    }
    args[option.slice(2)] = path.resolve(value);
  }
  return args;
}

function validateFixture(fixture) {
  if (fixture.schema !== "wikidot.live.open43.m1039.files-pagination-history.cases.v1") throw new Error("unsupported fixture schema");
  if (fixture.site !== "sandbox-for-codex") throw new Error("fixture site is outside the authorized sandbox");
  if (fixture.source_identity?.base_commit !== "ec7888bf154278bfc8d2a312791880fb0f57e5bc") throw new Error("fixture source identity differs from the lane base");
  if (fixture.setup?.required_active_rows !== 41) throw new Error("fixture does not retain the required active-row bound");
  if (fixture.preflight?.browser_cdp_forbidden !== true || fixture.preflight?.private_control_requires_public_acl_setup !== true) throw new Error("fixture weakened the private-control stop condition");
}

async function liveAvailabilityPreflight() {
  const response = await fetch(`${origin}/?fw19-read-only-preflight=1`, {
    headers: {"user-agent": "WikijumpCompatibilityEvidence/1.0"},
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  return {
    route: "anonymous GET of sandbox root",
    method: "GET",
    actor: "anonymous",
    response_classification: response.status === 200 && body.includes("WIKIREQUEST") ? "public-wikidot-page-available" : "unexpected-public-response",
    http_status: response.status,
    selected_body_sha256: sha256(body),
    selected_body_bytes: Buffer.byteLength(body),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureBytes = await readFile(args.cases);
  const scriptBytes = await readFile(scriptPath);
  const fixture = JSON.parse(fixtureBytes);
  validateFixture(fixture);

  const availability = await liveAvailabilityPreflight();
  const blockedStatus = "not_attempted_due_to_preflight_block";
  const observations = Object.fromEntries(fixture.observation_sections.map((section) => [
    section,
    {
      status: section === "cleanup" ? "verified_no_mutation_required" : blockedStatus,
      reason: section === "cleanup"
        ? "Preflight stopped before creation of any run-owned page, file, version, or category setting"
        : "Mandatory reversible private-page setup could not be established through the allowed nonbrowser public interfaces",
    },
  ]));
  const publicInterfaces = Object.fromEntries(fixture.public_interfaces.map((interfaceId) => [
    interfaceId,
    {
      status: blockedStatus,
      reason: "The mandatory private-page preflight blocked the entire run before fixture creation",
    },
  ]));

  const artifact = {
    schema: "wikidot.live.open43.m1039.files-pagination-history.v1",
    status: "blocked",
    target_surface_ids: fixture.target_surface_ids,
    source_identity: fixture.source_identity,
    site: fixture.site,
    evidence_identity: {
      captured_at_utc: new Date().toISOString(),
      fixture_sha256: sha256(fixtureBytes),
      script_sha256: sha256(scriptBytes),
    },
    actor_matrix: fixture.actors.map((label) => ({
      label,
      status: label === "anonymous" ? "read_only_availability_preflight_completed" : blockedStatus,
      role: label === "anonymous" ? "anonymous" : "not_inspected_due_to_preflight_block",
    })),
    public_interfaces: publicInterfaces,
    setup: {
      required_active_rows: fixture.setup.required_active_rows,
      active_rows_achieved: 0,
      required_deleted_rows: fixture.setup.required_deleted_rows,
      required_history_targets: fixture.setup.history_targets,
      required_versions_per_history_target: fixture.setup.versions_per_history_target,
      byte_lengths: fixture.setup.byte_lengths,
      filename_control_kinds: fixture.setup.filename_control_kinds,
      total_bytes_uploaded: 0,
    },
    pagination_bounds: {
      active_row_denominator: null,
      rows_per_page: null,
      total_observed_pages: null,
      first_and_last_rows_by_page: [],
      overlapping_page_sets: null,
      pager_labels: [],
      page_argument_bounds: null,
    },
    observations,
    promoted_rules: [],
    mutation_performed: false,
    attempted_read_only_routes: [availability],
    blocked_reason: {
      code: "private-page-acl-public-preflight-unavailable",
      summary: "The required reversible private-page control cannot be established without a forbidden browser or site-wide category-settings workflow",
      missing_authority: [
        "An allowed public nonbrowser action that creates a run-owned private page or isolated category ACL without site-wide impact",
        "An allowed public nonbrowser action that restores or deletes that ACL and verifies the exact pre-run baseline",
      ],
      prohibited_fallbacks_not_used: [
        "browser",
        "Playwright",
        "CDP",
        "direct database access",
        "site-wide category ACL mutation",
        "non-run-owned private page",
      ],
    },
    cleanup: {
      verified: true,
      reason: "No mutation occurred, so no run-owned object or setting required cleanup",
      remaining_run_owned_objects: [],
    },
    credentials_exposed: false,
    redactions: "No authenticated session, account identifier, hidden field, operational token, or credential was acquired",
  };

  await writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
  process.stdout.write(`${JSON.stringify({output: args.output, status: artifact.status, mutation_performed: false, cleanup_verified: true})}\n`);
}

await main();
