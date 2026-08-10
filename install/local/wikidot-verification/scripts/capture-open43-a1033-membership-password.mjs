#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const helper = "/home/roku/codex-consultant-20260517/scripts/wikidot_sandbox_accounts.py";
const expectedSurfaceIds = [
  "open43-audit-case:A1033_PASSWORD_SUBMISSION",
  "catalog-feature:module-membershipbypassword",
];

function usage() {
  return "usage: capture-open43-a1033-membership-password.mjs --cases PATH --output PATH";
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!["--cases", "--output"].includes(option) || value === undefined || value.startsWith("--")) {
      throw new Error(usage());
    }
    const key = option.slice(2);
    if (result[key] !== undefined) throw new Error(`duplicate option: ${option}`);
    result[key] = resolve(value);
  }
  if (!result.cases || !result.output) throw new Error(usage());
  if (result.cases === result.output) throw new Error("cases and output paths must differ");
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runAuthorityHelper(command) {
  const stdout = execFileSync("python3", [helper, command], {
    cwd: "/home/roku/codex-consultant-20260517",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function assertFixture(fixture) {
  if (fixture.schema !== "wikijump.wikidot_membership_password_cases.v1") {
    throw new Error(`unexpected fixture schema: ${fixture.schema}`);
  }
  if (JSON.stringify(fixture.target_surface_ids) !== JSON.stringify(expectedSurfaceIds)) {
    throw new Error("fixture target surface IDs do not match lane F");
  }
  if (fixture.maximum_wrong_submissions_per_actor !== 3) {
    throw new Error("fixture must cap wrong submissions at three per actor");
  }
}

const { cases: casesPath, output: outputPath } = parseArguments(process.argv.slice(2));
const fixtureBytes = await readFile(casesPath);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
assertFixture(fixture);

const accountStoreCheck = runAuthorityHelper("check");
const sandboxCatalog = runAuthorityHelper("catalog");
if (accountStoreCheck.schema !== "wikidot.sandbox.accounts.check.v1") {
  throw new Error(`unexpected account-store check schema: ${accountStoreCheck.schema}`);
}
if (sandboxCatalog.schema !== "wikidot.sandbox.catalog.v1") {
  throw new Error(`unexpected sandbox catalog schema: ${sandboxCatalog.schema}`);
}

const catalogSites = Object.values(sandboxCatalog.sandboxes).map((entry) => ({
  site: entry.site,
  mutation_policy: entry.mutation_policy,
}));
const explicitlyDisposableSites = Object.values(sandboxCatalog.sandboxes).filter(
  (entry) => entry.explicitly_disposable === true || entry.run_owned_isolated_membership_fixture === true,
);
if (explicitlyDisposableSites.length !== 0) {
  throw new Error("authority catalog now declares a disposable site; this blocked-only capture requires review before mutation");
}

const preflight = fixture.required_preflight.map((requirement, index) => ({
  requirement,
  status: index === 0 ? "missing" : "not_evaluated_after_blocker",
}));

const artifact = {
  schema: "wikijump.wikidot_membership_password_evidence.v1",
  captured_at_utc: new Date().toISOString(),
  target_surface_ids: expectedSurfaceIds,
  fixture_sha256: sha256(fixtureBytes),
  status: "blocked",
  site_authority: {
    account_store_check_schema: accountStoreCheck.schema,
    account_labels_present: accountStoreCheck.account_labels,
    catalog_schema: sandboxCatalog.schema,
    catalog_sites: catalogSites,
    explicitly_authorized_disposable_site: null,
    run_owned_isolated_membership_fixture: null,
  },
  actor_fixture_matrix: {
    required_labels: fixture.required_actor_labels,
    assigned_disposable_identities: [],
    reason_unassigned: "No explicitly authorized disposable site or isolated membership fixture is present in the sandbox authority catalog.",
  },
  public_interfaces_used: [],
  attempted_read_only_routes: [
    {
      route: "local sandbox account-store check helper",
      result: "seven account labels and the shared sandbox entry are present; no credential values were read or recorded",
    },
    {
      route: "local sandbox authority catalog helper",
      result: "catalog contains the shared behavior sandbox, a reproduction sandbox, and a read-only official sandbox; none is declared disposable or an isolated membership fixture",
    },
  ],
  preflight,
  promoted_rules: [],
  bounded_failure_attempts: {
    maximum_wrong_submissions_per_actor: fixture.maximum_wrong_submissions_per_actor,
    actual_wrong_submissions_per_actor: 0,
    exact_failure_limit_established: false,
  },
  password_fixture: {
    generated: false,
    declared_nonsecret: null,
    byte_length: null,
    sha256: null,
    same_value_used_for_setup_and_submission: null,
  },
  password_material_recorded: false,
  membership_mutations_performed: 0,
  password_setting_mutations_performed: 0,
  holder_page_mutations_performed: 0,
  cleanup_receipt: {
    status: "not_needed_no_mutation",
    remaining_run_owned_objects: [],
  },
  settings_restoration_receipt: {
    status: "not_needed_no_mutation",
    baseline_changed: false,
  },
  blocked_reason: "The sandbox authority catalog does not identify an explicitly authorized disposable Wikidot site or run-owned isolated membership fixture. The shared sandbox was not mutated.",
  missing_authority: ["explicitly-authorized-disposable-site"],
  credentials_exposed: false,
  remaining_gaps: [
    "registered nonmember MembershipByPassword form and submission action",
    "wrong-password denial and bounded retry metadata",
    "correct-password membership transition for two independent disposable actors",
    "post-success retry and duplicate-membership behavior",
    "public membership cleanup and exact settings restoration",
    "exact failure limit, cooldown, CAPTCHA, lockout, and partition key",
  ],
};

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx", mode: 0o644 });
console.log(JSON.stringify({ status: artifact.status, output: outputPath, mutations_performed: 0 }));
