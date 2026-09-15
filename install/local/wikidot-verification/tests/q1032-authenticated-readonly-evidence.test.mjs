import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  OPEN43_Q1032_EVIDENCE,
  verifyOpen43Q1032ReadOnlyEvidence,
} from "../src/open43-q1032-members-userinfo-candidate-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures/q1032-authenticated-readonly.json");
const artifactPath = path.join(root, "artifacts/q1032-authenticated-readonly-live-20260915.json");
const capturePath = path.join(root, "scripts/capture_q1032_authenticated_readonly.py");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha256Text = (value) => sha256(Buffer.from(value, "utf8"));
const sha256Pattern = /^[0-9a-f]{64}$/u;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("Q1032 read-only evidence seals populated Watchers and WhoInvited role/privacy observations", () => {
  const fixtureBytes = readFileSync(fixturePath);
  const captureBytes = readFileSync(capturePath);
  const artifactBytes = readFileSync(artifactPath);
  const fixture = JSON.parse(fixtureBytes);
  const artifact = readJson(artifactPath);

  assert.equal(sha256(artifactBytes), OPEN43_Q1032_EVIDENCE.readonly.artifact.sha256);
  assert.equal(sha256(fixtureBytes), OPEN43_Q1032_EVIDENCE.readonly.fixture.sha256);
  assert.equal(sha256(captureBytes), OPEN43_Q1032_EVIDENCE.readonly.capture_script.sha256);

  assert.deepEqual(verifyOpen43Q1032ReadOnlyEvidence(artifact, fixture), {
    verified: true,
    watchers_rows: 20,
    whoinvited_requests: 16,
    bounded_actor_matrix: true,
    general_privacy_contract: false,
    rename_delete_import_invalidation: false,
  });

  assert.equal(artifact.schema, "wikijump.q1032.authenticated_readonly_live.v1");
  assert.equal(artifact.base_commit, fixture.base_commit);
  assert.equal(artifact.residual_id, "Q1032_REMAINING_DIRECTORY_RUNTIME");
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes));
  assert.equal(artifact.capture_script_sha256, sha256(captureBytes));
  assert.equal(artifact.disposition, "observed");
  assert.equal(artifact.mutated, false);
  assert.equal(artifact.mutation_count, 0);
  assert.equal(artifact.acquisition.retained_cache_hit, false);
  assert.equal(artifact.acquisition.browser_used, false);
  assert.equal(artifact.budgets.actual_state_changing_requests, 0);

  const watchers = artifact.watchers;
  assert.deepEqual(watchers.actor, {label: "anonymous", authenticated: false});
  assert.equal(watchers.source.site, "scp-wiki");
  assert.equal(watchers.source.slug, "workbench:deadlinks");
  assert.equal(watchers.source.page_id, 1307187511);
  assert.equal(watchers.source.revision_id, 1360445658);
  assert.equal(watchers.source.revision_number, 1);
  assert.equal(watchers.source.module_call, fixture.watchers.source_module_call);
  assert.equal(sha256Text(watchers.source.source_wikitext), watchers.source.source_wikitext_sha256);
  assert.equal(watchers.source.source_wikitext.includes(fixture.watchers.source_module_call), true);
  assert.deepEqual(watchers.render_request, {
    method: "GET",
    url: "https://scp-wiki.wikidot.com/workbench:deadlinks",
    redirects_followed: 0,
    browser_used: false,
  });
  assert.equal(watchers.render_response.status, 200);
  assert.match(watchers.render_response.content_type, /^text\/html\b/iu);
  assert.equal(watchers.render_response.final_url, watchers.render_request.url);
  assert.deepEqual(watchers.render_response.redirect_chain, []);
  assert.match(watchers.render_response.raw_body_sha256, sha256Pattern);
  assert.match(watchers.render_response.page_content_html_sha256, sha256Pattern);
  assert.equal(watchers.render_response.selected_selector, fixture.watchers.selector);
  assert.equal(watchers.render_response.selected_style, "display:none");
  assert.equal(watchers.navigation_label, "Watchers");
  assert.equal(sha256Text(watchers.render_response.selected_html), watchers.render_response.selected_html_sha256);
  assert.deepEqual(watchers.rows, fixture.watchers.expected_rows);
  assert.equal(watchers.rows.length, 20);
  assert.equal(new Set(watchers.rows.map(({user_id: userId}) => userId)).size, 20);
  for (const row of watchers.rows) {
    assert.equal(watchers.render_response.selected_html.includes(row.public_name), true);
    assert.equal(watchers.render_response.selected_html.includes(row.href), true);
    assert.equal(watchers.render_response.selected_html.includes(row.onclick), true);
  }

  const whoinvited = artifact.whoinvited;
  assert.equal(whoinvited.site, "sandbox-for-codex");
  assert.equal(whoinvited.module_name, fixture.whoinvited.module_name);
  assert.deepEqual(whoinvited.actor_matrix, [
    {
      label: "anonymous",
      authenticated: false,
      public_user_id: null,
      public_name: null,
      observed_site_roles: [],
    },
    {
      label: "account_A",
      authenticated: true,
      public_user_id: 8955132,
      public_name: "scpaiueouiuiuiui",
      observed_site_roles: ["member", "administrator"],
    },
    {
      label: "account_B",
      authenticated: true,
      public_user_id: 10382659,
      public_name: "voted-fated-smuggler",
      observed_site_roles: ["member"],
    },
    {
      label: "account_C",
      authenticated: true,
      public_user_id: 10382670,
      public_name: "lambert-eggman",
      observed_site_roles: ["member", "moderator"],
    },
  ]);

  const expectedGroups = ["", "moderators", "admins"];
  assert.deepEqual(whoinvited.role_reads.map(({group}) => group), expectedGroups);
  for (const roleRead of whoinvited.role_reads) {
    assert.equal(roleRead.actor, "account_A");
    assert.equal(roleRead.request.method, "POST");
    assert.equal(roleRead.request.url, "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php");
    assert.deepEqual(roleRead.request.ordered_fields, [
      ["moduleName", "membership/MembersListModule"],
      ["page", 1],
      ["group", roleRead.group],
    ]);
    assert.equal(roleRead.response.status_code, 200);
    assert.equal(roleRead.response.envelope.status, "ok");
    assert.match(roleRead.response.raw_response_sha256, sha256Pattern);
    assert.deepEqual(
      roleRead.member_identities.map(({user_id: userId}) => userId),
      fixture.whoinvited.role_membership[roleRead.group || "members"],
    );
  }

  const expectedBodies = new Map([
    [8955132, ["no-data", "6a88540fe42d12c0f5d8d8ab499af1e0aaeb971cf5821b6c0930a1c8ae9e111d"]],
    [5700026, ["password-provenance", "91c30deecc4a022faf7be34ad3a441600909a490d018494f139d91bcec72f259"]],
    [10382659, ["invitation-provenance", "e57c65bdf9c323d9d59dbeef4f324fb1a1127ffb7cbbb618d49789e62382034c"]],
    [10382670, ["invitation-provenance", "f878cff4db59ec9efdce2e0cc1d54329c01ad33c0fdfe4048dac09e9ab9bdd98"]],
  ]);
  assert.equal(whoinvited.requests.length, 16);
  for (const requestRecord of whoinvited.requests) {
    const targetId = requestRecord.target.user_id;
    const expected = expectedBodies.get(targetId);
    assert.ok(expected, `unexpected WhoInvited target ${targetId}`);
    assert.equal(requestRecord.request.method, "POST");
    assert.equal(requestRecord.request.url, "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php");
    assert.deepEqual(requestRecord.request.ordered_fields, [
      ["moduleName", "wiki/invitations/WhoInvitedResultsModule"],
      ["userId", targetId],
    ]);
    assert.equal(requestRecord.request.connector_managed_fields_omitted, true);
    assert.equal(requestRecord.response.status_code, 200);
    assert.match(requestRecord.response.content_type, /^text\/plain\b/iu);
    assert.match(requestRecord.response.raw_response_sha256, sha256Pattern);
    assert.equal(requestRecord.response.envelope.status, "ok");
    const body = requestRecord.response.envelope.body;
    assert.equal(typeof body, "string");
    assert.equal(requestRecord.response.body_sha256, sha256Text(body));
    assert.equal(requestRecord.response.body_sha256, expected[1]);
    assert.equal(requestRecord.response.body_bytes, Buffer.byteLength(body, "utf8"));
    assert.equal(requestRecord.result_kind, expected[0]);
    assert.equal(requestRecord.target.public_name, fixture.whoinvited.targets.find(({user_id: id}) => id === targetId).public_name);
  }

  for (const target of fixture.whoinvited.targets) {
    const targetRecords = whoinvited.requests.filter(({target: observed}) => observed.user_id === target.user_id);
    assert.equal(targetRecords.length, 4);
    assert.equal(new Set(targetRecords.map(({response}) => response.body_sha256)).size, 1);
    assert.equal(new Set(targetRecords.map(({result_kind: resultKind}) => resultKind)).size, 1);
  }
  assert.deepEqual(whoinvited.actor_differential, {
    actors_compared: 4,
    targets_compared: 4,
    targets_with_differing_module_bodies: 0,
    conclusion: "No anonymous versus authenticated role differential was observed for these four WhoInvited targets.",
    scope_limit: "This is a bounded observation, not a general privacy rule; no broader actor or target state is inferred.",
  });

  assert.equal(artifact.privacy.raw_credentials_persisted, 0);
  assert.equal(artifact.privacy.raw_session_cookie_headers_persisted, 0);
  assert.equal(artifact.privacy.connector_managed_auth_fields_persisted, 0);
  assert.equal(artifact.privacy.private_fields_captured, false);
  assert.equal(artifact.rule_boundaries.general_privacy_contract_established, false);
  assert.equal(artifact.rule_boundaries.rename_delete_import_invalidation_observed, false);
  assert.equal(artifact.rule_boundaries.rename_delete_import_invalidation_inferred, false);

  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["WIKIDOT_SESSION_ID", "Set-Cookie", "Authorization", "wikidot_token7"]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden secret-bearing field: ${forbidden}`);
  }

  for (const field of ["general_privacy_contract_established", "rename_delete_import_invalidation_observed", "rename_delete_import_invalidation_inferred"]) {
    const widened = structuredClone(artifact);
    widened.rule_boundaries[field] = true;
    assert.throws(
      () => verifyOpen43Q1032ReadOnlyEvidence(widened, fixture),
      /claims|observation|infers/u,
      `Q1032 verifier must reject widened ${field}`,
    );
  }
});
