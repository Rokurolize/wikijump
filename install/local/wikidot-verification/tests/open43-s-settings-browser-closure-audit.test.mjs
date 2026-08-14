import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { historicalSha256 } from "./historical-git.mjs";

const repository = new URL("../../../../", import.meta.url);

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repository), "utf8"));
}

async function sha256(relativePath) {
  const contents = await readFile(new URL(relativePath, repository));
  return createHash("sha256").update(contents).digest("hex");
}

test("settings and browser closure audit is complete without promoting candidate work to pass", async () => {
  const audit = await json(
    "docs/development/open43-s-settings-browser-closure-audit.json",
  );
  assert.equal(audit.schema, "wikijump.open43.s_settings_browser_closure_audit.v1");
  assert.deepEqual(audit.scope.issues, [610, 689, 690, 754, 755, 757, 758, 822, 1046]);
  assert.equal(audit.scope.issue_count, 9);
  assert.equal(audit.source_identity.standing_is_acceptance_evidence, false);
  assert.equal(
    audit.source_identity.observed_integration_head,
    "a1dee171237de66bbf1b6e45ec55b5f6584cf34a",
  );
  assert.equal(
    audit.source_identity.observed_integration_tree,
    "69cd2a08ab345dd58571f0f6f594d0e45f57b367",
  );
  assert.equal(audit.source_identity.final_source_freeze_reconciliation_required, true);

  for (const input of [
    ...audit.input_manifests,
    ...audit.specification_inputs,
  ]) {
    assert.equal(
      historicalSha256(audit.source_identity.observed_integration_head, input.path),
      input.sha256,
      `${input.path} changed after the audit froze its identity`,
    );
  }

  const referentPath = audit.classification_contract.referent_table_path;
  assert.equal(
    await sha256(referentPath),
    audit.classification_contract.referent_table_sha256,
  );
  assert.equal(
    await sha256(audit.source_residual_lane.referent_table_path),
    audit.source_residual_lane.referent_table_sha256,
  );
  assert.equal(
    await sha256(audit.source_residual_lane.seam_map_path),
    audit.source_residual_lane.seam_map_sha256,
  );
  assert.equal(audit.source_residual_lane.cargo_executed, false);

  const allowed = new Set([
    "source_ready",
    "needs_source",
    "candidate_required",
    "blocked_evidence",
  ]);
  const issueNumbers = audit.issues.map(({ issue }) => issue);
  assert.deepEqual(issueNumbers, audit.scope.issues);

  const rows = audit.issues.flatMap(({ issue, subrows }) =>
    subrows.map((row) => ({ issue, ...row })),
  );
  const caseIds = rows.map(({ case_id }) => case_id);
  assert.equal(new Set(caseIds).size, caseIds.length);
  assert.equal(rows.every(({ classification }) => allowed.has(classification)), true);
  const commandIds = new Set(Object.keys(audit.central_commands));
  const evidenceIds = new Set(Object.keys(audit.evidence_registry));
  for (const row of rows) {
    for (const evidenceId of row.evidence_ids ?? []) {
      assert.equal(
        evidenceIds.has(evidenceId),
        true,
        `${row.case_id} references unknown evidence ${evidenceId}`,
      );
    }
    for (const commandId of row.next_command_ids ?? []) {
      assert.equal(
        commandIds.has(commandId),
        true,
        `${row.case_id} references unknown command ${commandId}`,
      );
    }
  }

  const classificationCounts = Object.fromEntries(
    [...allowed].map((classification) => [
      classification,
      rows.filter((row) => row.classification === classification).length,
    ]),
  );
  assert.equal(audit.reconciliation.subrow_count, rows.length);
  assert.equal(audit.reconciliation.issue_count, audit.issues.length);
  assert.deepEqual(audit.reconciliation.classification_counts, classificationCounts);
  assert.equal(classificationCounts.needs_source, 0);
  assert.equal(audit.reconciliation.issue_owned_needs_source_count, 0);
  assert.equal(audit.candidate_harness_gap.classification, "needs_source");
  assert.equal(audit.candidate_harness_gap.outside_source_residual_scope, true);
  assert.equal(audit.candidate_harness_gap.blocker_kind, "blocked_missing_disposable_autonumber_allocator_owner");
  assert.deepEqual(audit.candidate_harness_gap.case_ids, ["S758_CREATE_INITIAL", "S758_CREATE_SETTLED"]);
  assert.deepEqual(audit.candidate_harness_gap.required_commands, []);

  const rowsByCaseId = new Map(rows.map((row) => [row.case_id, row]));
  const fragmentHref = rowsByCaseId.get(
    "B610_FRAGMENT_DOUBLE_HASH_PUBLIC_REGRESSION",
  );
  assert.ok(fragmentHref);
  assert.equal(fragmentHref.classification, "source_ready");
  assert.deepEqual(fragmentHref.implementation_commits, [
    "89dc1cd7b702915e6d7007bc9e3bee67342d5f28",
  ]);
  assert.equal(audit.central_commands.C_DEEPWELL_FRAGMENT_HREF.exists_now, true);
  assert.match(
    audit.central_commands.C_DEEPWELL_FRAGMENT_HREF.command,
    /wikidot_fragment_only_double_hash_href_survives_preview_and_saved_page/u,
  );
  assert.equal("C_SETTINGS_IMPORT_EXPORT" in audit.central_commands, false);
  assert.equal("C_SETTINGS_BROWSER_CANDIDATE" in audit.central_commands, false);
  assert.equal("C_LEGACY_ADMIN_ROUTE" in audit.central_commands, false);
  assert.equal(audit.central_commands.C_SETTINGS_CANDIDATE.exists_now, true);
  assert.match(
    audit.central_commands.C_SETTINGS_CANDIDATE.command,
    /candidate-cases -- --case-set open43-settings-browser/u,
  );
  assert.equal(
    audit.central_commands.C_SETTINGS_CANDIDATE.requirements.includes(
      "sealed exact non-443 scpaiueouiuiuiui.wikijump.localhost candidate",
    ),
    true,
  );
  const reversibleSettingsCases = [
    "S754_ANALYTICS_INITIAL",
    "S754_ANALYTICS_SETTLED",
    "S755_THEME_INITIAL",
    "S755_THEME_SETTLED",
    "S757_TOOLBAR_INITIAL",
    "S757_TOOLBAR_SETTLED",
    "S1046_ADMIN_INITIAL",
    "S1046_ADMIN_SETTLED",
    "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
  ];
  assert.deepEqual(audit.central_commands.C_SETTINGS_CANDIDATE.coverage_case_ids, reversibleSettingsCases);
  const sharedSettingsRows = [...reversibleSettingsCases.slice(0, 6), "S1046_LEGACY_ADMIN_ROUTE", ...reversibleSettingsCases.slice(6)];
  assert.deepEqual(rows.filter(({ next_command_ids: ids = [] }) => ids.includes("C_SETTINGS_CANDIDATE")).map(({ case_id }) => case_id), sharedSettingsRows);
  assert.deepEqual(rowsByCaseId.get("S1046_LEGACY_ADMIN_ROUTE").next_command_ids, ["C_NODE_SETTINGS", "C_SETTINGS_CANDIDATE"]);
  for (const caseId of ["S758_CREATE_INITIAL", "S758_CREATE_SETTLED"]) {
    const row = rowsByCaseId.get(caseId);
    assert.equal(row.classification, "candidate_required");
    assert.equal(row.blocker_kind, "blocked_missing_disposable_autonumber_allocator_owner");
    assert.deepEqual(row.next_command_ids, []);
  }

  const adminSettled = rowsByCaseId.get("S1046_ADMIN_SETTLED");
  const autocomplete = rowsByCaseId.get("S1046_AUTOCOMPLETE_AND_INTERMEDIATE_FRAMES");
  assert.equal(adminSettled.acceptance.includes("cancel"), false);
  assert.equal(autocomplete.acceptance.includes("cancel"), true);

  for (const caseId of [
    "S754_IMPORT_EXPORT_REPRESENTATION",
    "S1046_IMPORT_EXPORT_REPRESENTATION",
  ]) {
    const row = rowsByCaseId.get(caseId);
    assert.ok(row);
    assert.equal(row.classification, "blocked_evidence");
    assert.equal(row.blocker_kind, "missing_export_contract");
    assert.deepEqual(row.next_command_ids, []);
  }

  for (const pair of audit.temporal_evidence_contract.pairs) {
    const initial = rows.find(({ case_id }) => case_id === pair.initial_case_id);
    const settled = rows.find(({ case_id }) => case_id === pair.settled_case_id);
    assert.ok(initial, `${pair.pair_id} is missing its initial case`);
    assert.ok(settled, `${pair.pair_id} is missing its settled case`);
    assert.equal(initial.classification, "candidate_required");
    assert.equal(settled.classification, "candidate_required");
    assert.notEqual(pair.initial_artifact, pair.settled_artifact);
    assert.match(pair.initial_artifact, /initial/u);
    assert.match(pair.settled_artifact, /settled/u);
  }

  assert.equal(audit.reconciliation.duplicate_case_ids, 0);
  assert.equal(audit.reconciliation.unknown_classifications, 0);
  assert.equal(audit.reconciliation.closure_claims, 0);
  assert.equal("renderer_epoch_coordination" in audit, false);
  assert.equal(audit.renderer_epoch_finalization.classification, "source_ready");
  assert.equal(audit.renderer_epoch_finalization.current_epoch, 10);
  assert.equal(audit.renderer_epoch_finalization.epoch_source, "deepwell/src/services/render/generator.rs");
  assert.equal(audit.renderer_epoch_finalization.required_bump_count, 2);
  assert.equal(audit.renderer_epoch_finalization.completed_bump_count, 2);
  assert.equal(
    audit.renderer_epoch_finalization.current_epoch_introduced_by.source_commit,
    "f9e092610e542ad645c0eec3e8c0ef0c4e7e7a6a",
  );
  assert.equal(
    audit.renderer_epoch_finalization.current_epoch_introduced_by.source_tree,
    "4d3b1c633df8b2f07a0aa017b65058e1defcd3cb",
  );
  assert.equal(
    audit.renderer_epoch_finalization.current_epoch_introduced_by
      .integration_commit_reconciliation_required,
    false,
  );
  assert.equal(
    audit.renderer_epoch_finalization.post_epoch_source
      .source_freeze_bump_required,
    false,
  );
});
