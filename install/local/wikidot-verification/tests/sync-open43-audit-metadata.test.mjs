import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOpen43AuditMetadata } from "../scripts/sync-open43-audit-metadata.mjs";

const auditPath = "docs/development/audit.json";
const routingPath = "docs/development/open43-blocked-evidence-routing.json";
const reconciliationPath =
  "docs/development/open43-closure-audit-ownership-reconciliation.json";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-audit-sync-"));
  await fs.mkdir(path.join(root, "docs/development"), { recursive: true });
  await fs.writeFile(
    path.join(root, auditPath),
    `${JSON.stringify({
      issues: [
        {
          number: 10,
          source_ready: [{ case_id: "READY" }],
          needs_source: [],
          candidate_required: [{ case_id: "CANDIDATE" }],
          blocked_evidence: [{ case_id: "BLOCKED" }],
        },
      ],
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(root, routingPath),
    `${JSON.stringify({
      schema: "wikijump.open43.blocked_evidence_routing.v1",
      source_audits: [auditPath],
      route_classes: { local_candidate: "fixture" },
      counts: { local_candidate: 2, total: 2 },
      rows: [
        { case_id: "BLOCKED", route_class: "local_candidate", status: "not_attempted_not_safe", reason: "fixture" },
        { case_id: "RESOLVED", route_class: "local_candidate", status: "not_attempted_not_safe", reason: "stale" },
      ],
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(root, reconciliationPath),
    `${JSON.stringify({
      schema: "wikijump.open43.closure_audit_ownership_reconciliation.v1",
      authoritative_manifests: [],
      closure_audits: [{ path: auditPath, sha256: "0".repeat(64), source_revision: "1".repeat(40) }],
      after: { case_count: 4, unique_case_count: 4, duplicate_case_ids: [], classification_counts: {} },
      validation: { committed_inventory_verifier: { status: "pass", case_count: 4, blocked_routing_count: 2 } },
    }, null, 2)}\n`,
  );
  return root;
}

test("audit metadata sync prunes only resolved routes and recomputes every denominator", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await syncOpen43AuditMetadata(root);
  assert.equal(result.caseCount, 3);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.resolvedRoutingRows, 1);
  assert.deepEqual(result.classificationCounts, {
    source_ready: 1,
    needs_source: 0,
    candidate_required: 1,
    blocked_evidence: 1,
  });
  assert.deepEqual(result.routeCounts, { local_candidate: 1, total: 1 });
  assert.deepEqual(result.routing.rows.map(({ case_id }) => case_id), ["BLOCKED"]);
  assert.equal(result.reconciliation.closure_audits[0].case_count, 3);
  assert.deepEqual(result.reconciliation.closure_audits[0].issue_summaries, [
    {
      issue: 10,
      case_count: 3,
      classification_counts: {
        source_ready: 1,
        needs_source: 0,
        candidate_required: 1,
        blocked_evidence: 1,
      },
    },
  ]);
});

test("audit metadata sync refuses to invent routing for a newly blocked case", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const audit = JSON.parse(await fs.readFile(path.join(root, auditPath), "utf8"));
  audit.issues[0].blocked_evidence.push({ case_id: "NEW_BLOCKER" });
  await fs.writeFile(path.join(root, auditPath), `${JSON.stringify(audit, null, 2)}\n`);
  await assert.rejects(
    syncOpen43AuditMetadata(root),
    /new blocked evidence requires an explicit routing decision.*NEW_BLOCKER/u,
  );
});
