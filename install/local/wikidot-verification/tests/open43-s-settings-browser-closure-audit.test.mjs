import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

  for (const input of [
    ...audit.input_manifests,
    ...audit.specification_inputs,
  ]) {
    assert.equal(
      await sha256(input.path),
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
  assert.equal(audit.candidate_harness_gap.outside_source_residual_scope, true);

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
});
